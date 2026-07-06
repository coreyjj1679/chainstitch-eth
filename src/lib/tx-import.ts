/**
 * Import a mined transaction into notebook blocks. Fetches the transaction and
 * its internal call tree (`debug_traceTransaction`), pulls a verified ABI for
 * every contract it touched (address-book first, then the autofetch resolver),
 * and emits one decoded read/write block per call inside a sender group for
 * the original sender — the reverse of the codegen story: an on-chain tx
 * becomes an editable, decoded notebook.
 *
 * Everything runs client-side against the project RPC. When the RPC has no
 * `debug` namespace, only the top-level call is imported (with a warning).
 */

import { numberToHex, type Abi, type Hex, type PublicClient } from "viem";
import { getFunctions } from "@/lib/abi";
import { stringifyBigIntSafe } from "@/lib/serialize";
import { decodeCallTree, traceTransaction, type CallFrame, type RawCallFrame } from "@/lib/trace";
import type {
  CallConfig,
  ContractEntry,
  MarkdownConfig,
  NotebookBlock,
  SenderConfig,
} from "@/lib/types";

/** A touched contract not yet in the address book (ABI was resolved). */
export interface TxImportMissing {
  name: string;
  address: string;
  abi: Abi;
  /** Ids of the imported blocks that reference it (remapped on insert). */
  blockIds: string[];
}

export interface TxImportSummary {
  hash: string;
  from: string;
  to: string | null;
  value: bigint;
  blockNumber: bigint | null;
  status: "success" | "reverted" | "unknown";
  /** True when an internal call trace was available. */
  traced: boolean;
  /** Number of decoded call blocks emitted. */
  callCount: number;
}

export interface TxImportResult {
  blocks: NotebookBlock[];
  warnings: string[];
  missing: TxImportMissing[];
  summary: TxImportSummary;
}

export interface TxImportOptions {
  txHash: Hex;
  publicClient: PublicClient;
  contracts: ContractEntry[];
  /** Verified-ABI lookup for an address not in the book (null when none). */
  resolveAbi: (address: string) => Promise<{ name?: string; abi: Abi } | null>;
  /** Cap on emitted call blocks (keeps huge DeFi traces manageable). */
  maxCalls?: number;
  /** Cap on parallel ABI lookups for unknown addresses. */
  maxLookups?: number;
}

const DEFAULT_MAX_CALLS = 150;
const DEFAULT_MAX_LOOKUPS = 60;
/** Call frame kinds that carry decodable calldata. */
const CALL_KINDS = new Set(["CALL", "STATICCALL", "DELEGATECALL", "CALLCODE"]);

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Placeholder contract id for a touched contract that isn't in the book yet.
 * Blocks reference it so the preview can resolve names; the import dialog swaps
 * it for the real id once the contract is created (see `missing[].blockIds`).
 */
export function missingContractId(address: string): string {
  return `tx-${address.toLowerCase()}`;
}

/** Every distinct callee address in a raw trace, lowercased. */
function collectAddresses(raw: RawCallFrame, out = new Set<string>()): Set<string> {
  if (raw.to) out.add(raw.to.toLowerCase());
  for (const child of raw.calls ?? []) collectAddresses(child, out);
  return out;
}

/** Pre-order flatten (parent before children) — natural trace reading order. */
function flatten(frame: CallFrame, out: CallFrame[] = []): CallFrame[] {
  out.push(frame);
  for (const child of frame.children) flatten(child, out);
  return out;
}

/** A decoded arg → the string a form field expects (BigInt-safe for JSON). */
function argToFormString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Arrays / tuples / structs are entered as JSON; keep bigints as "123n".
  return stringifyBigIntSafe(value);
}

