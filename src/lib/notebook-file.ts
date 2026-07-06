import type { Abi } from "viem";
import { validateAbi } from "@/lib/abi";
import { isGroupType } from "@/lib/block-label";
import type {
  BlockType,
  CallConfig,
  ContractEntry,
  EventConfig,
  NotebookBlock,
} from "@/lib/types";

/**
 * The portable notebook file ("chainstitch-notebook" v1): a deterministic
 * JSON manifest that carries a notebook plus the address-book entries its
 * blocks reference, so it can travel between instances, live in a contracts
 * repo, or be written from scratch by a coding agent.
 *
 * Design rules:
 * - Blocks reference contracts **by name** (`config.contract`), resolved
 *   against the file's own `contracts` array on import — never by database
 *   id, which is instance-local. Legacy manifests carrying `contractId` are
 *   still accepted when the id happens to exist in the target project.
 * - RPC URLs are deliberately **not** exported: they routinely embed API
 *   keys, and these files are meant to be committed and shared. Only the
 *   chain id travels.
 * - Block ids are regenerated on import (group membership is remapped), so
 *   importing the same file twice can never collide.
 */

export const NOTEBOOK_FILE_FORMAT = "chainstitch-notebook";
export const NOTEBOOK_FILE_VERSION = 1;

export interface NotebookFileContract {
  /** Unique within the file; what blocks reference via `config.contract`. */
  name: string;
  /** 0x… deployment address; empty string when not yet deployed. */
  address: string;
  abi: Abi;
}

/** A block as it appears in the file (configs reference contracts by name). */
export interface NotebookFileBlock {
  /** Optional; fresh ids are minted on import either way. */
  id?: string;
  type: BlockType;
  config: Record<string, unknown>;
  outputVariable?: string | null;
  /** Id of the enclosing sender/if group block within this file. */
  parentId?: string | null;
  runWhen?: string | null;
}

export interface NotebookFile {
  format: typeof NOTEBOOK_FILE_FORMAT;
  version: typeof NOTEBOOK_FILE_VERSION;
  title: string;
  description: string | null;
  chain: { id: number };
  contracts: NotebookFileContract[];
  blocks: NotebookFileBlock[];
}

const BLOCK_TYPES: readonly BlockType[] = [
  "read",
  "write",
  "rpc",
  "event",
  "markdown",
  "sender",
  "variable",
  "if",
  "recipe",
];

/** Block types whose config references an address-book contract. */
const CONTRACT_BLOCK_TYPES: readonly BlockType[] = ["read", "write", "event"];

function referencesContract(type: BlockType): boolean {
  return CONTRACT_BLOCK_TYPES.includes(type);
}

// --- Export ------------------------------------------------------------------

function shortAddress(address: string): string {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}

/**
 * Build the portable file for a notebook. Only contracts actually referenced
 * by a block are embedded; names are deduplicated (collisions get the
 * address appended) so `config.contract` references stay unambiguous.
 */
export function buildNotebookFile(
  notebook: { title: string; description: string | null },
  blocks: NotebookBlock[],
  contracts: ContractEntry[],
  chainId: number,
): NotebookFile {
  const referencedIds = new Set<string>();
  for (const block of blocks) {
    if (!referencesContract(block.type)) continue;
    const contractId = (block.config as CallConfig | EventConfig).contractId;
    if (contractId) referencedIds.add(contractId);
  }

  const usedNames = new Set<string>();
  const fileNameById = new Map<string, string>();
  const fileContracts: NotebookFileContract[] = [];
  for (const contract of contracts) {
    if (!referencedIds.has(contract.id)) continue;
    let name = contract.name;
    if (usedNames.has(name)) {
      name = `${contract.name} (${shortAddress(contract.address) || fileContracts.length})`;
    }
    usedNames.add(name);
    fileNameById.set(contract.id, name);
    fileContracts.push({ name, address: contract.address, abi: contract.abi });
  }

  const fileBlocks: NotebookFileBlock[] = blocks.map((block) => {
    const config = { ...(block.config as unknown as Record<string, unknown>) };
    if (referencesContract(block.type) && typeof config.contractId === "string") {
      const name = fileNameById.get(config.contractId);
      delete config.contractId;
      // Unresolvable ids (deleted contract) export as-is minus the id; the
      // importer will surface the gap as a warning instead of failing here.
      if (name) config.contract = name;
    }
    return {
      id: block.id,
      type: block.type,
      config,
      outputVariable: block.outputVariable ?? null,
      parentId: block.parentId ?? null,
      runWhen: block.runWhen ?? null,
    };
  });

  return {
    format: NOTEBOOK_FILE_FORMAT,
    version: NOTEBOOK_FILE_VERSION,
    title: notebook.title,
    description: notebook.description,
    chain: { id: chainId },
    contracts: fileContracts,
    blocks: fileBlocks,
  };
}

