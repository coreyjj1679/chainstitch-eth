/**
 * Decoded call traces. Wraps geth/anvil's `debug_traceCall` /
 * `debug_traceTransaction` (callTracer) and decodes the resulting call tree
 * against the project address book: contract names, function signatures with
 * decoded args, and — for failing frames — the revert reason (custom errors,
 * `Error(string)`, `Panic(uint256)`).
 *
 * Two consumers share this: decoded revert traces (attached to a failed
 * write/simulate) and tx-hash import (the full internal call tree of a mined
 * transaction). Tracing runs client-side via the project RPC; when the RPC
 * doesn't expose the debug namespace the wrappers return null so callers fall
 * back gracefully.
 */

import {
  decodeErrorResult,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  hexToBigInt,
  numberToHex,
  type Abi,
  type BlockTag,
  type Hex,
  type PublicClient,
} from "viem";
import { functionSignature, getFunctions } from "@/lib/abi";
import { displayValue } from "@/lib/serialize";
import type { ContractEntry } from "@/lib/types";

/** Raw callTracer frame, as geth/anvil returns it (hex-encoded numbers). */
export interface RawCallFrame {
  type: string;
  from: string;
  to?: string;
  value?: string;
  gas?: string;
  gasUsed?: string;
  input?: string;
  output?: string;
  error?: string;
  revertReason?: string;
  calls?: RawCallFrame[];
}

