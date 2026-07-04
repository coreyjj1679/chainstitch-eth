import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  hasAnyAccess,
  projectRole,
  requireProjectRole,
  requireRole,
  type AuthContext,
} from "@/server/auth-context";
import { badRequest, forbidden, notFound } from "@/server/errors";
import { seedTutorialContent } from "@/server/dal/tutorial";
import type { WorkspaceRole } from "@/db/schema";

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string | null;
  createdAt: number;
  /** The caller's effective role on this project (workspace role ⊕ grant). */
  role: WorkspaceRole;
}

type ProjectRow = typeof schema.projects.$inferSelect;

function toDto(row: ProjectRow, role: WorkspaceRole): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    chainId: row.chainId,
    rpcUrl: row.rpcUrl,
    explorerUrl: row.explorerUrl,
    createdAt: row.createdAt.getTime(),
    role,
  };
}

/**
 * Project lookup + effective-role gate, the entry point for everything
 * project-scoped. 403 for callers with no access at all; 404 when the project
 * doesn't exist in this workspace or the caller has no role on it (granted
 * users must not learn what else exists); 403 when the role is below `min`.
 */
export async function requireProject(
  ctx: AuthContext,
  projectId: string,
  min: WorkspaceRole = "viewer",
): Promise<ProjectRow> {
  if (!hasAnyAccess(ctx)) throw forbidden("You are not a member of this workspace");
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.workspaceId, ctx.workspaceId),
      ),
    );
  if (!project) throw notFound("Project");
  requireProjectRole(ctx, projectId, min);
  return project;
}

export async function listProjects(ctx: AuthContext): Promise<ProjectDto[]> {
  if (!hasAnyAccess(ctx)) throw forbidden("You are not a member of this workspace");
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.projects.createdAt));
  // Workspace members see every project; grant-only users just theirs.
  return rows.flatMap((row) => {
    const role = projectRole(ctx, row.id);
    return role ? [toDto(row, role)] : [];
  });
}

export async function getProject(ctx: AuthContext, id: string): Promise<ProjectDto> {
  const row = await requireProject(ctx, id);
  return toDto(row, projectRole(ctx, id)!);
}

export async function createProject(
  ctx: AuthContext,
  data: { name: string; description?: string; chainId: number; rpcUrl: string; explorerUrl?: string },
): Promise<ProjectDto> {
  // Creating projects stays a workspace-owner action: a project-scoped grant
  // confers no rights outside its project.
  requireRole(ctx, "owner");
  if (!data.name || !data.chainId || !data.rpcUrl) {
    throw badRequest("name, chainId and rpcUrl are required");
  }
  const row: ProjectRow = {
    id: crypto.randomUUID(),
    workspaceId: ctx.workspaceId,
    name: String(data.name),
    description: data.description ? String(data.description) : null,
    chainId: Number(data.chainId),
    rpcUrl: String(data.rpcUrl),
    explorerUrl: data.explorerUrl ? String(data.explorerUrl).replace(/\/$/, "") : null,
    createdAt: new Date(),
  };
  await db.insert(schema.projects).values(row);
  // Every new project starts with the Welcome tutorial notebook (+ example
  // recipe) — chain-agnostic, runnable as-is, deletable in one click.
  await seedTutorialContent(row.id);
  return toDto(row, "owner");
}

export async function updateProject(
  ctx: AuthContext,
  id: string,
  body: Record<string, unknown>,
): Promise<ProjectDto> {
  await requireProject(ctx, id, "owner");
  const updates: Partial<ProjectRow> = {};
  if (body.name !== undefined) updates.name = String(body.name);
  if (body.description !== undefined)
    updates.description = body.description ? String(body.description) : null;
  if (body.chainId !== undefined) updates.chainId = Number(body.chainId);
  if (body.rpcUrl !== undefined) updates.rpcUrl = String(body.rpcUrl);
  if (body.explorerUrl !== undefined)
    updates.explorerUrl = body.explorerUrl
      ? String(body.explorerUrl).replace(/\/$/, "")
      : null;
  if (Object.keys(updates).length > 0) {
    await db.update(schema.projects).set(updates).where(eq(schema.projects.id, id));
  }
  const row = await requireProject(ctx, id);
  return toDto(row, projectRole(ctx, id)!);
}

export async function deleteProject(ctx: AuthContext, id: string): Promise<void> {
  await requireProject(ctx, id, "owner");
  await db.delete(schema.projects).where(eq(schema.projects.id, id));
  // Grants cascade via FK; pending project-scoped invites must not outlive it.
  await db.delete(schema.invites).where(eq(schema.invites.projectId, id));
}
