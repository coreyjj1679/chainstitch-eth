/**
 * Single source of truth for BigInt-safe JSON handling.
 * BigInts are encoded as strings with an `n` suffix (e.g. "123n").
 */

const BIGINT_STRING = /^-?\d+n$/;

export function stringifyBigIntSafe(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? `${v.toString()}n` : v),
    space,
  );
}

export function parseBigIntSafe(text: string): unknown {
  return JSON.parse(text, (_key, v) =>
    typeof v === "string" && BIGINT_STRING.test(v) ? BigInt(v.slice(0, -1)) : v,
  );
}

/** Human-friendly rendering of a decoded result for the UI. */
export function displayValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return stringifyBigIntSafe(value, 2);
}
