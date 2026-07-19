/**
 * Static integration handoff brief for a notebook: call sequence, expected
 * events, and {{variable}} wiring — so frontend / backend / ops can integrate
 * without clicking every cell. JSON-serializable (no BigInts).
 */
import {
  eventSignature,
  functionSignature,
  getEvents,
  getFunctions,
} from "@/lib/abi";
import { blockLabel, executionOrder } from "@/lib/block-label";
import { extractVariableRefs } from "@/lib/variables";
import type {
  CallConfig,
  ContractEntry,
  EventConfig,
  ExpectConfig,
  IfConfig,
  MarkdownConfig,
  NotebookBlock,
  RpcConfig,
  SenderConfig,
  VariableConfig,
} from "@/lib/types";
import type { AbiEvent, AbiFunction, AbiParameter } from "viem";

export interface HandoffArg {
  name: string;
  type: string;
  value: string;
}

export interface HandoffExpectEvent {
  eventName: string;
  /** Address-book name filter (expect-event), when set */
  contract?: string;
  fromVariable?: string;
  signature?: string;
  inputs?: HandoffEventInput[];
}

export interface HandoffStep {
  blockId: string;
  type: NotebookBlock["type"];
  label: string;
  role: "frontend" | "backend" | "ops" | "intent" | "control";
  contract?: string;
  address?: string | null;
  signature?: string;
  args?: HandoffArg[];
  /** Payable wei string (may be {{var}}) */
  value?: string;
  outputVariable?: string | null;
  runWhen?: string | null;
  /** kind=condition expect / if group */
  condition?: string;
  expectEvent?: HandoffExpectEvent;
  /** kind=revert */
  expectRevert?: {
    signature?: string;
    reason?: string;
  };
}

export interface HandoffEventInput {
  name?: string;
  type: string;
  indexed?: boolean;
}

export interface HandoffEvent {
  source: "expect" | "event-block";
  eventName: string;
  contract?: string;
  address?: string | null;
  signature?: string;
  inputs?: HandoffEventInput[];
  fromBlockId: string;
  fromVariable?: string;
}

export interface HandoffVariable {
  name: string;
  producedByBlockId?: string;
  /** Block ids whose config references {{name}} (or a path under it). */
  consumedBy: string[];
  /** Variable-block constant, when applicable */
  constantValue?: string;
}

export interface NotebookHandoffBrief {
  title: string;
  description: string | null;
  chainId: number;
  /** First markdown heading / line, when present */
  intent: string | null;
  steps: HandoffStep[];
  events: HandoffEvent[];
  variables: HandoffVariable[];
  contracts: Array<{ name: string; address: string }>;
}

export interface BuildHandoffMeta {
  title: string;
  description?: string | null;
  chainId: number;
}

function rootVarName(ref: string): string {
  return ref.replace(/\[(\d+)\]/g, ".$1").split(".")[0] ?? ref;
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out);
    }
  }
}

/** Root variable names referenced anywhere in a block's config / guards. */
export function variableRootsInBlock(block: NotebookBlock): string[] {
  const texts: string[] = [];
  collectStrings(block.config, texts);
  if (block.runWhen) texts.push(block.runWhen);
  const roots = new Set<string>();
  for (const text of texts) {
    for (const ref of extractVariableRefs(text)) {
      const root = rootVarName(ref.trim());
      if (root) roots.add(root);
    }
  }
  return [...roots];
}

function findFn(
  contract: ContractEntry | undefined,
  name: string | undefined,
): AbiFunction | undefined {
  if (!contract || !name) return undefined;
  return getFunctions(contract.abi).find((f) => f.name === name);
}

function findEvent(
  contracts: ContractEntry[],
  eventName: string,
  contractName?: string,
): { contract?: ContractEntry; event?: AbiEvent } {
  const pool = contractName
    ? contracts.filter((c) => c.name === contractName)
    : contracts;
  for (const c of pool) {
    const event = getEvents(c.abi).find((e) => e.name === eventName);
    if (event) return { contract: c, event };
  }
  if (contractName) {
    // Name filter missed — still try any ABI that defines the event.
    for (const c of contracts) {
      const event = getEvents(c.abi).find((e) => e.name === eventName);
      if (event) return { contract: c, event };
    }
  }
  return {};
}

function eventInputs(event: AbiEvent | undefined): HandoffEventInput[] | undefined {
  if (!event) return undefined;
  return event.inputs.map((i: AbiParameter & { indexed?: boolean }) => ({
    name: i.name || undefined,
    type: i.type,
    indexed: i.indexed || undefined,
  }));
}

