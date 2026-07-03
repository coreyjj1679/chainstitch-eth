import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireRole, type AuthContext } from "@/server/auth-context";
import { badRequest, notFound } from "@/server/errors";
import { requireProject } from "@/server/dal/projects";

type NotebookRow = typeof schema.notebooks.$inferSelect;

function toDto(row: NotebookRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** Workspace-scoped notebook lookup via its project. */
async function requireNotebook(ctx: AuthContext, id: string): Promise<NotebookRow> {
  requireRole(ctx, "viewer");
  const [row] = await db
    .select({ notebook: schema.notebooks })
    .from(schema.notebooks)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.notebooks.projectId))
    .where(
      and(eq(schema.notebooks.id, id), eq(schema.projects.workspaceId, ctx.workspaceId)),
    );
  if (!row) throw notFound("Notebook");
  return row.notebook;
}

export async function listNotebooks(ctx: AuthContext, projectId: string) {
  await requireProject(ctx, projectId);
  const rows = await db
    .select()
    .from(schema.notebooks)
    .where(eq(schema.notebooks.projectId, projectId))
    .orderBy(desc(schema.notebooks.updatedAt));
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
    })),
  };
}

export async function createNotebook(
  ctx: AuthContext,
  projectId: string,
  data: { title?: unknown; description?: unknown },
) {
  requireRole(ctx, "editor");
  await requireProject(ctx, projectId);
  if (!data.title) throw badRequest("title is required");
  const now = new Date();
  const row: NotebookRow = {
    id: crypto.randomUUID(),
    projectId,
    title: String(data.title),
    description: data.description ? String(data.description) : null,
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
  requireRole(ctx, "editor");
  await requireNotebook(ctx, id);
  const updates: Partial<NotebookRow> = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = String(body.title);
  if (body.description !== undefined)
    updates.description = body.description ? String(body.description) : null;
  await db.update(schema.notebooks).set(updates).where(eq(schema.notebooks.id, id));
  return toDto(await requireNotebook(ctx, id));
}

export async function deleteNotebook(ctx: AuthContext, id: string): Promise<void> {
  requireRole(ctx, "editor");
  await requireNotebook(ctx, id);
  await db.delete(schema.notebooks).where(eq(schema.notebooks.id, id));
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
  requireRole(ctx, "editor");
  await requireNotebook(ctx, notebookId);
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
  requireRole(ctx, "editor");
  await requireNotebook(ctx, notebookId);
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
}

/** Replace-all block save (the editor autosaves the full list). */
export async function saveBlocks(
  ctx: AuthContext,
  notebookId: string,
  incoming: IncomingBlock[],
): Promise<void> {
  requireRole(ctx, "editor");
  await requireNotebook(ctx, notebookId);
  // better-sqlite3 transactions are synchronous: use .run(), no awaits inside.
  db.transaction((tx) => {
    tx.delete(schema.blocks).where(eq(schema.blocks.notebookId, notebookId)).run();
    if (incoming.length > 0) {
      tx.insert(schema.blocks)
        .values(
          incoming.map((b, index) => ({
            id: b.id ?? crypto.randomUUID(),
            notebookId,
            order: index,
            type: b.type,
            config: JSON.stringify(b.config ?? {}),
            outputVariable: b.outputVariable ?? null,
            parentId: b.parentId ?? null,
          })),
        )
        .run();
    }
    tx.update(schema.notebooks)
      .set({ updatedAt: new Date() })
      .where(eq(schema.notebooks.id, notebookId))
      .run();
  });
}