export async function importTransaction(opts: TxImportOptions): Promise<TxImportResult> {
  const { txHash, publicClient, contracts, resolveAbi } = opts;
  const maxCalls = opts.maxCalls ?? DEFAULT_MAX_CALLS;
  const maxLookups = opts.maxLookups ?? DEFAULT_MAX_LOOKUPS;
  const warnings: string[] = [];

  const [tx, receipt] = await Promise.all([
    publicClient.getTransaction({ hash: txHash }),
    publicClient.getTransactionReceipt({ hash: txHash }).catch(() => null),
  ]);

  // The internal call tree; falls back to just the top-level call when the RPC
  // has no debug namespace.
  const traced = await traceTransaction(publicClient, txHash);
  let raw: RawCallFrame;
  if (traced) {
    raw = traced;
  } else {
    if (!tx.to) {
      throw new Error(
        "This is a contract-creation transaction and the RPC returned no trace — nothing to import.",
      );
    }
    warnings.push(
      "This RPC did not return an internal call trace (debug_traceTransaction unavailable) — imported the top-level call only. Point the project at anvil or a trace-enabled RPC for the full tree.",
    );
    raw = {
      type: "CALL",
      from: tx.from,
      to: tx.to,
      input: tx.input,
      value: numberToHex(tx.value),
    };
  }

  // Resolve an ABI for every touched address not already in the book.
  const byAddress = new Map<string, { entry: ContractEntry; existing: boolean }>();
  for (const c of contracts) {
    if (c.address) byAddress.set(c.address.toLowerCase(), { entry: c, existing: true });
  }
  const unknown = [...collectAddresses(raw)].filter((a) => !byAddress.has(a));
  const toLookup = unknown.slice(0, maxLookups);
  if (unknown.length > toLookup.length) {
    warnings.push(
      `The transaction touched ${unknown.length} unknown contracts; only the first ${toLookup.length} were looked up.`,
    );
  }
  const resolved = await Promise.all(
    toLookup.map(async (address) => {
      try {
        return { address, hit: await resolveAbi(address) };
      } catch {
        return { address, hit: null };
      }
    }),
  );
  const usedNames = new Set(contracts.map((c) => c.name.toLowerCase()));
  for (const { address, hit } of resolved) {
    if (!hit) continue;
    let name = hit.name?.trim() || `Contract ${shortAddress(address)}`;
    // Keep names distinct so the address book stays readable.
    if (usedNames.has(name.toLowerCase())) name = `${name} ${shortAddress(address)}`;
    usedNames.add(name.toLowerCase());
    byAddress.set(address, {
      existing: false,
      entry: {
        id: missingContractId(address),
        projectId: "",
        name,
        address,
        abi: hit.abi,
        createdAt: 0,
      },
    });
  }

  const tree = decodeCallTree(raw, [...contracts, ...[...byAddress.values()].filter((v) => !v.existing).map((v) => v.entry)]);

  // Build the document: a summary note, then one call block per frame inside a
  // sender group for the original sender.
  const groupId = crypto.randomUUID();
  const children: NotebookBlock[] = [];
  const missing = new Map<string, TxImportMissing>();
  const warnedUnknown = new Set<string>();
  let callCount = 0;
  let truncated = false;

  for (const frame of flatten(tree)) {
    if (callCount >= maxCalls) {
      truncated = true;
      break;
    }
    const to = frame.to;

    // Contract creation / selfdestruct: note it, can't be a call block.
    if (!CALL_KINDS.has(frame.type) || !to) {
      children.push({
        id: crypto.randomUUID(),
        type: "markdown",
        config: {
          text: `_${frame.type}${to ? ` → ${shortAddress(to)}` : ""} (not imported as a call)_`,
        } satisfies MarkdownConfig,
        outputVariable: null,
        parentId: groupId,
      });
      continue;
    }

    // Empty calldata = plain value transfer; note only when it moved ETH.
    if (!frame.selector || frame.selector === "0x") {
      if (frame.value && frame.value > 0n) {
        children.push({
          id: crypto.randomUUID(),
          type: "markdown",
          config: {
            text: `_ETH transfer → ${frame.contract ?? shortAddress(to)}: ${frame.value.toString()} wei_`,
          } satisfies MarkdownConfig,
          outputVariable: null,
          parentId: groupId,
        });
      }
      continue;
    }

    const known = byAddress.get(to.toLowerCase());
    if (!known) {
      if (!warnedUnknown.has(to.toLowerCase())) {
        warnedUnknown.add(to.toLowerCase());
        warnings.push(
          `No verified ABI for ${shortAddress(to)} — its calls were left as notes. Add it in the Contracts tab to decode them.`,
        );
      }
      children.push({
        id: crypto.randomUUID(),
        type: "markdown",
        config: {
          text: `_Call to unknown contract ${shortAddress(to)} (selector ${frame.selector})_`,
        } satisfies MarkdownConfig,
        outputVariable: null,
        parentId: groupId,
      });
      continue;
    }

    if (!frame.functionName) {
      children.push({
        id: crypto.randomUUID(),
        type: "markdown",
        config: {
          text: `_${known.entry.name}: selector ${frame.selector} not found in its ABI_`,
        } satisfies MarkdownConfig,
        outputVariable: null,
        parentId: groupId,
      });
      continue;
    }

    const args = (frame.args ?? []).map(argToFormString);
    const fn = getFunctions(known.entry.abi).find(
      (f) => f.name === frame.functionName && f.inputs.length === args.length,
    );
    const isRead = fn?.stateMutability === "view" || fn?.stateMutability === "pure";
    const payable = fn?.stateMutability === "payable";

    const blockId = crypto.randomUUID();
    const config: CallConfig = {
      // Existing → its real id; missing → the synthetic id, remapped on insert
      // once the contract is created (see missing[].blockIds).
      contractId: known.entry.id,
      functionName: frame.functionName,
      args,
      ...(!isRead && payable && frame.value && frame.value > 0n
        ? { value: frame.value.toString() }
        : {}),
    };
    children.push({
      id: blockId,
      type: isRead ? "read" : "write",
      config,
      outputVariable: null,
      parentId: groupId,
    });
    callCount++;

    if (!known.existing) {
      const key = to.toLowerCase();
      const record =
        missing.get(key) ??
        ({ name: known.entry.name, address: known.entry.address, abi: known.entry.abi, blockIds: [] } satisfies TxImportMissing);
      record.blockIds.push(blockId);
      missing.set(key, record);
    }
  }

  if (truncated) {
    warnings.push(
      `The trace had more than ${maxCalls} calls; imported the first ${maxCalls}.`,
    );
  }

  const status: TxImportSummary["status"] = receipt
    ? receipt.status === "success"
      ? "success"
      : "reverted"
    : "unknown";

  const rootContract = tx.to ? byAddress.get(tx.to.toLowerCase())?.entry.name : undefined;
  const summaryLines = [
    `# Imported transaction ${shortAddress(txHash)}`,
    ``,
    `- **From:** ${tx.from}`,
    `- **To:** ${tx.to ?? "(contract creation)"}${rootContract ? ` (${rootContract})` : ""}`,
    `- **Value:** ${tx.value.toString()} wei`,
    ...(tx.blockNumber !== null ? [`- **Block:** ${tx.blockNumber.toString()}`] : []),
    `- **Status:** ${status}`,
    `- **Calls decoded:** ${callCount}`,
    ``,
    traced
      ? "Each block below is one call from this transaction's internal trace, decoded against the address book. The internal calls executed atomically inside the top-level call — running them individually here re-simulates each in isolation, so some may revert. The first block is the top-level call that reproduces the transaction."
      : "Only the top-level call was imported — this RPC returned no internal call trace.",
  ];

  const summaryBlock: NotebookBlock = {
    id: crypto.randomUUID(),
    type: "markdown",
    config: { text: summaryLines.join("\n") } satisfies MarkdownConfig,
    outputVariable: null,
    parentId: null,
  };
  const senderGroup: NotebookBlock = {
    id: groupId,
    type: "sender",
    // Simulate-as by default: exploring a historical tx shouldn't send anything.
    config: { address: tx.from, simulateOnly: true } satisfies SenderConfig,
    outputVariable: null,
    parentId: null,
  };

  return {
    blocks: [summaryBlock, senderGroup, ...children],
    warnings,
    missing: [...missing.values()],
    summary: {
      hash: txHash,
      from: tx.from,
      to: tx.to ?? null,
      value: tx.value,
      blockNumber: tx.blockNumber,
      status,
      traced: !!traced,
      callCount,
    },
  };
}
