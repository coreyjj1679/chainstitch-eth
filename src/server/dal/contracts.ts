import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { isAddress } from "viem";
import { db, schema } from "@/db";
import { validateAbi } from "@/lib/abi";
import { requireRole, type AuthContext } from "@/server/auth-context";
import { badRequest, notFound } from "@/server/errors";
import { requireProject } from "@/server/dal/projects";

type ContractRow = typeof schema.contracts.$inferSelect;

function toDto(row: ContractRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    address: row.address,
    abi: JSON.parse(row.abi) as unknown,
    createdAt: row.createdAt.getTime(),
  };
}

/** Workspace-scoped contract lookup via its project. */
async function requireContract(ctx: AuthContext, id: string): Promise<ContractRow> {
  requireRole(ctx, "viewer");
  const [row] = await db
    .select({ contract: schema.contracts })
    .from(schema.contracts)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.contracts.projectId))
    .where(
      and(eq(schema.contracts.id, id), eq(schema.projects.workspaceId, ctx.workspaceId)),
    );
  if (!row) throw notFound("Contract");
  return row.contract;
}

export async function listContracts(ctx: AuthContext, projectId: string) {
  await requireProject(ctx, projectId);
  const rows = await db
    .select()
    .from(schema.contracts)
    .where(eq(schema.contracts.projectId, projectId))
    .orderBy(asc(schema.contracts.createdAt));
  return rows.map(toDto);
}

export async function createContract(
  ctx: AuthContext,
  projectId: string,
  data: { name?: unknown; address?: unknown; abi?: unknown },
) {
  requireRole(ctx, "editor");
  await requireProject(ctx, projectId);
  if (!data.name || !data.abi) throw badRequest("name and abi are required");
  if (data.address && !isAddress(String(data.address))) throw badRequest("Invalid address");
  const validation = validateAbi(data.abi);
  if (!validation.ok) throw badRequest(validation.error);
  const row: ContractRow = {
    id: crypto.randomUUID(),
    projectId,
    name: String(data.name),
    address: data.address ? String(data.address) : "",
    abi: JSON.stringify(validation.abi),
    createdAt: new Date(),
  };
  await db.insert(schema.contracts).values(row);
  return toDto(row);
}

export async function updateContract(
  ctx: AuthContext,
  id: string,
  body: { name?: unknown; address?: unknown; abi?: unknown },
) {
  requireRole(ctx, "editor");
  await requireContract(ctx, id);
  const updates: Partial<ContractRow> = {};
  if (body.name !== undefined) updates.name = String(body.name);
  if (body.address !== undefined) {
    if (body.address && !isAddress(String(body.address))) throw badRequest("Invalid address");
    updates.address = String(body.address);
  }
  if (body.abi !== undefined) {
    const validation = validateAbi(body.abi);
    if (!validation.ok) throw badRequest(validation.error);
    updates.abi = JSON.stringify(validation.abi);
  }
  if (Object.keys(updates).length > 0) {
    await db.update(schema.contracts).set(updates).where(eq(schema.contracts.id, id));
  }
  return toDto(await requireContract(ctx, id));
}

export async function deleteContract(ctx: AuthContext, id: string): Promise<void> {
  requireRole(ctx, "editor");
  await requireContract(ctx, id);
  await db.delete(schema.contracts).where(eq(schema.contracts.id, id));
}
