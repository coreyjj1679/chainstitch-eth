/**
 * Tiny, safe evaluator for block conditions — no eval, no expressions beyond
 * a single comparison:
 *
 *   operand [op operand]      op ∈  ==  !=  <  <=  >  >=
 *
 * Operands are {{path}} references into the run scope or literals (integers,
 * decimals, 0x… hex, "quoted strings", true/false). A bare operand is tested
 * for truthiness; a leading `!` negates the whole condition.
 */

import { resolvePath } from "@/lib/variables";

export type ConditionOperator = "==" | "!=" | "<" | "<=" | ">" | ">=";

export interface ConditionOutcome {
  result: boolean;
  /** Human-readable evaluation, e.g. `{{allowance}} (900) < 1000 → false` */
  resolved: string;
}

interface Operand {
  /** The operand as typed, e.g. `{{allowance}}` or `1000` */
  text: string;
  value: unknown;
  /** True when the operand was a {{ref}} (its value is worth echoing back) */
  isRef: boolean;
}

const HEX = /^0x[0-9a-fA-F]*$/;
const INT = /^-?\d+$/;
const DECIMAL = /^-?(\d+\.\d*|\.\d+)$/;

/** Find the comparison operator outside quotes and {{…}} references. */
function findOperator(text: string): { op: ConditionOperator; index: number } | null {
  let quote: string | null = null;
  let inRef = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{" && text[i + 1] === "{") {
      inRef = true;
      i++;
      continue;
    }
    if (ch === "}" && text[i + 1] === "}") {
      inRef = false;
      i++;
      continue;
    }
    if (inRef) continue;
    const two = text.slice(i, i + 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=") {
      return { op: two as ConditionOperator, index: i };
    }
    if (ch === "<" || ch === ">") return { op: ch as ConditionOperator, index: i };
    if (ch === "=") throw new Error('Use "==" to compare for equality');
  }
  return null;
}

function parseOperand(raw: string, scope: Record<string, unknown>): Operand {
  const text = raw.trim();
  if (text === "") throw new Error("Condition is missing a value to compare");

  const ref = text.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
  if (ref) return { text, value: resolvePath(scope, ref[1]), isRef: true };

  if (text === "true") return { text, value: true, isRef: false };
  if (text === "false") return { text, value: false, isRef: false };
  if (INT.test(text)) return { text, value: BigInt(text), isRef: false };
  if (DECIMAL.test(text)) return { text, value: Number(text), isRef: false };
  if (HEX.test(text)) return { text, value: text, isRef: false };
  const quoted = text.match(/^"([^"]*)"$|^'([^']*)'$/);
  if (quoted) return { text, value: quoted[1] ?? quoted[2], isRef: false };

  throw new Error(
    `Unrecognized value "${text}" — use {{name}} for variables, quotes for strings`,
  );
}

/** Numeric view of a value, or null when it isn't number-like. */
function toNumeric(value: unknown): bigint | number | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    return Number.isInteger(value) ? BigInt(value) : value;
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (INT.test(t)) return BigInt(t);
    if (DECIMAL.test(t)) return Number(t);
  }
  return null;
}

function truthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value !== 0n;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    return t !== "" && t !== "false" && t !== "0";
  }
  return true;
}

function isComparableScalar(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  );
}

/** Short rendering of a value for the resolved-condition line. */
export function shortValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    return value.length > 46 ? `${value.slice(0, 43)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "(structured value)";
}

function equals(a: unknown, b: unknown): boolean {
  const an = toNumeric(a);
  const bn = toNumeric(b);
  if (an !== null && bn !== null) {
    if (typeof an === "bigint" && typeof bn === "bigint") return an === bn;
    return Number(an) === Number(bn);
  }
  if (typeof a === "string" && typeof b === "string") {
    // Addresses/hashes compare case-insensitively.
    if (HEX.test(a.trim()) && HEX.test(b.trim())) {
      return a.trim().toLowerCase() === b.trim().toLowerCase();
    }
    return a === b;
  }
  if (typeof a === "boolean" || typeof b === "boolean") {
    return truthy(a) === truthy(b);
  }
  if (!isComparableScalar(a) || !isComparableScalar(b)) {
    throw new Error(
      "Cannot compare structured values — reference a field, e.g. {{result.amount}}",
    );
  }
  return String(a) === String(b);
}

function compare(a: unknown, b: unknown, op: ConditionOperator): boolean {
  if (op === "==") return equals(a, b);
  if (op === "!=") return !equals(a, b);

  const an = toNumeric(a);
  const bn = toNumeric(b);
  if (an === null || bn === null) {
    const side = an === null ? a : b;
    throw new Error(`"${shortValue(side)}" is not numeric — cannot use ${op}`);
  }
  if (typeof an === "bigint" && typeof bn === "bigint") {
    switch (op) {
      case "<":
        return an < bn;
      case "<=":
        return an <= bn;
      case ">":
        return an > bn;
      case ">=":
        return an >= bn;
    }
  }
  const x = Number(an);
  const y = Number(bn);
  switch (op) {
    case "<":
      return x < y;
    case "<=":
      return x <= y;
    case ">":
      return x > y;
    case ">=":
      return x >= y;
  }
}

function operandLabel(operand: Operand): string {
  return operand.isRef
    ? `${operand.text} (${shortValue(operand.value)})`
    : operand.text;
}

/**
 * Evaluate a condition against the run scope. Throws with a friendly message
 * on syntax errors or unresolved variables.
 */
export function evaluateCondition(
  condition: string,
  scope: Record<string, unknown>,
): ConditionOutcome {
  let text = condition.trim();
  if (text === "") throw new Error("Set a condition for this block");

  let negate = false;
  if (text.startsWith("!") && !text.startsWith("!=")) {
    negate = true;
    text = text.slice(1).trim();
  }

  const found = findOperator(text);
  if (!found) {
    const operand = parseOperand(text, scope);
    const result = negate ? !truthy(operand.value) : truthy(operand.value);
    return {
      result,
      resolved: `${negate ? "!" : ""}${operandLabel(operand)} → ${result}`,
    };
  }

  const left = parseOperand(text.slice(0, found.index), scope);
  const right = parseOperand(text.slice(found.index + found.op.length), scope);
  let result = compare(left.value, right.value, found.op);
  if (negate) result = !result;
  return {
    result,
    resolved: `${negate ? "!(" : ""}${operandLabel(left)} ${found.op} ${operandLabel(right)}${negate ? ")" : ""} → ${result}`,
  };
}
