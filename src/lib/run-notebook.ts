/**
 * Shared notebook runner used by the editor (Run all) and the CLI
 * (`chainstitch run`). Keeps batch semantics identical: if soft-skips,
 * expect fails hard, runWhen guards, sender impersonation, recipes.
 */

import { isAddress, type PublicClient } from "viem";
import type { Config } from "wagmi";
import {
  blockLabel,
  constantScope,
  executionOrder,
  isBlockConfigured,
  isRunnableType,
} from "@/lib/block-label";
import { evaluateCondition } from "@/lib/condition";
import { runBlock, shortError, type RunContext, type TracedError } from "@/lib/engine";
import {
  evaluateExpectCondition,
  evaluateExpectEvent,
  evaluateExpectRevert,
} from "@/lib/expect";
import { interpolate } from "@/lib/variables";
import type {
  BlockResult,
  ContractEntry,
  DecodedEventEntry,
  ExpectConfig,
  IfConfig,
  NotebookBlock,
  Recipe,
  RecipeBlockConfig,
  SenderConfig,
  VariableConfig,
} from "@/lib/types";

export interface RunNotebookOptions {
  publicClient: PublicClient;
  contracts: ContractEntry[];
  /** Seed scope (e.g. live notebook scope). Variable blocks merge in as they run. */
  initialScope?: Record<string, unknown>;
  wagmiConfig?: Config;
  account?: `0x${string}`;
  mode?: "execute" | "simulate";
  /** Caller for simulate-all-as / default write sender. */
  defaultSender?: `0x${string}`;
  /**
   * Stateful dry-run: every write is sent via anvil_impersonateAccount
   * (sender group address, else defaultSender). Ignores sender-group
   * simulateOnly. Requires an anvil (or Hardhat) RPC — use with
   * evm_snapshot/revert or an ephemeral fork so the chain tip stays clean.
   */
  forceImpersonate?: boolean;
  localSigner?: RunContext["localSigner"];
  /** Recipe cells need this; without it they fail with a clear error. */
  recipes?: Recipe[];
  onBlockResult?: (blockId: string, result: BlockResult) => void;
  signal?: AbortSignal;
}

export interface RunNotebookSummary {
  ok: boolean;
  failedBlockId?: string;
  results: Record<string, BlockResult>;
  scope: Record<string, unknown>;
  succeeded: number;
  failed: number;
  skipped: number;
}

function emit(
  results: Record<string, BlockResult>,
  onBlockResult: RunNotebookOptions["onBlockResult"],
  id: string,
  result: BlockResult,
) {
  results[id] = result;
  onBlockResult?.(id, result);
}

function senderScopeFor(
  block: NotebookBlock,
  list: NotebookBlock[],
  scope: Record<string, unknown>,
): { address: `0x${string}`; simulateOnly: boolean } | null {
  if (!block.parentId) return null;
  const parent = list.find((b) => b.id === block.parentId);
  if (!parent || parent.type !== "sender") return null;
  const cfg = parent.config as SenderConfig;
  const resolved = String(interpolate(cfg.address, scope));
  if (!isAddress(resolved)) {
    throw new Error(`Sender group has an invalid address: "${cfg.address}"`);
  }
  return { address: resolved as `0x${string}`, simulateOnly: cfg.simulateOnly !== false };
}

