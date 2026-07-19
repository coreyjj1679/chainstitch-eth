/**
 * Expect-block evaluation: assertions that fail the run when unmet.
 * Condition / event checks are pure; revert simulates a call via viem.
 */

import {
  BaseError,
  ContractFunctionRevertedError,
  type PublicClient,
} from "viem";
import { coerceArg, getFunctions } from "@/lib/abi";
import { evaluateCondition, shortValue } from "@/lib/condition";
import { interpolate, resolvePath } from "@/lib/variables";
import type {
  ContractEntry,
  DecodedEventEntry,
  ExpectConfig,
  ExpectKind,
} from "@/lib/types";

export interface ExpectOutcome {
  ok: boolean;
  /** Human-readable verdict for the result cell */
  message: string;
  details?: Record<string, unknown>;
}

const EXPECT_KINDS: readonly ExpectKind[] = ["condition", "event", "revert"];

export function isExpectKind(value: unknown): value is ExpectKind {
  return typeof value === "string" && EXPECT_KINDS.includes(value as ExpectKind);
}

/** Validate / normalize a raw expect config (notebook file + AI import). */
export function parseExpectConfig(
  raw: Record<string, unknown>,
): { ok: true; config: ExpectConfig } | { ok: false; error: string } {
  const kind = raw.kind;
  if (!isExpectKind(kind)) {
    return {
      ok: false,
      error: `config.kind must be one of: ${EXPECT_KINDS.join(", ")}`,
    };
  }

  if (kind === "condition") {
    const condition =
      typeof raw.condition === "string" ? raw.condition.trim() : "";
    if (!condition) return { ok: false, error: "config.condition is required" };
    return { ok: true, config: { kind, condition } };
  }

  if (kind === "event") {
    const eventName =
      typeof raw.eventName === "string" ? raw.eventName.trim() : "";
    if (!eventName) return { ok: false, error: "config.eventName is required" };
    const contract =
      typeof raw.contract === "string" && raw.contract.trim()
        ? raw.contract.trim()
        : undefined;
    const fromVariable =
      typeof raw.fromVariable === "string" && raw.fromVariable.trim()
        ? raw.fromVariable.trim().replace(/[{}]/g, "")
        : undefined;
    return {
      ok: true,
      config: {
        kind,
        eventName,
        ...(contract ? { contract } : {}),
        ...(fromVariable ? { fromVariable } : {}),
      },
    };
  }

  // revert
  const functionName =
    typeof raw.functionName === "string" ? raw.functionName.trim() : "";
  if (!functionName) {
    return { ok: false, error: "config.functionName is required for revert expects" };
  }
  const args = Array.isArray(raw.args)
    ? raw.args.map((a) => (a == null ? "" : String(a)))
    : null;
  if (args === null) return { ok: false, error: "config.args must be an array" };
  const reason =
    typeof raw.reason === "string" && raw.reason.trim()
      ? raw.reason.trim()
      : undefined;
  const value =
    typeof raw.value === "string" && raw.value.trim() ? raw.value.trim() : undefined;
  // contract / contractId resolved by the notebook-file importer
  const contractId =
    typeof raw.contractId === "string" ? raw.contractId.trim() : undefined;
  const contract =
    typeof raw.contract === "string" ? raw.contract.trim() : undefined;
  return {
    ok: true,
    config: {
      kind: "revert",
      functionName,
      args,
      ...(contractId ? { contractId } : {}),
      ...(contract ? { contract } : {}),
      ...(value ? { value } : {}),
      ...(reason ? { reason } : {}),
    } as ExpectConfig,
  };
}

export function evaluateExpectCondition(
  config: ExpectConfig,
  scope: Record<string, unknown>,
): ExpectOutcome {
  const condition = config.condition?.trim() ?? "";
  const { result, resolved } = evaluateCondition(condition, scope);
  if (result) {
    return {
      ok: true,
      message: `expect: ${resolved}`,
      details: { Condition: condition, Evaluation: resolved },
    };
  }
  return {
    ok: false,
    message: `Expectation failed: ${resolved}`,
    details: { Condition: condition, Evaluation: resolved },
  };
}

function asEventList(value: unknown): DecodedEventEntry[] | null {
  if (!Array.isArray(value)) return null;
  const out: DecodedEventEntry[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const e = entry as Record<string, unknown>;
    if (typeof e.event !== "string") return null;
    out.push({
      address: typeof e.address === "string" ? e.address : "",
      contract: typeof e.contract === "string" ? e.contract : "",
      event: e.event,
      args:
        e.args && typeof e.args === "object"
          ? (e.args as Record<string, unknown>)
          : undefined,
      logIndex: typeof e.logIndex === "number" ? e.logIndex : undefined,
    });
  }
  return out;
}

