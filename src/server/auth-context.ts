import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema, DEFAULT_WORKSPACE_ID, LOCAL_USER_ID } from "@/db";
import { auth } from "@/server/auth";
import { appMode } from "@/server/mode";
import { parseShareTokens } from "@/lib/share-cookie";
import { forbidden, notFound, unauthorized } from "@/server/errors";
import type { WorkspaceRole } from "@/db/schema";

/** Pseudo-identity for anonymous "anyone with the link" visitors. */
export const LINK_GUEST_ID = "link-guest";

export interface AuthContext {
  userId: string;
  workspaceId: string;
  /** Workspace-wide role; null when signed in without workspace membership. */
  role: WorkspaceRole | null;
  /** Per-project grants overlaying the workspace role (projectId → role). */
  projectRoles: Record<string, WorkspaceRole>;
}

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, owner: 3 };

/** Share-link tokens from the cookie → per-project grants. */
async function linkGrants(headers: Headers): Promise<Record<string, WorkspaceRole>> {
  const tokens = parseShareTokens(headers.get("cookie"));
  if (tokens.length === 0) return {};
  const rows = await db
    .select({
      projectId: schema.projectShareLinks.projectId,
      role: schema.projectShareLinks.role,
    })
    .from(schema.projectShareLinks)
    .where(inArray(schema.projectShareLinks.token, tokens));
  const grants: Record<string, WorkspaceRole> = {};
  for (const row of rows) grants[row.projectId] = row.role;
  return grants;
}

/** Membership + project grants for a real user id, optionally merged with link grants. */
async function contextForUser(
  userId: string,
  shared: Record<string, WorkspaceRole>,
): Promise<AuthContext> {
  const [membership] = await db
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(schema.workspaceMembers.userId, userId),
      ),
    );
  const grants = await db
    .select({
      projectId: schema.projectMembers.projectId,
      role: schema.projectMembers.role,
    })
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.userId, userId));
  const projectRoles: Record<string, WorkspaceRole> = {};
  for (const grant of grants) projectRoles[grant.projectId] = grant.role;
  // A signed-in user who opened a share link gets the link's role too
  // (the higher role wins, links never lower existing access).
  for (const [projectId, role] of Object.entries(shared)) {
    const current = projectRoles[projectId];
    if (!current || ROLE_RANK[role] > ROLE_RANK[current]) {
      projectRoles[projectId] = role;
    }
  }

  return {
    userId,
    workspaceId: DEFAULT_WORKSPACE_ID,
    role: membership?.role ?? null,
    projectRoles,
  };
}

function parseBearer(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

/**
 * Resolve the caller for a request. Local mode: the implicit owner, no auth.
 * Team mode: API Bearer token, better-auth session, or an "anyone with the
 * link" cookie — 401 when none is present. Authorization is enforced in the DAL.
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

  // Headless agents (MCP) authenticate with a personal API token — no SIWE.
  // Checked before the session cookie so a mis-set Bearer fails closed rather
  // than silently falling through to a browser session on the same machine.
  const bearer = parseBearer(headers.get("authorization"));
  if (bearer) {
    // Dynamic import avoids a cycle: api-tokens DAL imports AuthContext helpers.
    const { resolveApiTokenUserId } = await import("@/server/dal/api-tokens");
    const userId = await resolveApiTokenUserId(bearer);
    if (!userId) throw unauthorized();
    return contextForUser(userId, {});
  }

  const session = await auth.api.getSession({ headers });
  const shared = await linkGrants(headers);

  if (!session) {
    // No account, but valid share links: an anonymous guest with exactly
    // those projects. Real enforcement stays in the DAL role checks.
    if (Object.keys(shared).length === 0) throw unauthorized();
    return {
      userId: LINK_GUEST_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      role: null,
      projectRoles: shared,
    };
  }

  return contextForUser(session.user.id, shared);
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
