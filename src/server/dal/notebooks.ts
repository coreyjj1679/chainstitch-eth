import "server-only";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  hasAnyAccess,
  requireProjectRole,
  type AuthContext,
} from "@/server/auth-context";
import type { WorkspaceRole } from "@/db/schema";
import { badRequest, forbidden, notFound } from "@/server/errors";
import { requireProject } from "@/server/dal/projects";

type NotebookRow = typeof schema.notebooks.$inferSelect;

function toDto(row: NotebookRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    position: row.position,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** Notebook lookup via its project + effective-role gate on that project. */
export async function requireNotebook(
  ctx: AuthContext,
  id: string,
  min: WorkspaceRole = "viewer",
): Promise<NotebookRow> {
  if (!hasAnyAccess(ctx)) throw forbidden("You are not a member of this workspace");
  const [row] = await db
    .select({ notebook: schema.notebooks })
    .from(schema.notebooks)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.notebooks.projectId))
    .where(
      and(eq(schema.notebooks.id, id), eq(schema.projects.workspaceId, ctx.workspaceId)),
    );
  if (!row) throw notFound("Notebook");
  requireProjectRole(ctx, row.notebook.projectId, min, "Notebook");
  return row.notebook;
}

export async function listNotebooks(ctx: AuthContext, projectId: string) {
  await requireProject(ctx, projectId);
  const rows = await db
    .select()
    .from(schema.notebooks)
    .where(eq(schema.notebooks.projectId, projectId))
    .orderBy(asc(schema.notebooks.position), desc(schema.notebooks.updatedAt));
  return rows.map(toDto);
}

export async function getNotebookWithBlocks(ctx: AuthContext, id: string) {
  const notebook = await requireNotebook(ctx, id);
  const blockRows = await db
    .select()
    .from(schema.blocks)
    .where(eq(schema.blocks.notebookId, id))
    .orderBy(asc(schema.blocks.order));
  return {
    ...toDto(notebook),
    blocks: blockRows.map((b) => ({
      id: b.id,
      type: b.type,
      config: JSON.parse(b.config) as unknown,
      outputVariable: b.outputVariable,
      parentId: b.parentId ?? null,
      runWhen: b.runWhen ?? null,
    })),
  };
}

