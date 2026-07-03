import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireRole, type AuthContext } from "@/server/auth-context";
import { badRequest, notFound } from "@/server/errors";

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string | null;
  createdAt: number;
}

type ProjectRow = typeof schema.projects.$inferSelect;

function toDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    chainId: row.chainId,
    rpcUrl: row.rpcUrl,
    explorerUrl: row.explorerUrl,
    createdAt: row.createdAt.getTime(),
  };
}

/** Workspace-scoped project lookup (404 outside the caller's workspace). */
export async function requireProject(
  ctx: AuthContext,
  projectId: string,
): Promise<ProjectRow> {
  requireRole(ctx, "viewer");
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
  return project;
}

export async function listProjects(ctx: AuthContext): Promise<ProjectDto[]> {
  requireRole(ctx, "viewer");
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.projects.createdAt));
  return rows.map(toDto);
}

export async function getProject(ctx: AuthContext, id: string): Promise<ProjectDto> {
  return toDto(await requireProject(ctx, id));
}

export async function createProject(
  ctx: AuthContext,
  data: { name: string; description?: string; chainId: number; rpcUrl: string; explorerUrl?: string },
): Promise<ProjectDto> {
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
  return toDto(row);
}

export async function updateProject(
  ctx: AuthContext,
  id: string,
  body: Record<string, unknown>,
): Promise<ProjectDto> {
  requireRole(ctx, "owner");
  await requireProject(ctx, id);
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
  return toDto(await requireProject(ctx, id));
}

export async function deleteProject(ctx: AuthContext, id: string): Promise<void> {
  requireRole(ctx, "owner");
  await requireProject(ctx, id);
  await db.delete(schema.projects).where(eq(schema.projects.id, id));
}