async function executeRunnable(
  block: NotebookBlock,
  opts: RunNotebookOptions,
  scope: Record<string, unknown>,
  list: NotebookBlock[],
  outerSender: { address: `0x${string}`; simulateOnly: boolean } | null,
  batchOpts?: { mode?: "execute" | "simulate"; sender?: `0x${string}` },
): Promise<BlockResult> {
  const started = performance.now();
  try {
    let mode = batchOpts?.mode ?? opts.mode ?? "execute";
    let sender = batchOpts?.sender ?? opts.defaultSender;
    let impersonate = false;

    const group = senderScopeFor(block, list, scope) ?? outerSender;
    if (group) {
      sender = group.address;
      if (mode === "execute" && !group.simulateOnly) impersonate = true;
      if (mode === "execute" && group.simulateOnly && block.type === "write") {
        mode = "simulate";
      }
    }

    // Stateful dry-run: always impersonate writes (multi-step state accumulates).
    if (opts.forceImpersonate && block.type === "write") {
      mode = "execute";
      impersonate = true;
      if (!sender) {
        throw new Error(
          "Stateful simulate needs a caller — set Simulate-all-as or wrap writes in a sender group",
        );
      }
    }

    const outcome = await runBlock(block, {
      publicClient: opts.publicClient,
      contracts: opts.contracts,
      scope,
      wagmiConfig: opts.wagmiConfig,
      account: opts.account,
      mode,
      sender,
      impersonate,
      localSigner: opts.localSigner,
    });

    return {
      status: "success",
      value: outcome.value,
      txHash: outcome.txHash,
      // Treat fork/snapshot dry-runs as simulated for saved-run badges.
      simulated: opts.forceImpersonate ? true : outcome.simulated,
      kind: opts.forceImpersonate && outcome.kind?.includes("impersonated")
        ? "Write (impersonated on fork — dry-run)"
        : outcome.kind,
      sender: outcome.sender,
      blockNumber: outcome.blockNumber,
      details: outcome.details,
      txDetails: outcome.txDetails,
      events: outcome.events,
      durationMs: Math.round(performance.now() - started),
      ranAt: Date.now(),
    };
  } catch (e) {
    return {
      status: "error",
      error: shortError(e),
      trace: (e as TracedError).trace,
      durationMs: Math.round(performance.now() - started),
      ranAt: Date.now(),
    };
  }
}

async function runExpectBlock(
  block: NotebookBlock,
  opts: RunNotebookOptions,
  scope: Record<string, unknown>,
  lastWriteEvents: DecodedEventEntry[] | null,
  list: NotebookBlock[],
): Promise<BlockResult> {
  const started = performance.now();
  const config = block.config as ExpectConfig;
  try {
    let outcome;
    if (config.kind === "condition") {
      outcome = evaluateExpectCondition(config, scope);
    } else if (config.kind === "event") {
      outcome = evaluateExpectEvent(config, scope, lastWriteEvents);
    } else if (config.kind === "revert") {
      let sender: `0x${string}` | undefined;
      try {
        sender = senderScopeFor(block, list, scope)?.address ?? opts.defaultSender;
      } catch (e) {
        return {
          status: "error",
          error: shortError(e),
          durationMs: Math.round(performance.now() - started),
          ranAt: Date.now(),
        };
      }
      outcome = await evaluateExpectRevert(
        config,
        scope,
        opts.contracts,
        opts.publicClient,
        sender,
      );
    } else {
      outcome = { ok: false, message: "Expectation failed: unknown kind" };
    }

    if (outcome.ok) {
      return {
        status: "success",
        value: true,
        kind: "Expectation passed",
        details: outcome.details,
        durationMs: Math.round(performance.now() - started),
        ranAt: Date.now(),
      };
    }
    return {
      status: "error",
      error: outcome.message,
      kind: "Expectation failed",
      details: outcome.details,
      durationMs: Math.round(performance.now() - started),
      ranAt: Date.now(),
    };
  } catch (e) {
    return {
      status: "error",
      error: shortError(e),
      kind: "Expectation failed",
      durationMs: Math.round(performance.now() - started),
      ranAt: Date.now(),
    };
  }
}

