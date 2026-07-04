import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema, DEFAULT_WORKSPACE_ID, LOCAL_USER_ID } from "@/db";
import { auth } from "@/server/auth";
import { appMode } from "@/server/mode";
import { forbidden, notFound, unauthorized } from "@/server/errors";
import type { WorkspaceRole } from "@/db/schema";

export interface AuthContext {
  userId: string;
  workspaceId: string;
  /** Workspace-wide role; null when signed in without workspace membership. */
  role: WorkspaceRole | null;
  /** Per-project grants overlaying the workspace role (projectId → role). */
  projectRoles: Record<string, WorkspaceRole>;
}

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, owner: 3 };

/**
 * Resolve the caller for a request. Local mode: the implicit owner, no auth.
 * Team mode: better-auth session (401 when absent) + workspace membership
 * + any per-project grants.
 */
export async function getAuthContext(headers: Headers): Promise<AuthContext> {
  if (appMode() === "local") {
    return {
      userId: LOCAL_USER_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      role: "owner",
      projectRoles: {},
    };
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
  const grants = await db
    .select({
      projectId: schema.projectMembers.projectId,
      role: schema.projectMembers.role,
    })
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.userId, session.user.id));
  const projectRoles: Record<string, WorkspaceRole> = {};
  for (const grant of grants) projectRoles[grant.projectId] = grant.role;

  return {
    userId: session.user.id,
    workspaceId: DEFAULT_WORKSPACE_ID,
    role: membership?.role ?? null,
    projectRoles,
  };
}

/** True when the caller can see anything at all (member or ≥1 project grant). */
export function hasAnyAccess(ctx: AuthContext): boolean {
  return ctx.role !== null || Object.keys(ctx.projectRoles).length > 0;
}

/**
 * The caller's effective role on a project: the higher of their workspace
 * role and their per-project grant. Null when they have neither.
 */
export function projectRole(ctx: AuthContext, projectId: string): WorkspaceRole | null {
  const granted = ctx.projectRoles[projectId] ?? null;
  if (!granted) return ctx.role;
  if (!ctx.role) return granted;
  return ROLE_RANK[granted] >= ROLE_RANK[ctx.role] ? granted : ctx.role;
}

/** Throw 403 unless the caller holds at least `min` workspace-wide. */
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

/**
 * Enforce the caller's effective role on a project that is known to exist.
 * A caller with no role on it gets the same 404 as a nonexistent project —
 * project-scoped users must not learn what else lives in the workspace.
 */
export function requireProjectRole(
  ctx: AuthContext,
  projectId: string,
  min: WorkspaceRole,
  what = "Project",
): void {
  const role = projectRole(ctx, projectId);
  if (!role) throw notFound(what);
  if (ROLE_RANK[role] < ROLE_RANK[min]) {
    throw forbidden(
      min === "owner"
        ? "Only project owners can do that"
        : "You have read-only access to this project",
    );
  }
}