/** Filesystem-friendly file name for a notebook title. */
export function notebookFileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "notebook"}.notebook.json`;
}

// --- Validation --------------------------------------------------------------

const MAX_BLOCKS = 500;
const MAX_CONTRACTS = 100;

export type ParsedNotebookFile =
  | { ok: true; file: NotebookFile }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Lenient scalar→string coercion: agents often send numbers and booleans. */
function coerceString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

function coerceStringArray(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const entry of value) {
    const text = entry === null || entry === undefined ? "" : coerceString(entry);
    if (text === null) return null;
    out.push(text);
  }
  return out;
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return coerceString(value) ?? undefined; // undefined signals a type error
}

/**
 * Validate an untrusted manifest into a normalized `NotebookFile`.
 * Accepts the legacy in-app export shape (no `format` marker, configs with
 * raw `contractId`s and a `chain.rpcUrl`) so pre-v1 downloads keep working.
 * Every failure names the offending block so agents can self-correct.
 */
export function parseNotebookFile(input: unknown): ParsedNotebookFile {
  if (!isRecord(input)) return { ok: false, error: "Manifest must be a JSON object" };

  if (input.format !== undefined && input.format !== NOTEBOOK_FILE_FORMAT) {
    return { ok: false, error: `Unknown format "${String(input.format)}"` };
  }
  if (
    input.format === NOTEBOOK_FILE_FORMAT &&
    input.version !== undefined &&
    input.version !== NOTEBOOK_FILE_VERSION
  ) {
    return {
      ok: false,
      error: `Unsupported ${NOTEBOOK_FILE_FORMAT} version ${String(input.version)} (this instance reads version ${NOTEBOOK_FILE_VERSION})`,
    };
  }

  const title = coerceString(input.title)?.trim();
  if (!title) return { ok: false, error: "title is required" };
  const description =
    input.description === undefined || input.description === null
      ? null
      : coerceString(input.description);
  if (description === undefined) return { ok: false, error: "description must be a string" };

  let chainId = 0;
  if (isRecord(input.chain) && input.chain.id !== undefined) {
    chainId = Number(input.chain.id);
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      return { ok: false, error: "chain.id must be a positive integer" };
    }
  }

  // Contracts (optional — a notebook of rpc/markdown blocks needs none).
  const rawContracts = input.contracts === undefined ? [] : input.contracts;
  if (!Array.isArray(rawContracts)) {
    return { ok: false, error: "contracts must be an array" };
  }
  if (rawContracts.length > MAX_CONTRACTS) {
    return { ok: false, error: `Too many contracts (max ${MAX_CONTRACTS})` };
  }
  const contracts: NotebookFileContract[] = [];
  const contractNames = new Set<string>();
  for (const [i, raw] of rawContracts.entries()) {
    if (!isRecord(raw)) return { ok: false, error: `contracts[${i}] must be an object` };
    const name = coerceString(raw.name)?.trim();
    if (!name) return { ok: false, error: `contracts[${i}].name is required` };
    if (contractNames.has(name.toLowerCase())) {
      return { ok: false, error: `Duplicate contract name "${name}" in file` };
    }
    contractNames.add(name.toLowerCase());
    const address = raw.address ? (coerceString(raw.address) ?? "") : "";
    if (address && !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return { ok: false, error: `contracts[${i}] ("${name}") has an invalid address` };
    }
    const abi = validateAbi(raw.abi);
    if (!abi.ok) {
      return { ok: false, error: `contracts[${i}] ("${name}"): ${abi.error}` };
    }
    contracts.push({ name, address, abi: abi.abi });
  }

  // Blocks.
  if (!Array.isArray(input.blocks)) return { ok: false, error: "blocks must be an array" };
  if (input.blocks.length > MAX_BLOCKS) {
    return { ok: false, error: `Too many blocks (max ${MAX_BLOCKS})` };
  }
  const blocks: NotebookFileBlock[] = [];
  const seenIds = new Set<string>();
  for (const [i, raw] of input.blocks.entries()) {
    if (!isRecord(raw)) return { ok: false, error: `blocks[${i}] must be an object` };
    const type = raw.type as BlockType;
    if (!BLOCK_TYPES.includes(type)) {
      return {
        ok: false,
        error: `blocks[${i}] has unknown type "${String(raw.type)}" (expected one of: ${BLOCK_TYPES.join(", ")})`,
      };
    }
    const config = isRecord(raw.config) ? { ...raw.config } : {};
    const label = `blocks[${i}] (${type})`;

    switch (type) {
      case "read":
      case "write": {
        const functionName = coerceString(config.functionName)?.trim();
        if (!functionName) return { ok: false, error: `${label}: config.functionName is required` };
        const args = coerceStringArray(config.args);
        if (args === null) return { ok: false, error: `${label}: config.args must be an array` };
        const value = optionalString(config.value);
        if (value === undefined) return { ok: false, error: `${label}: config.value must be a string (wei)` };
        config.functionName = functionName;
        config.args = args;
        if (type === "write" && value !== null) config.value = value;
        else delete config.value;
        break;
      }
      case "event": {
        const eventName = coerceString(config.eventName)?.trim();
        if (!eventName) return { ok: false, error: `${label}: config.eventName is required` };
        const filters = coerceStringArray(config.filters);
        if (filters === null) return { ok: false, error: `${label}: config.filters must be an array` };
        const fromBlock = optionalString(config.fromBlock);
        const toBlock = optionalString(config.toBlock);
        if (fromBlock === undefined || toBlock === undefined) {
          return { ok: false, error: `${label}: fromBlock/toBlock must be strings` };
        }
        config.eventName = eventName;
        config.filters = filters;
        if (fromBlock !== null) config.fromBlock = fromBlock;
        else delete config.fromBlock;
        if (toBlock !== null) config.toBlock = toBlock;
        else delete config.toBlock;
        break;
      }
      case "rpc": {
        const method = coerceString(config.method)?.trim();
        if (!method) return { ok: false, error: `${label}: config.method is required` };
        const params = coerceStringArray(config.params);
        if (params === null) return { ok: false, error: `${label}: config.params must be an array` };
        config.method = method;
        config.params = params;
        break;
      }
      case "markdown": {
        const text = coerceString(config.text);
        if (text === null) return { ok: false, error: `${label}: config.text is required` };
        config.text = text;
        break;
      }
      case "sender": {
        const address = coerceString(config.address)?.trim();
        if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
          return { ok: false, error: `${label}: config.address must be a 0x… address` };
        }
        config.address = address;
        config.simulateOnly = config.simulateOnly === undefined ? true : Boolean(config.simulateOnly);
        break;
      }
      case "variable": {
        const name = coerceString(config.name)?.trim();
        const value = coerceString(config.value);
        if (!name) return { ok: false, error: `${label}: config.name is required` };
        if (value === null) return { ok: false, error: `${label}: config.value is required` };
        config.name = name;
        config.value = value;
        break;
      }
      case "if": {
        const condition = coerceString(config.condition)?.trim();
        if (!condition) return { ok: false, error: `${label}: config.condition is required` };
        config.condition = condition;
        break;
      }
      case "recipe":
        // recipeId is instance-local; resolution happens at import time.
        break;
    }

    // Contract reference: `contract` (by name) or legacy `contractId`. Names
    // resolve on import against the file's contracts array first, then the
    // target project's address book — so a file can lean on ABIs the
    // instance already has instead of embedding them.
    if (referencesContract(type)) {
      const ref = coerceString(config.contract)?.trim();
      const legacyId = coerceString(config.contractId)?.trim();
      if (ref) {
        config.contract = ref;
        delete config.contractId;
      } else if (!legacyId) {
        return {
          ok: false,
          error: `${label}: config.contract must name a contract (from this file's contracts array, or one already in the target project's address book)`,
        };
      }
    }

    const id = coerceString(raw.id) ?? undefined;
    if (id) {
      if (seenIds.has(id)) return { ok: false, error: `Duplicate block id "${id}"` };
      seenIds.add(id);
    }
    const outputVariable = optionalString(raw.outputVariable);
    const parentId = optionalString(raw.parentId);
    const runWhen = optionalString(raw.runWhen);
    if (outputVariable === undefined || parentId === undefined || runWhen === undefined) {
      return { ok: false, error: `${label}: outputVariable/parentId/runWhen must be strings` };
    }

    blocks.push({
      id,
      type,
      config,
      outputVariable: outputVariable ? outputVariable.trim() : null,
      parentId,
      runWhen,
    });
  }

  // Group membership must point at a group block that exists in the file.
  const groupIds = new Set(
    blocks.filter((b) => b.id && isGroupType(b.type)).map((b) => b.id as string),
  );
  for (const [i, block] of blocks.entries()) {
    if (block.parentId && !groupIds.has(block.parentId)) {
      return {
        ok: false,
        error: `blocks[${i}]: parentId "${block.parentId}" does not match any sender/if block id in the file`,
      };
    }
  }

  return {
    ok: true,
    file: {
      format: NOTEBOOK_FILE_FORMAT,
      version: NOTEBOOK_FILE_VERSION,
      title,
      description,
      chain: { id: chainId },
      contracts,
      blocks,
    },
  };
}

// --- Format documentation (served to agents by the MCP server) ---------------

export const NOTEBOOK_FILE_FORMAT_DOC = `# Chainstitch notebook file (v1)