function evaluateIf(
  block: NotebookBlock,
  scope: Record<string, unknown>,
): BlockResult & { verdict: boolean | null } {
  const condition = (block.config as IfConfig).condition ?? "";
  const started = performance.now();
  try {
    const { result, resolved } = evaluateCondition(condition, scope);
    return {
      status: "success",
      value: result,
      kind: "Condition check",
      details: { Condition: condition, Evaluation: resolved },
      durationMs: Math.round(performance.now() - started),
      ranAt: Date.now(),
      verdict: result,
    };
  } catch (e) {
    return {
      status: "error",
      error: shortError(e),
      durationMs: Math.round(performance.now() - started),
      ranAt: Date.now(),
      verdict: null,
    };
  }
}

async function runRecipeCell(
  block: NotebookBlock,
  opts: RunNotebookOptions,
  scope: Record<string, unknown>,
  notebookBlocks: NotebookBlock[],
  batchOpts?: { mode?: "execute" | "simulate"; sender?: `0x${string}` },
): Promise<BlockResult> {
  const started = performance.now();
  const recipeId = (block.config as RecipeBlockConfig).recipeId;
  if (!recipeId) {
    return {
      status: "error",
      error: "Select a recipe for this block",
      durationMs: Math.round(performance.now() - started),
      ranAt: Date.now(),
    };
  }
  const recipe = opts.recipes?.find((r) => r.id === recipeId);
  if (!recipe) {
    return {
      status: "error",
      error: opts.recipes
        ? "Recipe not found — it may have been deleted"
        : "Recipe cells need a project recipe library (not available in the CLI)",
      durationMs: Math.round(performance.now() - started),
      ranAt: Date.now(),
    };
  }

  let outerSender: { address: `0x${string}`; simulateOnly: boolean } | null = null;
  try {
    outerSender = senderScopeFor(block, notebookBlocks, scope);
  } catch (e) {
    return {
      status: "error",
      error: shortError(e),
      durationMs: Math.round(performance.now() - started),
      ranAt: Date.now(),
    };
  }

  const steps = executionOrder(recipe.blocks);
  const rows: Record<string, unknown> = {};
  const skip = new Map<string, string>();
  let ran = 0;
  let skipped = 0;
  let error: string | null = null;

  for (const [index, step] of steps.entries()) {
    if (opts.signal?.aborted) {
      error = "Aborted";
      break;
    }
    const label = `${index + 1}. ${blockLabel(step, opts.contracts)}`;
    const skipReason = skip.get(step.id);
    if (skipReason) {
      rows[label] = skipReason;
      skipped++;
      continue;
    }
    if (step.type === "variable") {
      const { name, value } = step.config as VariableConfig;
      if (name) {
        scope[name] = value;
        rows[label] = value;
      }
      continue;
    }
    if (step.type === "markdown" || step.type === "sender") continue;
    if (step.type === "expect") {
      const result = await runExpectBlock(step, opts, scope, null, recipe.blocks);
      if (result.status === "error") {
        error = result.error ?? "expectation failed";
        rows[label] = `error: ${error}`;
        break;
      }
      rows[label] = result.kind ?? "ok";
      ran++;
      continue;
    }
    if (step.type === "if") {
      if (!isBlockConfigured(step)) {
        rows[label] = "skipped — condition not set";
        skipped++;
        for (const child of recipe.blocks.filter((b) => b.parentId === step.id)) {
          skip.set(child.id, "skipped — condition group not configured");
        }
        continue;
      }
      try {
        const verdict = evaluateCondition(
          (step.config as IfConfig).condition ?? "",
          scope,
        );
        rows[label] = verdict.resolved;
        if (!verdict.result) {
          for (const child of recipe.blocks.filter((b) => b.parentId === step.id)) {
            skip.set(child.id, "skipped — condition was false");
          }
        }
      } catch (e) {
        error = shortError(e);
        rows[label] = `error: ${error}`;
        break;
      }
      continue;
    }
    if (!isRunnableType(step.type)) continue;
    if (!isBlockConfigured(step)) {
      rows[label] = "skipped — step not configured";
      skipped++;
      continue;
    }
    if (step.runWhen?.trim()) {
      try {
        const verdict = evaluateCondition(step.runWhen, scope);
        if (!verdict.result) {
          rows[label] = `skipped — run when: ${verdict.resolved}`;
          skipped++;
          continue;
        }
      } catch (e) {
        error = `run when: ${shortError(e)}`;
        rows[label] = `error: ${error}`;
        break;
      }
    }
    const result = await executeRunnable(
      step,
      opts,
      scope,
      recipe.blocks,
      outerSender,
      batchOpts,
    );
    if (result.status === "error") {
      error = result.error ?? "step failed";
      rows[label] = `error: ${error}`;
      break;
    }
    if (step.outputVariable) scope[step.outputVariable] = result.value;
    rows[label] = result.txHash ? `tx ${result.txHash}` : result.value;
    ran++;
  }

  const durationMs = Math.round(performance.now() - started);
  if (error) {
    return {
      status: "error",
      error,
      kind: `Recipe "${recipe.name}"`,
      details: rows,
      durationMs,
      ranAt: Date.now(),
    };
  }
  return {
    status: "success",
    value: `${ran} ${ran === 1 ? "step" : "steps"} ran${skipped ? `, ${skipped} skipped` : ""}`,
    kind: `Recipe "${recipe.name}"`,
    details: rows,
    durationMs,
    ranAt: Date.now(),
  };
}

