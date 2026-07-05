import type { Abi, AbiEvent, AbiFunction, AbiParameter } from "viem";

type AbiValidation = { ok: true; abi: Abi } | { ok: false; error: string };

/**
 * Accepts a raw ABI array, a JSON string, or a full Foundry/Hardhat artifact
 * (object with an `abi` field) and returns a normalized ABI.
 */
export function validateAbi(input: unknown): AbiValidation {
  let candidate = input;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return { ok: false, error: "ABI is not valid JSON" };
    }
  }
  if (
    candidate &&
    typeof candidate === "object" &&
    !Array.isArray(candidate) &&
    "abi" in candidate
  ) {
    candidate = (candidate as { abi: unknown }).abi;
  }
  if (!Array.isArray(candidate)) {
    return { ok: false, error: "ABI must be a JSON array (or an artifact with an `abi` field)" };
  }
  for (const entry of candidate) {
    if (!entry || typeof entry !== "object" || typeof entry.type !== "string") {
      return { ok: false, error: "ABI contains an entry without a `type` field" };
    }
  }
  return { ok: true, abi: candidate as Abi };
}

export function getFunctions(abi: Abi): AbiFunction[] {
  return abi.filter((e): e is AbiFunction => e.type === "function");
}

export function getReadFunctions(abi: Abi): AbiFunction[] {
  return getFunctions(abi).filter(
    (f) => f.stateMutability === "view" || f.stateMutability === "pure",
  );
}

export function getWriteFunctions(abi: Abi): AbiFunction[] {
  return getFunctions(abi).filter(
    (f) => f.stateMutability === "nonpayable" || f.stateMutability === "payable",
  );
}

export function getEvents(abi: Abi): AbiEvent[] {
  return abi.filter((e): e is AbiEvent => e.type === "event");
}

export function functionSignature(fn: AbiFunction): string {
  const params = fn.inputs.map((i) => formatParam(i)).join(", ");
  return `${fn.name}(${params})`;
}

/** `Transfer(address from, address to, uint256 value)` — indexed marked. */
export function eventSignature(event: AbiEvent): string {
  const params = event.inputs
    .map((i) => `${i.type}${i.indexed ? " indexed" : ""}${i.name ? ` ${i.name}` : ""}`)
    .join(", ");
  return `${event.name}(${params})`;
}

function formatParam(param: AbiParameter): string {
  return param.name ? `${param.type} ${param.name}` : param.type;
}

export function returnsSignature(fn: AbiFunction): string {
  if (!fn.outputs || fn.outputs.length === 0) return "";
  return fn.outputs.map((o) => formatParam(o)).join(", ");
}

/**
 * Parse a user-entered arg string into the JS value viem expects for the
 * given ABI type. Values already resolved from variables pass through.
 */
export function coerceArg(value: unknown, abiType: string): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (abiType.endsWith("]") || abiType === "tuple" || abiType.startsWith("tuple")) {
    // Arrays and structs are entered as JSON
    return coerceJson(trimmed);
  }
  if (abiType.startsWith("uint") || abiType.startsWith("int")) {
    if (trimmed === "") throw new Error("Missing integer value");
    return BigInt(trimmed);
  }
  if (abiType === "bool") {
    if (trimmed === "true" || trimmed === "1") return true;
    if (trimmed === "false" || trimmed === "0") return false;
    throw new Error(`Invalid bool: ${trimmed}`);
  }
  return trimmed;
}

function coerceJson(text: string): unknown {
  try {
    // Allow bare numbers (large ints) inside JSON by quoting is user's job;
    // BigInt-suffixed strings like "123n" are converted after parse.
    return JSON.parse(text, (_k, v) =>
      typeof v === "string" && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v,
    );
  } catch {
    throw new Error(`Invalid JSON for array/tuple input: ${text}`);
  }
}