function callArgs(fn: AbiFunction | undefined, values: string[] | undefined): HandoffArg[] {
  const inputs = fn?.inputs ?? [];
  const args = values ?? [];
  const n = Math.max(inputs.length, args.length);
  const out: HandoffArg[] = [];
  for (let i = 0; i < n; i++) {
    const input = inputs[i];
    out.push({
      name: input?.name || `arg${i}`,
      type: input?.type ?? "unknown",
      value: args[i] ?? "",
    });
  }
  return out;
}

function markdownIntent(blocks: NotebookBlock[]): string | null {
  for (const block of blocks) {
    if (block.type !== "markdown") continue;
    const text = (block.config as MarkdownConfig).text ?? "";
    const firstLine = text
      .split("\n")
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find((l) => l.length > 0);
    if (firstLine) return firstLine;
  }
  return null;
}

function stepRole(block: NotebookBlock): HandoffStep["role"] {
  switch (block.type) {
    case "markdown":
      return "intent";
    case "read":
    case "write":
    case "rpc":
      return "frontend";
    case "event":
    case "expect":
      return "backend";
    case "sender":
    case "if":
    case "variable":
    case "recipe":
      return "control";
    default:
      return "ops";
  }
}

function usedContracts(
  blocks: NotebookBlock[],
  contracts: ContractEntry[],
): Array<{ name: string; address: string }> {
  const ids = new Set<string>();
  for (const block of blocks) {
    const cfg = block.config as { contractId?: string };
    if (cfg.contractId) ids.add(cfg.contractId);
  }
  // Also resolve expect-event name filters.
  for (const block of blocks) {
    if (block.type !== "expect") continue;
    const cfg = block.config as ExpectConfig;
    if (cfg.kind === "event" && cfg.contract) {
      const c = contracts.find((x) => x.name === cfg.contract);
      if (c) ids.add(c.id);
    }
  }
  return contracts
    .filter((c) => ids.has(c.id))
    .map((c) => ({ name: c.name, address: c.address }));
}

/**
 * Build a static handoff brief from the notebook definition + address book.
 * Does not require a run — observed receipt events stay out of this MVP.
 */