/**
 * Run every block in execution order. Mutates a local scope copy; returns
 * per-block results and aggregate counters. Stops on the first error
 * (including unmet expects).
 */
export async function runNotebook(
  blocks: NotebookBlock[],
  opts: RunNotebookOptions,
): Promise<RunNotebookSummary> {
  const scope: Record<string, unknown> = {
    ...constantScope(blocks),
    ...(opts.initialScope ?? {}),
  };
  // Variable blocks in the notebook also appear in constantScope; keep them.
  const results: Record<string, BlockResult> = {};
  const skipped = new Set<string>();
  let failedBlockId: string | undefined;
  let lastWriteEvents: DecodedEventEntry[] | null = null;

  const batchOpts =
    opts.forceImpersonate && opts.defaultSender
      ? ({ mode: "execute" as const, sender: opts.defaultSender })
      : opts.forceImpersonate
        ? ({ mode: "execute" as const })
        : opts.defaultSender
          ? ({ mode: "simulate" as const, sender: opts.defaultSender })
          : opts.mode === "simulate"
            ? ({ mode: "simulate" as const })
            : undefined;

  for (const block of executionOrder(blocks)) {
    if (opts.signal?.aborted) {
      failedBlockId = block.id;
      emit(results, opts.onBlockResult, block.id, {
        status: "error",
        error: "Aborted",
        ranAt: Date.now(),
      });
      break;
    }
    if (skipped.has(block.id)) continue;

    if (block.type === "variable") {
      const { name, value } = block.config as VariableConfig;
      if (name) scope[name] = value;
      continue;
    }
    if (block.type === "markdown" || block.type === "sender") continue;

    if (block.type === "if") {
      if (!isBlockConfigured(block)) {
        emit(results, opts.onBlockResult, block.id, {
          status: "skipped",
          kind: "Skipped — configure this cell first",
          ranAt: Date.now(),
        });
        for (const child of blocks.filter((b) => b.parentId === block.id)) {
          skipped.add(child.id);
          emit(results, opts.onBlockResult, child.id, {
            status: "skipped",
            kind: "Skipped — configure the condition group first",
            ranAt: Date.now(),
          });
        }
        continue;
      }
      const ifResult = evaluateIf(block, scope);
      const { verdict, ...result } = ifResult;
      emit(results, opts.onBlockResult, block.id, result);
      if (verdict === null) {
        failedBlockId = block.id;
        break;
      }
      if (!verdict) {
        for (const child of blocks.filter((b) => b.parentId === block.id)) {
          skipped.add(child.id);
          if (isRunnableType(child.type) || child.type === "recipe" || child.type === "expect") {
            emit(results, opts.onBlockResult, child.id, {
              status: "skipped",
              kind: "Skipped — condition was false",
              ranAt: Date.now(),
            });
          }
        }
      }
      continue;
    }

    if (block.type === "expect") {
      if (!isBlockConfigured(block)) {
        emit(results, opts.onBlockResult, block.id, {
          status: "skipped",
          kind: "Skipped — configure this cell first",
          ranAt: Date.now(),
        });
        continue;
      }
      if (block.runWhen?.trim()) {
        try {
          const gate = evaluateCondition(block.runWhen, scope);
          if (!gate.result) {
            emit(results, opts.onBlockResult, block.id, {
              status: "skipped",
              kind: `Skipped — run when: ${gate.resolved}`,
              ranAt: Date.now(),
            });
            continue;
          }
        } catch (e) {
          emit(results, opts.onBlockResult, block.id, {
            status: "error",
            error: `run when: ${shortError(e)}`,
            ranAt: Date.now(),
          });
          failedBlockId = block.id;
          break;
        }
      }
      emit(results, opts.onBlockResult, block.id, { status: "running" });
      const result = await runExpectBlock(
        block,
        opts,
        scope,
        lastWriteEvents,
        blocks,
      );
      emit(results, opts.onBlockResult, block.id, result);
      if (result.status === "error") {
        failedBlockId = block.id;
        break;
      }
      continue;
    }

    if (block.type === "recipe") {
      if (!isBlockConfigured(block)) {
        emit(results, opts.onBlockResult, block.id, {
          status: "skipped",
          kind: "Skipped — configure this cell first",
          ranAt: Date.now(),
        });
        continue;
      }
      emit(results, opts.onBlockResult, block.id, { status: "running" });
      const result = await runRecipeCell(block, opts, scope, blocks, batchOpts);
      emit(results, opts.onBlockResult, block.id, result);
      if (result.status === "error") {
        failedBlockId = block.id;
        break;
      }
      continue;
    }

    if (!isRunnableType(block.type)) continue;

    if (!isBlockConfigured(block)) {
      emit(results, opts.onBlockResult, block.id, {
        status: "skipped",
        kind: "Skipped — configure this cell first",
        ranAt: Date.now(),
      });
      continue;
    }

    if (block.runWhen?.trim()) {
      try {
        const gate = evaluateCondition(block.runWhen, scope);
        if (!gate.result) {
          emit(results, opts.onBlockResult, block.id, {
            status: "skipped",
            kind: `Skipped — run when: ${gate.resolved}`,
            ranAt: Date.now(),
          });
          continue;
        }
      } catch (e) {
        emit(results, opts.onBlockResult, block.id, {
          status: "error",
          error: `run when: ${shortError(e)}`,
          ranAt: Date.now(),
        });
        failedBlockId = block.id;
        break;
      }
    }

    emit(results, opts.onBlockResult, block.id, { status: "running" });
    const result = await executeRunnable(
      block,
      opts,
      scope,
      blocks,
      null,
      batchOpts,
    );
    emit(results, opts.onBlockResult, block.id, result);
    if (result.status === "error") {
      failedBlockId = block.id;
      break;
    }
    if (block.outputVariable) scope[block.outputVariable] = result.value;
    if (block.type === "write" && result.events) {
      lastWriteEvents = result.events;
    }
  }

  let succeeded = 0;
  let failed = 0;
  let skippedCount = 0;
  for (const r of Object.values(results)) {
    if (r.status === "success") succeeded++;
    else if (r.status === "error") failed++;
    else if (r.status === "skipped") skippedCount++;
  }

  return {
    ok: !failedBlockId,
    failedBlockId,
    results,
    scope,
    succeeded,
    failed,
    skipped: skippedCount,
  };
}