export async function createNotebook(
  ctx: AuthContext,
  projectId: string,
  data: { title?: unknown; description?: unknown },
) {
  await requireProject(ctx, projectId, "editor");
  if (!data.title) throw badRequest("title is required");
  const now = new Date();
  const [{ maxPos }] = await db
    .select({
      maxPos: sql<number | null>`max(${schema.notebooks.position})`,
    })
    .from(schema.notebooks)
    .where(eq(schema.notebooks.projectId, projectId));
  const row: NotebookRow = {
    id: crypto.randomUUID(),
    projectId,
    title: String(data.title),
    description: data.description ? String(data.description) : null,
    position: (maxPos ?? -1) + 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(schema.notebooks).values(row);
  return toDto(row);
}

export async function updateNotebook(
  ctx: AuthContext,
  id: string,
  body: { title?: unknown; description?: unknown },
) {
  const before = await requireNotebook(ctx, id, "editor");
  const blocksJson = await currentBlocksJson(id);
  await ensureBaselineVersion(before, blocksJson);
  const updates: Partial<NotebookRow> = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = String(body.title);
  if (body.description !== undefined)
    updates.description = body.description ? String(body.description) : null;
  await db.update(schema.notebooks).set(updates).where(eq(schema.notebooks.id, id));
  const after = await requireNotebook(ctx, id);
  await recordVersion(after, blocksJson, ctx.userId);
  return toDto(after);
}

export async function deleteNotebook(ctx: AuthContext, id: string): Promise<void> {
  await requireNotebook(ctx, id, "editor");
  await db.delete(schema.notebooks).where(eq(schema.notebooks.id, id));
}

/**
 * Persist sidebar order for a project's notebooks. `orderedIds` must be a
 * permutation of every notebook id in the project (no extras, no omissions).
 */
export async function reorderNotebooks(
  ctx: AuthContext,
  projectId: string,
  orderedIds: unknown,
): Promise<ReturnType<typeof toDto>[]> {
  await requireProject(ctx, projectId, "editor");
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw badRequest("orderedIds must be a non-empty array");
  }
  const ids = orderedIds.map((id) => {
    if (typeof id !== "string" || !id) throw badRequest("orderedIds must be strings");
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    throw badRequest("orderedIds must be unique");
  }

  const existing = await db
    .select({ id: schema.notebooks.id })
    .from(schema.notebooks)
    .where(eq(schema.notebooks.projectId, projectId));
  const existingIds = new Set(existing.map((r) => r.id));
  if (existingIds.size !== ids.length || ids.some((id) => !existingIds.has(id))) {
    throw badRequest("orderedIds must list every notebook in the project exactly once");
  }

  db.transaction((tx) => {
    for (let i = 0; i < ids.length; i++) {
      tx.update(schema.notebooks)
        .set({ position: i })
        .where(eq(schema.notebooks.id, ids[i]))
        .run();
    }
  });

  return listNotebooks(ctx, projectId);
}

// --- Edit history (Google-Docs-style content versions) ----------------------

/**
 * Saves by the same editor within this window collapse into one version —
 * the Google Docs "editing session" behavior, sized for the editor's
 * sub-second autosave so history stays browsable instead of noisy.
 */
const VERSION_COALESCE_MS = 10 * 60 * 1000;
/** Versions kept per notebook (oldest pruned beyond this). */
const MAX_VERSIONS = 100;

type VersionRow = typeof schema.notebookVersions.$inferSelect;

/** The block shape stored in a version snapshot (mirrors the notebook DTO). */
interface SnapshotBlock {
  id: string;
  type: string;
  config: unknown;
  outputVariable: string | null;
  parentId: string | null;
  runWhen: string | null;
}

/** The notebook's current blocks as a snapshot JSON array (ordered). */
async function currentBlocksJson(notebookId: string): Promise<string> {
  const rows = await db
    .select()
    .from(schema.blocks)
    .where(eq(schema.blocks.notebookId, notebookId))
    .orderBy(asc(schema.blocks.order));
  const snapshot: SnapshotBlock[] = rows.map((b) => ({
    id: b.id,
    type: b.type,
    config: JSON.parse(b.config) as unknown,
    outputVariable: b.outputVariable,
    parentId: b.parentId ?? null,
    runWhen: b.runWhen ?? null,
  }));
  return JSON.stringify(snapshot);
}

/**
 * Notebooks predating version tracking (or fresh from seeding) get their
 * pre-edit state captured once, so the first tracked edit stays revertible.
 * The baseline carries no editor and keeps the notebook's own timestamp.
 */
async function ensureBaselineVersion(
  notebook: NotebookRow,
  blocksJson: string,
): Promise<void> {
  const [existing] = await db
    .select({ n: count() })
    .from(schema.notebookVersions)
    .where(eq(schema.notebookVersions.notebookId, notebook.id));
  if ((existing?.n ?? 0) > 0) return;
  await db.insert(schema.notebookVersions).values({
    id: crypto.randomUUID(),
    notebookId: notebook.id,
    editorId: null,
    title: notebook.title,
    description: notebook.description,
    blocks: blocksJson,
    restoredFrom: null,
    createdAt: notebook.updatedAt,
    updatedAt: notebook.updatedAt,
  });
}

/**
 * Record a content snapshot after a save. Identical snapshots are skipped;
 * an in-window save by the same editor updates their latest version in
 * place; anything else (new editor, window expired, restore) appends.
 */
async function recordVersion(
  notebook: NotebookRow,
  blocksJson: string,
  editorId: string,
  opts?: { restoredFrom?: string },
): Promise<void> {
  const [latest] = await db
    .select()
    .from(schema.notebookVersions)
    .where(eq(schema.notebookVersions.notebookId, notebook.id))
    .orderBy(desc(schema.notebookVersions.updatedAt), desc(schema.notebookVersions.createdAt))
    .limit(1);
  const unchanged =
    latest &&
    latest.title === notebook.title &&
    (latest.description ?? null) === (notebook.description ?? null) &&
    latest.blocks === blocksJson;
  // A restore is an explicit action: always mark it, even when a no-op.
  if (unchanged && !opts?.restoredFrom) return;

  const now = new Date();
  const coalesce =
    !opts?.restoredFrom &&
    latest &&
    latest.editorId === editorId &&
    // Restore markers stay immutable; edits after a restore start fresh.
    !latest.restoredFrom &&
    now.getTime() - latest.updatedAt.getTime() < VERSION_COALESCE_MS;

  if (coalesce) {
    await db
      .update(schema.notebookVersions)
      .set({
        title: notebook.title,
        description: notebook.description,
        blocks: blocksJson,
        updatedAt: now,
      })
      .where(eq(schema.notebookVersions.id, latest.id));
    return;
  }

  await db.insert(schema.notebookVersions).values({
    id: crypto.randomUUID(),
    notebookId: notebook.id,
    editorId,
    title: notebook.title,
    description: notebook.description,
    blocks: blocksJson,
    restoredFrom: opts?.restoredFrom ?? null,
    createdAt: now,
    updatedAt: now,
  });
  // Bound growth: drop the oldest versions beyond the cap.
  db.run(sql`
    DELETE FROM notebook_versions
    WHERE notebook_id = ${notebook.id}
      AND id NOT IN (
        SELECT id FROM notebook_versions
        WHERE notebook_id = ${notebook.id}
        ORDER BY updated_at DESC, created_at DESC
        LIMIT ${MAX_VERSIONS}
      )
  `);
}

function versionMetaDto(row: VersionRow, editorName: string | null, blockCount: number) {
  return {
    id: row.id,
    notebookId: row.notebookId,
    title: row.title,
    editorId: row.editorId,
    editorName,
    restoredFrom: row.restoredFrom,
    blockCount,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** Version list, newest first (metadata only — snapshots load one at a time). */
export async function listVersions(ctx: AuthContext, notebookId: string) {
  await requireNotebook(ctx, notebookId);
  const rows = await db
    .select({
      version: schema.notebookVersions,
      editorName: schema.user.name,
      blockCount: sql<number>`json_array_length(${schema.notebookVersions.blocks})`,
    })
    .from(schema.notebookVersions)
    .leftJoin(schema.user, eq(schema.user.id, schema.notebookVersions.editorId))
    .where(eq(schema.notebookVersions.notebookId, notebookId))
    .orderBy(
      desc(schema.notebookVersions.updatedAt),
      desc(schema.notebookVersions.createdAt),
    );
  return rows.map((r) => versionMetaDto(r.version, r.editorName, r.blockCount));
}

export async function getVersion(
  ctx: AuthContext,
  notebookId: string,
  versionId: string,
) {
  await requireNotebook(ctx, notebookId);
  const [row] = await db
    .select({ version: schema.notebookVersions, editorName: schema.user.name })
    .from(schema.notebookVersions)
    .leftJoin(schema.user, eq(schema.user.id, schema.notebookVersions.editorId))
    .where(
      and(
        eq(schema.notebookVersions.id, versionId),
        eq(schema.notebookVersions.notebookId, notebookId),
      ),
    );
  if (!row) throw notFound("Version");
  const blocks = JSON.parse(row.version.blocks) as SnapshotBlock[];
  return {
    ...versionMetaDto(row.version, row.editorName, blocks.length),
    description: row.version.description,
    blocks,
  };
}

/**
 * Google-Docs-style restore: the version's content becomes the current
 * notebook state, recorded as a *new* version (history never rewinds).
 * Block ids are preserved so saved run outputs keep matching their blocks.
 */
export async function restoreVersion(
  ctx: AuthContext,
  notebookId: string,
  versionId: string,
) {
  await requireNotebook(ctx, notebookId, "editor");
  const [version] = await db
    .select()
    .from(schema.notebookVersions)
    .where(
      and(
        eq(schema.notebookVersions.id, versionId),
        eq(schema.notebookVersions.notebookId, notebookId),
      ),
    );
  if (!version) throw notFound("Version");
  const snapshot = JSON.parse(version.blocks) as SnapshotBlock[];

  db.transaction((tx) => {
    tx.delete(schema.blocks).where(eq(schema.blocks.notebookId, notebookId)).run();
    if (snapshot.length > 0) {
      tx.insert(schema.blocks)
        .values(
          snapshot.map((b, index) => ({
            id: b.id,
            notebookId,
            order: index,
            type: b.type,
            config: JSON.stringify(b.config ?? {}),
            outputVariable: b.outputVariable ?? null,
            parentId: b.parentId ?? null,
            runWhen: b.runWhen ?? null,
          })),
        )
        .run();
    }
    tx.update(schema.notebooks)
      .set({
        title: version.title,
        description: version.description,
        updatedAt: new Date(),
      })
      .where(eq(schema.notebooks.id, notebookId))
      .run();
  });

  const restored = await requireNotebook(ctx, notebookId);
  await recordVersion(restored, version.blocks, ctx.userId, {
    restoredFrom: version.id,
  });
  return getNotebookWithBlocks(ctx, notebookId);
}

// --- Persisted run output (Jupyter-style saved results) ---------------------

/** Guard against runaway payloads (history is bounded client-side too). */
const MAX_RUN_STATE_BYTES = 4 * 1024 * 1024;

/** The stored blob is an opaque BigInt-safe JSON string; the server never parses it. */
export async function getRunState(
  ctx: AuthContext,
  notebookId: string,
): Promise<string | null> {
  await requireNotebook(ctx, notebookId);
  const [row] = await db
    .select({ state: schema.notebookRunState.state })
    .from(schema.notebookRunState)
    .where(eq(schema.notebookRunState.notebookId, notebookId));
  return row?.state ?? null;
}

export async function saveRunState(
  ctx: AuthContext,
  notebookId: string,
  state: string,
): Promise<void> {
  await requireNotebook(ctx, notebookId, "editor");
  if (typeof state !== "string" || state.length === 0) {
    throw badRequest("state must be a non-empty string");
  }
  if (state.length > MAX_RUN_STATE_BYTES) {
    throw badRequest("Run state too large to persist");
  }
  await db
    .insert(schema.notebookRunState)
    .values({ notebookId, state, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.notebookRunState.notebookId,
      set: { state, updatedAt: new Date() },
    });
}

export async function clearRunState(ctx: AuthContext, notebookId: string): Promise<void> {
  await requireNotebook(ctx, notebookId, "editor");
  await db
    .delete(schema.notebookRunState)
    .where(eq(schema.notebookRunState.notebookId, notebookId));
}

export interface IncomingBlock {
  id?: string;
  type: string;
  config: unknown;
  outputVariable?: string | null;
  parentId?: string | null;
  runWhen?: string | null;
}

/** Replace-all block save (the editor autosaves the full list). */
export async function saveBlocks(
  ctx: AuthContext,
  notebookId: string,
  incoming: IncomingBlock[],
): Promise<void> {
  const notebook = await requireNotebook(ctx, notebookId, "editor");
  // Capture the pre-save state once so the very first edit stays revertible.
  await ensureBaselineVersion(notebook, await currentBlocksJson(notebookId));
  // Ids are minted before the write so the version snapshot matches the rows.
  const normalized: SnapshotBlock[] = incoming.map((b) => ({
    id: b.id ?? crypto.randomUUID(),
    type: b.type,
    config: b.config ?? {},
    outputVariable: b.outputVariable ?? null,
    parentId: b.parentId ?? null,
    runWhen: b.runWhen ?? null,
  }));
  // better-sqlite3 transactions are synchronous: use .run(), no awaits inside.
  db.transaction((tx) => {
    tx.delete(schema.blocks).where(eq(schema.blocks.notebookId, notebookId)).run();
    if (normalized.length > 0) {
      tx.insert(schema.blocks)
        .values(
          normalized.map((b, index) => ({
            id: b.id,
            notebookId,
            order: index,
            type: b.type,
            config: JSON.stringify(b.config),
            outputVariable: b.outputVariable,
            parentId: b.parentId,
            runWhen: b.runWhen,
          })),
        )
        .run();
    }
    tx.update(schema.notebooks)
      .set({ updatedAt: new Date() })
      .where(eq(schema.notebooks.id, notebookId))
      .run();
  });
  await recordVersion(notebook, JSON.stringify(normalized), ctx.userId);
}