export function evaluateExpectEvent(
  config: ExpectConfig,
  scope: Record<string, unknown>,
  lastWriteEvents: DecodedEventEntry[] | null,
): ExpectOutcome {
  const eventName = config.eventName?.trim() ?? "";
  if (!eventName) {
    return { ok: false, message: "Expectation failed: event name is required" };
  }

  let events: DecodedEventEntry[] | null = null;
  let source: string;
  if (config.fromVariable?.trim()) {
    const path = config.fromVariable.trim();
    events = asEventList(resolvePath(scope, path));
    source = `{{${path}}}`;
    if (!events) {
      return {
        ok: false,
        message: `Expectation failed: {{${path}}} is not a list of decoded events`,
        details: { Source: source, Event: eventName },
      };
    }
  } else {
    events = lastWriteEvents;
    source = "last write";
    if (!events) {
      return {
        ok: false,
        message:
          "Expectation failed: no write receipt events yet — run a write first, or set fromVariable",
        details: { Source: source, Event: eventName },
      };
    }
  }

  const contractFilter = config.contract?.trim().toLowerCase();
  const matches = events.filter((e) => {
    if (e.event !== eventName) return false;
    if (!contractFilter) return true;
    return e.contract.toLowerCase() === contractFilter;
  });

  if (matches.length > 0) {
    return {
      ok: true,
      message: `expect event ${eventName}: found ${matches.length} in ${source}`,
      details: {
        Source: source,
        Event: eventName,
        ...(contractFilter ? { Contract: config.contract } : {}),
        Matches: matches.length,
      },
    };
  }

  const seen = [...new Set(events.map((e) => e.event))].join(", ") || "(none)";
  return {
    ok: false,
    message: `Expectation failed: event ${eventName} not found in ${source} (saw: ${seen})`,
    details: {
      Source: source,
      Event: eventName,
      ...(contractFilter ? { Contract: config.contract } : {}),
      Seen: seen,
    },
  };
}

function revertMessage(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      const reason = reverted.reason;
      if (name && reason) return `${name}: ${reason}`;
      if (name) return name;
      if (reason) return reason;
    }
    return error.shortMessage || error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Simulate a call and require it to revert. Optional `reason` is a
 * case-insensitive substring match against the revert message / error name.
 */
export async function evaluateExpectRevert(
  config: ExpectConfig,
  scope: Record<string, unknown>,
  contracts: ContractEntry[],
  publicClient: PublicClient,
  sender?: `0x${string}`,
): Promise<ExpectOutcome> {
  const contractId = config.contractId?.trim() ?? "";
  const functionName = config.functionName?.trim() ?? "";
  if (!contractId || !functionName) {
    return {
      ok: false,
      message: "Expectation failed: revert expect needs a contract and function",
    };
  }
  const contract = contracts.find((c) => c.id === contractId);
  if (!contract) {
    return { ok: false, message: "Expectation failed: select a contract" };
  }
  if (!contract.address) {
    return {
      ok: false,
      message: `Expectation failed: "${contract.name}" has no address`,
    };
  }
  const fn = getFunctions(contract.abi).find((f) => f.name === functionName);
  if (!fn) {
    return {
      ok: false,
      message: `Expectation failed: function "${functionName}" not found on ${contract.name}`,
    };
  }

  const args = (config.args ?? []).map((raw, i) => {
    const input = fn.inputs[i];
    if (!input) throw new Error(`Unexpected argument #${i + 1}`);
    if (typeof raw === "string" && raw.trim() === "") {
      throw new Error(`Missing argument: ${input.name || `#${i + 1}`}`);
    }
    return coerceArg(interpolate(raw, scope), input.type);
  });

  let value: bigint | undefined;
  if (config.value?.trim()) {
    const resolved = interpolate(config.value, scope);
    value = BigInt(String(resolved).trim());
  }

  try {
    await publicClient.simulateContract({
      address: contract.address as `0x${string}`,
      abi: contract.abi,
      functionName,
      args,
      ...(value !== undefined ? { value } : {}),
      ...(sender ? { account: sender } : {}),
    });
    return {
      ok: false,
      message: `Expectation failed: ${contract.name}.${functionName} succeeded (expected revert)`,
      details: {
        Contract: `${contract.name} @ ${contract.address}`,
        Function: functionName,
        Expected: config.reason ? `revert containing "${config.reason}"` : "revert",
      },
    };
  } catch (error) {
    const message = revertMessage(error);
    const want = config.reason?.trim();
    if (want && !message.toLowerCase().includes(want.toLowerCase())) {
      return {
        ok: false,
        message: `Expectation failed: reverted with "${shortValue(message)}" (expected reason containing "${want}")`,
        details: {
          Contract: `${contract.name} @ ${contract.address}`,
          Function: functionName,
          Revert: message,
          Expected: want,
        },
      };
    }
    return {
      ok: true,
      message: want
        ? `expect revert: ${message} (matched "${want}")`
        : `expect revert: ${message}`,
      details: {
        Contract: `${contract.name} @ ${contract.address}`,
        Function: functionName,
        Revert: message,
        ...(want ? { Expected: want } : {}),
      },
    };
  }
}
