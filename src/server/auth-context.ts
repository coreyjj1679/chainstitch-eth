import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema, DEFAULT_WORKSPACE_ID, LOCAL_USER_ID } from "@/db";
import { auth } from "@/server/auth";
import { appMode } from "@/server/mode";
import { forbidden, unauthorized } from "@/server/errors";
import type { WorkspaceRole } from "@/db/schema";

export interface AuthContext {
  userId: string;
  workspaceId: string;
  /** Role in the workspace; null when signed in but not (or no longer) a member. */
  role: WorkspaceRole | null;
}

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, owner: 3 };

/**
 * Resolve the caller for a request. Local mode: the implicit owner, no auth.
 * Team mode: better-auth session (401 when absent) + workspace membership.
 */
export async function getAuthContext(headers: Headers): Promise<AuthContext> {
  if (appMode() === "local") {
    return { userId: LOCAL_USER_ID, workspaceId: DEFAULT_WORKSPACE_ID, role: "owner" };
  }

  const session = await auth.api.getSession({ headers });
  if (!session) throw unauthorized();

  const [membership] = await db
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(schema.workspaceMembers.userId, session.user.id),
      ),
    );
  return {
    userId: session.user.id,
    workspaceId: DEFAULT_WORKSPACE_ID,
    role: membership?.role ?? null,
  };
}

/** Throw 403 unless the caller holds at least `min` in their workspace. */
export function requireRole(ctx: AuthContext, min: WorkspaceRole): void {
  if (!ctx.role) {
    throw forbidden("You are not a member of this workspace");
  }
  if (ROLE_RANK[ctx.role] < ROLE_RANK[min]) {
    throw forbidden(
      min === "owner"
        ? "Only workspace owners can do that"
        : "You have read-only access to this workspace",
    );
  }
}
