import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireRole, type AuthContext } from "@/server/auth-context";
import { requireProject } from "@/server/dal/projects";

export interface IncomingStateView {
  id?: unknown;
  contractId: string;
  functions: string[];
  position?: unknown;
  span?: unknown;
}

export interface IncomingStateTitle {
  id?: unknown;
  text?: unknown;
  position?: unknown;
}

/** Keep client-provided row ids (stable dnd keys); fall back to a fresh UUID. */
function rowId(id: unknown): string {
  return typeof id === "string" && id.length > 0 && id.length <= 64
    ? id
    : crypto.randomUUID();
}

function toInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export async function listStateViews(ctx: AuthContext, projectId: string) {
  await requireProject(ctx, projectId);
  const [viewRows, titleRows] = await Promise.all([
    db
      .select()
      .from(schema.stateViews)
      .where(eq(schema.stateViews.projectId, projectId))
      .orderBy(asc(schema.stateViews.position)),
    db
      .select()
      .from(schema.stateTitles)
      .where(eq(schema.stateTitles.projectId, projectId))
      .orderBy(asc(schema.stateTitles.position)),
  ]);
  return {
    views: viewRows.map((r) => ({
      ...r,
      functions: JSON.parse(r.functions) as string[],
    })),
    titles: titleRows,
  };
}

/** Replace-all save of the project's state dashboard (cards + section titles). */
export async function saveStateViews(
  ctx: AuthContext,
  projectId: string,
  incoming: IncomingStateView[],
  incomingTitles: IncomingStateTitle[] = [],
): Promise<void> {
  requireRole(ctx, "editor");
  await requireProject(ctx, projectId);
  // better-sqlite3 transactions are synchronous: use .run(), no awaits inside.
  db.transaction((tx) => {
    tx.delete(schema.stateViews).where(eq(schema.stateViews.projectId, projectId)).run();
    tx.delete(schema.stateTitles)
      .where(eq(schema.stateTitles.projectId, projectId))
      .run();
    const viewRows = incoming
      .filter((v) => v.contractId && Array.isArray(v.functions) && v.functions.length > 0)
      .map((v, index) => ({
        id: rowId(v.id),
        projectId,
        contractId: String(v.contractId),
        functions: JSON.stringify(v.functions.map(String)),
        position: toInt(v.position, index),
        span: Math.min(4, Math.max(1, toInt(v.span, 2))),
      }));
    if (viewRows.length > 0) tx.insert(schema.stateViews).values(viewRows).run();
    const titleRows = incomingTitles
      .filter((t) => typeof t.text === "string" && t.text.trim() !== "")
      .map((t, index) => ({
        id: rowId(t.id),
        projectId,
        text: String(t.text).trim().slice(0, 200),
        position: toInt(t.position, index),
      }));
    if (titleRows.length > 0) tx.insert(schema.stateTitles).values(titleRows).run();
  });
}
