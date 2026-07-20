import "server-only";

import {
  createPublicClient,
  http,
  isAddress,
  type PublicClient,
} from "viem";
import { foundry } from "viem/chains";
import type { AuthContext } from "@/server/auth-context";
import { badRequest } from "@/server/errors";
import { requireNotebook, getNotebookWithBlocks } from "@/server/dal/notebooks";
import { listContracts } from "@/server/dal/contracts";
import { listRecipes } from "@/server/dal/recipes";
import { requireProject } from "@/server/dal/projects";
import { spawnAnvilFork } from "@/lib/anvil-fork";
import { runNotebook, type RunNotebookSummary } from "@/lib/run-notebook";
import { stringifyBigIntSafe } from "@/lib/serialize";
import { blockLabel } from "@/lib/block-label";
import type { ContractEntry, NotebookBlock, Recipe } from "@/lib/types";

export interface SimulateNotebookInput {
  /** Default caller for writes not inside a sender group. */
  as?: unknown;
  /** Overall timeout (default 120s). */
  timeoutMs?: unknown;
}

export interface SimulateNotebookResult {
  ok: boolean;
  mode: "anvil-fork";
  forkChainId: number;
  succeeded: number;
  failed: number;
  skipped: number;
  failedBlockId?: string;
  failedLabel?: string;
  /** Per-block outcomes (BigInt-safe JSON values). */
  results: Record<
    string,
    {
      status: string;
      kind?: string;
      error?: string;
      sender?: string;
      txHash?: string;
      durationMs?: number;
    }
  >;
}

/**
 * Ephemeral anvil --fork-url of the project's RPC, then run the notebook with
 * impersonation (no keys). Viewer+ — dry-run only; the fork is discarded.
 *
 * Narrow exception to CONTRIBUTING invariant #2: the server may speak to an
 * ephemeral local anvil it spawned, never with user keys / never to sign.
 */
export async function simulateNotebookOnFork(
  ctx: AuthContext,
  notebookId: string,
  input: SimulateNotebookInput = {},
): Promise<SimulateNotebookResult> {
  const notebook = await requireNotebook(ctx, notebookId, "viewer");
  const project = await requireProject(ctx, notebook.projectId, "viewer");
  const full = await getNotebookWithBlocks(ctx, notebookId);
  const blocks = full.blocks as NotebookBlock[];
  const contracts = (await listContracts(ctx, project.id)) as ContractEntry[];
  const recipes = (await listRecipes(ctx, project.id)) as Recipe[];

  let defaultSender: `0x${string}` | undefined;
  if (input.as !== undefined && input.as !== null && String(input.as).trim() !== "") {
    const as = String(input.as).trim();
    if (!isAddress(as)) throw badRequest(`Invalid "as" address: ${as}`);
    defaultSender = as as `0x${string}`;
  }

  const timeoutMs = Math.min(
    Math.max(Number(input.timeoutMs) || 120_000, 5_000),
    600_000,
  );

  const spawned = await spawnAnvilFork(project.rpcUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const chain = { ...foundry, id: spawned.chainId };
    const publicClient = createPublicClient({
      chain,
      transport: http(spawned.url),
    }) as PublicClient;

    const summary: RunNotebookSummary = await runNotebook(blocks, {
      publicClient,
      contracts,
      recipes,
      defaultSender,
      forceImpersonate: true,
      signal: controller.signal,
    });

    const results: SimulateNotebookResult["results"] = {};
    for (const [id, result] of Object.entries(summary.results)) {
      results[id] = {
        status: result.status,
        kind: result.kind,
        error: result.error,
        sender: result.sender,
        txHash: result.txHash,
        durationMs: result.durationMs,
      };
    }

    let failedLabel: string | undefined;
    if (summary.failedBlockId) {
      const block = blocks.find((b) => b.id === summary.failedBlockId);
      failedLabel = block
        ? blockLabel(block, contracts, recipes)
        : summary.failedBlockId;
    }

    // Ensure the payload is JSON-safe (no raw BigInts if we expand later).
    return JSON.parse(
      stringifyBigIntSafe({
        ok: summary.ok,
        mode: "anvil-fork",
        forkChainId: spawned.chainId,
        succeeded: summary.succeeded,
        failed: summary.failed,
        skipped: summary.skipped,
        failedBlockId: summary.failedBlockId,
        failedLabel,
        results,
      }),
    ) as SimulateNotebookResult;
  } finally {
    clearTimeout(timer);
    spawned.child.kill("SIGTERM");
  }
}
