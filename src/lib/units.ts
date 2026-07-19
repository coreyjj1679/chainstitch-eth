/**
 * Unit-aware arg/result helpers. Notebook storage stays in base units
 * (wei / raw token units); the UI converts for display and entry.
 */
import { formatUnits, parseUnits } from "viem";
import type { Abi } from "viem";
import { displayValue } from "@/lib/serialize";

/** Param / event names that usually mean a token or ETH amount. */
const AMOUNT_NAME =
  /^(amount|value|wad|ray|assets|shares|qty|quantity|balance|supply|liquidity|collateral|debt|principal|fee|fees|premium|payment|deposit|withdrawal|delta|size|notional|assetsIn|assetsOut|amountIn|amountOut|amount0|amount1|maxAmount|minAmount|tokenAmount)(_|$)/i;

const AMOUNT_NAME_SUFFIX =
  /(Amount|Value|Assets|Shares|Balance|Supply|Liquidity|Fee|Fees|Premium|Payment|Deposit|Withdrawal|Delta)$/;

/** Read functions whose single uint return is almost always a token amount. */
const AMOUNT_RETURN_FN =
  /^(balanceOf|totalSupply|allowance|totalAssets|convertToAssets|convertToShares|previewDeposit|previewMint|previewWithdraw|previewRedeem|maxDeposit|maxMint|maxWithdraw|maxRedeem|getBalance)$/i;

export function isIntegerAbiType(type: string): boolean {
  return type.startsWith("uint") || type.startsWith("int");
}

export function isAddressAbiType(type: string): boolean {
  return type === "address";
}

export function isBoolAbiType(type: string): boolean {
  return type === "bool";
}

export function isAmountLikeName(name: string | undefined): boolean {
  if (!name) return false;
  return AMOUNT_NAME.test(name) || AMOUNT_NAME_SUFFIX.test(name);
}

export function isAmountLikeParam(
  name: string | undefined,
  type: string,
): boolean {
  return isIntegerAbiType(type) && isAmountLikeName(name);
}

export function isAmountLikeReturn(
  functionName: string | undefined,
  outputName: string | undefined,
  type: string,
): boolean {
  if (!isIntegerAbiType(type)) return false;
  if (isAmountLikeName(outputName)) return true;
  return Boolean(functionName && AMOUNT_RETURN_FN.test(functionName));
}

export function contractHasDecimals(abi: Abi): boolean {
  return abi.some(
    (e) =>
      e.type === "function" &&
      e.name === "decimals" &&
      (e.stateMutability === "view" || e.stateMutability === "pure") &&
      (!e.inputs || e.inputs.length === 0),
  );
}

/** True when the string still needs {{var}} interpolation or is empty. */
export function isVariableOrEmpty(text: string): boolean {
  const t = text.trim();
  return t === "" || t.includes("{{");
}

/** Decimal integer string suitable for BigInt / coerceArg (no decimals). */
export function isRawIntegerString(text: string): boolean {
  return /^-?\d+$/.test(text.trim());
}

export function looksLikeEnsName(text: string): boolean {
  const t = text.trim();
  if (!t || t.includes("{{") || t.startsWith("0x")) return false;
  return t.includes(".") && /^[a-zA-Z0-9._-]+$/.test(t);
}

export function humanToBase(
  human: string,
  decimals: number,
): { ok: true; base: string } | { ok: false; error: string } {
  const trimmed = human.trim();
  if (trimmed === "") return { ok: false, error: "Empty amount" };
  if (isVariableOrEmpty(trimmed)) {
    return { ok: false, error: "Variables stay in raw mode" };
  }
  try {
    return { ok: true, base: parseUnits(trimmed, decimals).toString() };
  } catch {
    return { ok: false, error: `Invalid amount: ${trimmed}` };
  }
}

export function baseToHuman(base: string, decimals: number): string | null {
  const trimmed = base.trim();
  if (!isRawIntegerString(trimmed)) return null;
  try {
    return formatUnits(BigInt(trimmed), decimals);
  } catch {
    return null;
  }
}

/**
 * Parse a details-grid label like `amount (uint256)` → name + type.
 * Non-ABI labels (Contract, Function, …) return null.
 */
export function parseAbiDetailLabel(
  label: string,
): { name: string; type: string } | null {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(label);
  if (!m) return null;
  const type = m[2].trim();
  // Skip non-ABI types that happen to use parentheses.
  if (
    !type ||
    (!isIntegerAbiType(type) &&
      type !== "address" &&
      type !== "bool" &&
      !type.startsWith("bytes") &&
      type !== "string" &&
      !type.startsWith("tuple") &&
      !type.endsWith("]"))
  ) {
    return null;
  }
  return { name: m[1].trim(), type };
}

export function formatIntegerWithUnits(
  value: bigint,
  decimals: number,
  unitLabel?: string,
): string {
  const human = formatUnits(value, decimals);
  const raw = value.toString();
  const unit = unitLabel ? ` ${unitLabel}` : "";
  return `${human}${unit} (${raw})`;
}

/**
 * Human-friendly rendering when we know an ABI type and optional token
 * decimals. Falls back to {@link displayValue}.
 */
export function displayAbiValue(
  value: unknown,
  opts?: {
    type?: string;
    name?: string;
    functionName?: string;
    decimals?: number | null;
    unitLabel?: string;
  },
): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";

  const type = opts?.type;
  const decimals = opts?.decimals;

  if (
    typeof value === "bigint" &&
    type &&
    isIntegerAbiType(type) &&
    decimals != null &&
    decimals >= 0 &&
    isAmountLikeReturn(opts?.functionName, opts?.name, type)
  ) {
    return formatIntegerWithUnits(value, decimals, opts?.unitLabel);
  }

  // Native ETH / wei amounts tagged only by name (trace value, payable).
  if (
    typeof value === "bigint" &&
    decimals != null &&
    decimals >= 0 &&
    isAmountLikeName(opts?.name) &&
    (!type || isIntegerAbiType(type))
  ) {
    return formatIntegerWithUnits(value, decimals, opts?.unitLabel);
  }

  return displayValue(value);
}