/** A decoded node in the call tree, ready for the Trace tab / import preview. */
export interface CallFrame {
  /** CALL / STATICCALL / DELEGATECALL / CREATE / CREATE2 / … */
  type: string;
  from: string;
  to?: string;
  /** Address-book name of `to`, or a shortened address. */
  contract?: string;
  /** Decoded function name when the callee's ABI was known. */
  functionName?: string;
  /** Full `name(type arg, …)` signature, when resolved. */
  signature?: string;
  /** Decoded arguments, aligned with the function inputs. */
  args?: unknown[];
  /** 4-byte selector, always available for non-empty calldata. */
  selector?: string;
  /** ETH value moved by this call, in wei. */
  value?: bigint;
  gasUsed?: bigint;
  /** True when this frame reverted (had an `error`). */
  reverted: boolean;
  /** Decoded revert reason for a failing frame. */
  revertReason?: string;
  /** Best-effort decoded return value for a successful call. */
  output?: unknown;
  children: CallFrame[];
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * A missing `debug_*` namespace shows up as a JSON-RPC "method not found"
 * (or an equivalent "not supported/available"). Those mean "trace elsewhere",
 * so the wrappers return null; anything else is a real error worth surfacing.
 */
function isUnsupported(error: unknown): boolean {
  const code = (error as { code?: number })?.code;
  if (code === -32601) return true;
  const message = (
    error instanceof Error ? error.message : String(error ?? "")
  ).toLowerCase();
  return (
    message.includes("method not found") ||
    message.includes("method not supported") ||
    message.includes("not available") ||
    message.includes("does not exist") ||
    message.includes("unsupported method")
  );
}

/**
 * Trace an unsent call (the shape a write/simulate would send). Returns null
 * when the RPC has no debug namespace or tracing otherwise fails — callers
 * treat the trace as a best-effort bonus.
 */
export async function traceCall(
  client: PublicClient,
  call: { from?: Hex; to: Hex; data: Hex; value?: bigint },
  block: bigint | BlockTag = "latest",
): Promise<RawCallFrame | null> {
  try {
    const raw = await client.request({
      method: "debug_traceCall" as never,
      params: [
        {
          from: call.from,
          to: call.to,
          data: call.data,
          ...(call.value !== undefined ? { value: numberToHex(call.value) } : {}),
        },
        typeof block === "bigint" ? numberToHex(block) : block,
        { tracer: "callTracer" },
      ] as never,
    });
    return (raw ?? null) as RawCallFrame | null;
  } catch {
    // Best-effort: never let a tracing hiccup mask the primary result.
    return null;
  }
}

/**
 * Trace a mined transaction. Returns null when the RPC doesn't support
 * `debug_traceTransaction` (so tx-import can fall back to the top-level call);
 * genuinely unexpected errors propagate.
 */
export async function traceTransaction(
  client: PublicClient,
  txHash: Hex,
): Promise<RawCallFrame | null> {
  try {
    const raw = await client.request({
      method: "debug_traceTransaction" as never,
      params: [txHash, { tracer: "callTracer" }] as never,
    });
    return (raw ?? null) as RawCallFrame | null;
  } catch (error) {
    if (isUnsupported(error)) return null;
    throw error;
  }
}

/** Human string for a decoded error result (custom / Error / Panic). */
function formatDecodedError(
  errorName: string | undefined,
  args: readonly unknown[] | undefined,
): string {
  if (errorName === "Error") return String(args?.[0] ?? "reverted");
  if (errorName === "Panic") {
    const code = args?.[0];
    const hex = typeof code === "bigint" ? `0x${code.toString(16)}` : String(code);
    return `Panic(${hex})`;
  }
  const rendered = (args ?? []).map((a) => displayValue(a)).join(", ");
  return `${errorName ?? "revert"}(${rendered})`;
}

/**
 * Decode revert return data. Every address-book ABI is tried (to catch custom
 * errors), then a bare decode for the standard `Error(string)` / `Panic` that
 * viem folds in automatically.
 */
export function decodeRevertReason(
  data: Hex | undefined,
  contracts: ContractEntry[],
): string | undefined {
  if (!data || data === "0x") return undefined;
  for (const contract of contracts) {
    try {
      const { errorName, args } = decodeErrorResult({ abi: contract.abi, data });
      return formatDecodedError(errorName, args as readonly unknown[] | undefined);
    } catch {
      // Not this ABI's error — try the next.
    }
  }
  try {
    const { errorName, args } = decodeErrorResult({ abi: [], data });
    return formatDecodedError(errorName, args as readonly unknown[] | undefined);
  } catch {
    return undefined;
  }
}

/** Decode one raw frame (and its children) against the address book. */
export function decodeCallTree(
  raw: RawCallFrame,
  contracts: ContractEntry[],
): CallFrame {
  const to = raw.to;
  const contract = to
    ? contracts.find((c) => c.address.toLowerCase() === to.toLowerCase())
    : undefined;

  const input = (raw.input ?? "0x") as Hex;
  const reverted = !!raw.error;

  let functionName: string | undefined;
  let signature: string | undefined;
  let args: unknown[] | undefined;
  let selector: string | undefined;
  let output: unknown;

  if (input.length >= 10) {
    selector = input.slice(0, 10);
    if (contract) {
      try {
        const decoded = decodeFunctionData({ abi: contract.abi, data: input });
        functionName = decoded.functionName;
        args = decoded.args ? [...(decoded.args as unknown[])] : [];
        const fn = getFunctions(contract.abi).find(
          (f) => f.name === functionName && f.inputs.length === (args?.length ?? 0),
        );
        if (fn) signature = functionSignature(fn);
        // Decode the return value on successful calls (best-effort).
        if (!reverted && functionName && raw.output && raw.output !== "0x") {
          try {
            output = decodeFunctionResult({
              abi: contract.abi,
              functionName,
              data: raw.output as Hex,
            });
          } catch {
            // Non-standard/empty output — leave undecoded.
          }
        }
      } catch {
        // Selector isn't in this ABI — keep the raw selector only.
      }
    }
  }

  let revertReason: string | undefined;
  if (reverted) {
    revertReason =
      raw.revertReason ||
      decodeRevertReason(raw.output as Hex | undefined, contracts) ||
      raw.error;
  }

  return {
    type: raw.type,
    from: raw.from,
    to,
    contract: contract?.name ?? (to ? shortAddress(to) : undefined),
    functionName,
    signature,
    args,
    selector,
    value: raw.value ? hexToBigInt(raw.value as Hex) : undefined,
    gasUsed: raw.gasUsed ? hexToBigInt(raw.gasUsed as Hex) : undefined,
    reverted,
    revertReason,
    output,
    children: (raw.calls ?? []).map((child) => decodeCallTree(child, contracts)),
  };
}

/**
 * The deepest reverting frame — the actual cause, not the outermost bubble-up.
 * Prefers a frame whose reason decoded; falls back to the deepest reverted one.
 */
export function findRevertCause(frame: CallFrame): CallFrame | undefined {
  let deepestReverted: CallFrame | undefined;
  let deepestWithReason: CallFrame | undefined;
  const visit = (node: CallFrame) => {
    if (node.reverted) {
      deepestReverted = node;
      if (node.revertReason) deepestWithReason = node;
    }
    node.children.forEach(visit);
  };
  visit(frame);
  return deepestWithReason ?? deepestReverted;
}

/** Encode a call's data for tracing a write/simulate that just failed. */
export function encodeCall(abi: Abi, functionName: string, args: unknown[]): Hex {
  return encodeFunctionData({ abi, functionName, args });
}
