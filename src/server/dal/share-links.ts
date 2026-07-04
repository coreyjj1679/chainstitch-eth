import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { type AuthContext } from "@/server/auth-context";
import { badRequest } from "@/server/errors";
import { requireProject } from "@/server/dal/projects";
import type { WorkspaceRole } from "@/db/schema";

/** Roles a link may carry — never owner (links can't manage the project). */
const LINK_ROLES: WorkspaceRole[] = ["viewer", "editor"];

export interface ShareLinkDto {
  token: string;
  role: WorkspaceRole;
  createdAt: number;
}

/** 256 bits of randomness, URL- and cookie-safe (hex). */
function newToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

function parseLinkRole(role: unknown): WorkspaceRole {
  if (typeof role === "string" && LINK_ROLES.includes(role as WorkspaceRole)) {
    return role as WorkspaceRole;
  }
  throw badRequest("A share link's role must be viewer or editor");
}

/** The project's share link, if sharing is on — project owners only. */
export async function getShareLink(
  ctx: AuthContext,
  projectId: string,
): Promise<ShareLinkDto | null> {
  await requireProject(ctx, projectId, "owner");
  const [row] = await db
    .select()
    .from(schema.projectShareLinks)
    .where(eq(schema.projectShareLinks.projectId, projectId));
  return row
    ? { token: row.token, role: row.role, createdAt: row.createdAt.getTime() }
    : null;
}

/**
 * Turn link sharing on (or change its role). `reset` rotates the token,
 * invalidating every previously handed-out link.
 */
export async function upsertShareLink(
  ctx: AuthContext,
  projectId: string,
  roleInput: unknown,
  reset = false,
): Promise<ShareLinkDto> {
  await requireProject(ctx, projectId, "owner");
  const role = parseLinkRole(roleInput);
  const [existing] = await db
    .select()
    .from(schema.projectShareLinks)
    .where(eq(schema.projectShareLinks.projectId, projectId));
  if (!existing) {
    const row = {
      id: crypto.randomUUID(),
      projectId,
      token: newToken(),
      role,
      createdBy: ctx.userId,
      createdAt: new Date(),
    };
    await db.insert(schema.projectShareLinks).values(row);
    return { token: row.token, role, createdAt: row.createdAt.getTime() };
  }
  const token = reset ? newToken() : existing.token;
  await db
    .update(schema.projectShareLinks)
    .set({ role, token })
    .where(eq(schema.projectShareLinks.id, existing.id));
  return { token, role, createdAt: existing.createdAt.getTime() };
}

/** Turn link sharing off — every handed-out link stops working. */
export async function deleteShareLink(ctx: AuthContext, projectId: string): Promise<void> {
  await requireProject(ctx, projectId, "owner");
  await db
    .delete(schema.projectShareLinks)
    .where(eq(schema.projectShareLinks.projectId, projectId));
}

/**
 * Request-time resolution: tokens (from the share cookie) → project grants.
 * Not ctx-gated — this is how anonymous link visitors get a context at all.
 */
export async function resolveShareTokens(
  tokens: string[],
): Promise<Record<string, WorkspaceRole>> {
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