export function buildNotebookHandoffBrief(
  blocks: NotebookBlock[],
  contracts: ContractEntry[],
  meta: BuildHandoffMeta,
): NotebookHandoffBrief {
  const ordered = executionOrder(blocks);
  const steps: HandoffStep[] = [];
  const events: HandoffEvent[] = [];

  for (const block of ordered) {
    const label = blockLabel(block, contracts);
    const base: HandoffStep = {
      blockId: block.id,
      type: block.type,
      label,
      role: stepRole(block),
      outputVariable: block.outputVariable,
      runWhen: block.runWhen ?? null,
    };

    if (block.type === "markdown") {
      const text = ((block.config as MarkdownConfig).text ?? "").trim();
      if (!text) continue;
      steps.push(base);
      continue;
    }

    if (block.type === "read" || block.type === "write") {
      const config = block.config as CallConfig;
      const contract = contracts.find((c) => c.id === config.contractId);
      const fn = findFn(contract, config.functionName);
      steps.push({
        ...base,
        contract: contract?.name,
        address: contract?.address ?? null,
        signature: fn ? functionSignature(fn) : config.functionName || undefined,
        args: callArgs(fn, config.args),
        value: config.value,
      });
      continue;
    }

    if (block.type === "rpc") {
      const config = block.config as RpcConfig;
      steps.push({
        ...base,
        signature: config.method || undefined,
        args: (config.params ?? []).map((value, i) => ({
          name: `param${i}`,
          type: "string",
          value,
        })),
      });
      continue;
    }

    if (block.type === "event") {
      const config = block.config as EventConfig;
      const contract = contracts.find((c) => c.id === config.contractId);
      const { event } = findEvent(
        contracts,
        config.eventName,
        contract?.name,
      );
      const inputs = eventInputs(event);
      const signature = event ? eventSignature(event) : config.eventName || undefined;
      steps.push({
        ...base,
        contract: contract?.name,
        address: contract?.address ?? null,
        signature,
        args: (config.filters ?? []).map((value, i) => {
          const input = event?.inputs[i];
          return {
            name: input?.name || `topic${i}`,
            type: input?.type ?? "bytes32",
            value,
          };
        }),
      });
      if (config.eventName) {
        events.push({
          source: "event-block",
          eventName: config.eventName,
          contract: contract?.name,
          address: contract?.address ?? null,
          signature,
          inputs,
          fromBlockId: block.id,
          fromVariable: block.outputVariable ?? undefined,
        });
      }
      continue;
    }

    if (block.type === "expect") {
      const config = block.config as ExpectConfig;
      if (config.kind === "condition") {
        steps.push({
          ...base,
          condition: config.condition,
        });
      } else if (config.kind === "event") {
        const eventName = config.eventName?.trim() ?? "";
        const resolved = findEvent(contracts, eventName, config.contract);
        const signature = resolved.event
          ? eventSignature(resolved.event)
          : eventName || undefined;
        const inputs = eventInputs(resolved.event);
        const expectEvent: HandoffExpectEvent = {
          eventName,
          contract: config.contract,
          fromVariable: config.fromVariable,
          signature,
          inputs,
        };
        steps.push({
          ...base,
          contract: config.contract ?? resolved.contract?.name,
          address: resolved.contract?.address ?? null,
          signature,
          expectEvent,
        });
        if (eventName) {
          events.push({
            source: "expect",
            eventName,
            contract: config.contract ?? resolved.contract?.name,
            address: resolved.contract?.address ?? null,
            signature,
            inputs,
            fromBlockId: block.id,
            fromVariable: config.fromVariable,
          });
        }
      } else if (config.kind === "revert") {
        const contract = contracts.find((c) => c.id === config.contractId);
        const fn = findFn(contract, config.functionName);
        steps.push({
          ...base,
          contract: contract?.name,
          address: contract?.address ?? null,
          signature: fn ? functionSignature(fn) : config.functionName,
          args: callArgs(fn, config.args),
          value: config.value,
          expectRevert: {
            signature: fn ? functionSignature(fn) : config.functionName,
            reason: config.reason,
          },
        });
      } else {
        steps.push(base);
      }
      continue;
    }

    if (block.type === "variable") {
      const config = block.config as VariableConfig;
      steps.push({
        ...base,
        label: config.name ? `${config.name} = ${config.value}` : base.label,
      });
      continue;
    }

    if (block.type === "sender") {
      const address = (block.config as SenderConfig).address;
      steps.push({
        ...base,
        address: address || null,
      });
      continue;
    }

    if (block.type === "if") {
      steps.push({
        ...base,
        condition: (block.config as IfConfig).condition,
      });
      continue;
    }

    // recipe / unknown — keep as a control step
    steps.push(base);
  }

  // Variable wiring
  const produced = new Map<string, string>();
  for (const block of ordered) {
    if (block.outputVariable) produced.set(block.outputVariable, block.id);
    if (block.type === "variable") {
      const name = (block.config as VariableConfig).name;
      if (name) produced.set(name, block.id);
    }
  }

  const consumed = new Map<string, Set<string>>();
  for (const block of ordered) {
    for (const root of variableRootsInBlock(block)) {
      let set = consumed.get(root);
      if (!set) {
        set = new Set();
        consumed.set(root, set);
      }
      set.add(block.id);
    }
  }

  const varNames = new Set([...produced.keys(), ...consumed.keys()]);
  const variables: HandoffVariable[] = [...varNames]
    .sort()
    .map((name) => {
      const producerId = produced.get(name);
      const producer = producerId
        ? ordered.find((b) => b.id === producerId)
        : undefined;
      const constantValue =
        producer?.type === "variable"
          ? (producer.config as VariableConfig).value
          : undefined;
      return {
        name,
        producedByBlockId: producerId,
        consumedBy: [...(consumed.get(name) ?? [])],
        constantValue,
      };
    });

  // Deduplicate event catalog by source+name+contract+block
  const seenEvents = new Set<string>();
  const uniqueEvents = events.filter((e) => {
    const key = `${e.source}|${e.eventName}|${e.contract ?? ""}|${e.fromBlockId}`;
    if (seenEvents.has(key)) return false;
    seenEvents.add(key);
    return true;
  });

  return {
    title: meta.title,
    description: meta.description ?? null,
    chainId: meta.chainId,
    intent: markdownIntent(ordered),
    steps,
    events: uniqueEvents,
    variables,
    contracts: usedContracts(ordered, contracts),
  };
}

/** Frontend-oriented slice: reads/writes/rpc (+ intent). */
export function handoffFrontendSteps(brief: NotebookHandoffBrief): HandoffStep[] {
  return brief.steps.filter(
    (s) => s.role === "frontend" || s.role === "intent",
  );
}

/** Backend-oriented slice: events catalog + expect / event steps. */
export function handoffBackendSteps(brief: NotebookHandoffBrief): HandoffStep[] {
  return brief.steps.filter((s) => s.role === "backend");
}
