import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  hasAnyAccess,
  requireProjectRole,
  type AuthContext,
} from "@/server/auth-context";
import type { WorkspaceRole } from "@/db/schema";
import { badRequest, forbidden, notFound } from "@/server/errors";
import { requireNotebook } from "@/server/dal/notebooks";
import { requireProject } from "@/server/dal/projects";

type RunRow = typeof schema.notebookRuns.$inferSelect;

/** Guard against runaway payloads (same bound as the live run state). */
const MAX_RUN_BYTES = 4 * 1024 * 1024;
/** Saved runs kept per notebook (oldest pruned beyond this). */
const MAX_RUNS_PER_NOTEBOOK = 20;

function metaDto(row: RunRow, notebookTitle: string, ranByName: string | null) {
  return {
    id: row.id,
    notebookId: row.notebookId,
    notebookTitle,
    ranById: row.ranBy,
    ranByName,
    simulated: row.simulated,
    succeeded: row.succeeded,
    failed: row.failed,
    skipped: row.skipped,
    createdAt: row.createdAt.getTime(),
  };
}

/** Run lookup via its notebook's project + effective-role gate. */
async function requireRun(
  ctx: AuthContext,
  id: string,
  min: WorkspaceRole = "viewer",
): Promise<{ run: RunRow; notebookTitle: string; ranByName: string | null }> {
  if (!hasAnyAccess(ctx)) throw forbidden("You are not a member of this workspace");
  const [row] = await db
    .select({
      run: schema.notebookRuns,
      projectId: schema.notebooks.projectId,
      notebookTitle: schema.notebooks.title,
      ranByName: schema.user.name,
    })
    .from(schema.notebookRuns)
    .innerJoin(schema.notebooks, eq(schema.notebooks.id, schema.notebookRuns.notebookId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.notebooks.projectId))
    .leftJoin(schema.user, eq(schema.user.id, schema.notebookRuns.ranBy))
    .where(
      and(
        eq(schema.notebookRuns.id, id),
        eq(schema.projects.workspaceId, ctx.workspaceId),
      ),
    );
  if (!row) throw notFound("Saved run");
  requireProjectRole(ctx, row.projectId, min, "Saved run");
  return { run: row.run, notebookTitle: row.notebookTitle, ranByName: row.ranByName };
}

/**
 * Persist one completed Run-all pass. The state blob is opaque BigInt-safe
 * JSON produced by the client (per-block entries with labels and results).
 */
export async function saveRun(
  ctx: AuthContext,
  notebookId: string,
  data: {
    state?: unknown;
    simulated?: unknown;
    succeeded?: unknown;
    failed?: unknown;
    skipped?: unknown;
  },
) {
  const notebook = await requireNotebook(ctx, notebookId, "editor");
  if (typeof data.state !== "string" || data.state.length === 0) {
    throw badRequest("state must be a non-empty string");
  }
  if (data.state.length > MAX_RUN_BYTES) {
    throw badRequest("Run output too large to save");
  }
  const asCount = (v: unknown) => Math.max(0, Math.trunc(Number(v)) || 0);
  const row: RunRow = {
    id: crypto.randomUUID(),
    notebookId,
    ranBy: ctx.userId,
    simulated: data.simulated === true,
    succeeded: asCount(data.succeeded),
    failed: asCount(data.failed),
    skipped: asCount(data.skipped),
    state: data.state,
    createdAt: new Date(),
  };
  await db.insert(schema.notebookRuns).values(row);
  // Bound growth: drop the oldest saved runs beyond the per-notebook cap.
  db.run(sql`
    DELETE FROM notebook_runs
    WHERE notebook_id = ${notebookId}
      AND id NOT IN (
        SELECT id FROM notebook_runs
        WHERE notebook_id = ${notebookId}
        ORDER BY created_at DESC
        LIMIT ${MAX_RUNS_PER_NOTEBOOK}
      )
  `);
  return metaDto(row, notebook.title, null);
}

/** All saved runs across the project's notebooks, newest first (meta only). */
export async function listRuns(ctx: AuthContext, projectId: string) {
  await requireProject(ctx, projectId);
  const rows = await db
    .select({
      run: schema.notebookRuns,
      notebookTitle: schema.notebooks.title,
      ranByName: schema.user.name,
    })
    .from(schema.notebookRuns)
    .innerJoin(schema.notebooks, eq(schema.notebooks.id, schema.notebookRuns.notebookId))
    .leftJoin(schema.user, eq(schema.user.id, schema.notebookRuns.ranBy))
    .where(eq(schema.notebooks.projectId, projectId))
    .orderBy(desc(schema.notebookRuns.createdAt))
    .limit(100);
  return rows.map((r) => metaDto(r.run, r.notebookTitle, r.ranByName));
}

export async function getRun(ctx: AuthContext, id: string) {
  const { run, notebookTitle, ranByName } = await requireRun(ctx, id);
  return { ...metaDto(run, notebookTitle, ranByName), state: run.state };
}

export async function deleteRun(ctx: AuthContext, id: string): Promise<void> {
  await requireRun(ctx, id, "editor");
  await db.delete(schema.notebookRuns).where(eq(schema.notebookRuns.id, id));
}