A notebook is a JSON document ("${NOTEBOOK_FILE_FORMAT}" version ${NOTEBOOK_FILE_VERSION}).
Blocks run top to bottom; a block's output can be named via "outputVariable"
and referenced downstream as {{name}} (dot/bracket paths work: {{pool.token0}},
{{swaps[0].args.amount0}}).

\`\`\`json
{
  "format": "${NOTEBOOK_FILE_FORMAT}",
  "version": ${NOTEBOOK_FILE_VERSION},
  "title": "USDC allowance check",
  "description": "Approve only when the allowance is too low",
  "chain": { "id": 1 },
  "contracts": [
    { "name": "USDC", "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "abi": [ /* standard ABI JSON */ ] }
  ],
  "blocks": [
    { "type": "variable", "config": { "name": "spender", "value": "0x..." } },
    { "id": "b-read", "type": "read",
      "config": { "contract": "USDC", "functionName": "allowance", "args": ["0xOwner...", "{{spender}}"] },
      "outputVariable": "allowance" },
    { "id": "g-if", "type": "if", "config": { "condition": "{{allowance}} < 1000000" } },
    { "type": "write", "parentId": "g-if",
      "config": { "contract": "USDC", "functionName": "approve", "args": ["{{spender}}", "1000000"] },
      "outputVariable": "receipt" },
    { "type": "markdown", "config": { "text": "Done — receipt: {{receipt.transactionHash}}" } }
  ]
}
\`\`\`

Block types and their config:
- "read"     — { contract, functionName, args: string[] } — view/pure call (eth_call).
- "write"    — { contract, functionName, args: string[], value?: "wei" } — transaction; simulated first, signed in the user's browser wallet.
- "event"    — { contract, eventName, filters: string[], fromBlock?, toBlock? } — decoded event query; filters align with the event's indexed inputs ("" = any).
- "rpc"      — { method, params: string[] } — e.g. getBlock, getBalance, getLogs, or any raw method (anvil cheatcodes like evm_snapshot).
- "markdown" — { text } — prose; {{vars}} interpolate.
- "variable" — { name, value } — a named constant.
- "sender"   — { address, simulateOnly?: boolean } — group; child blocks call as this address (simulation, or anvil impersonation when simulateOnly is false).
- "if"       — { condition } — group; children run only when the condition holds, e.g. "{{allowance}} < {{amount}}".
- "recipe"   — { recipeId } — instance-local reference to a saved recipe; only meaningful inside the same instance.

Rules:
- Every value in "args"/"params"/"filters" is a string; {{variable}} references are allowed anywhere.
- Numbers are plain decimal strings in base units (wei for ETH, raw units for tokens — no decimals applied).
- "contract" names an entry of the file's "contracts" array, or (fallback) a contract already in the target project's address book. File contracts are matched to the address book by address, then by name; entries the project lacks are created on import.
- Groups ("sender"/"if") are one level deep: a group cannot be inside a group. Children reference their group via "parentId" (the group's "id" within this file).
- "runWhen" on a non-group block is a per-block condition guard with the same grammar as "if".
- Block "id"s are optional and only need to be unique within the file (imports mint fresh ids).
`;
