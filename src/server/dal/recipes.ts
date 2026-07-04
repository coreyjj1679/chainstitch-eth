import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireRole, type AuthContext } from "@/server/auth-context";
import { badRequest, notFound } from "@/server/errors";
import { requireProject } from "@/server/dal/projects";

type RecipeRow = typeof schema.recipes.$inferSelect;

/** Guard against runaway payloads (a recipe is block *definitions* only). */
const MAX_RECIPE_BYTES = 1024 * 1024;

interface RecipeBlock {
  id: string;
  type: string;
  config: unknown;
  outputVariable: string | null;
  parentId: string | null;
  runWhen: string | null;
}

function toDto(row: RecipeRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    blocks: JSON.parse(row.blocks) as unknown,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** Workspace-scoped recipe lookup via its project. */
async function requireRecipe(ctx: AuthContext, id: string): Promise<RecipeRow> {
  requireRole(ctx, "viewer");
  const [row] = await db
    .select({ recipe: schema.recipes })
    .from(schema.recipes)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.recipes.projectId))
    .where(
      and(eq(schema.recipes.id, id), eq(schema.projects.workspaceId, ctx.workspaceId)),
    );
  if (!row) throw notFound("Recipe");
  return row.recipe;
}

/**
 * Normalize incoming blocks: fresh ids, parent links remapped, only the
 * known fields kept. Rejects malformed shapes and dangling parent links.
 */
function sanitizeBlocks(incoming: unknown): string {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    throw badRequest("blocks must be a non-empty array");
  }
  const idMap = new Map<string, string>();
  for (const block of incoming) {
    if (typeof block !== "object" || block === null) {
      throw badRequest("Each block must be an object");
    }
    const b = block as Record<string, unknown>;
    if (typeof b.type !== "string" || !b.type) {
      throw badRequest("Each block needs a type");
    }
    // A recipe referencing another recipe could loop back into itself; the
    // runner is deliberately non-recursive, so reject nesting outright.
    if (b.type === "recipe") {
      throw badRequest("Recipes cannot contain recipe blocks");
    }
    if (typeof b.config !== "object" || b.config === null) {
      throw badRequest("Each block needs a config object");
    }
    if (typeof b.id === "string") idMap.set(b.id, crypto.randomUUID());
  }
  const sanitized: RecipeBlock[] = incoming.map((block) => {
    const b = block as Record<string, unknown>;
    const parentId =
      typeof b.parentId === "string" ? (idMap.get(b.parentId) ?? null) : null;
    if (typeof b.parentId === "string" && !parentId) {
      throw badRequest("Block parent link points outside the recipe");
    }
    return {
      id: (typeof b.id === "string" && idMap.get(b.id)) || crypto.randomUUID(),
      type: b.type as string,
      config: b.config,
      outputVariable: b.outputVariable ? String(b.outputVariable) : null,
      parentId,
      runWhen: b.runWhen ? String(b.runWhen) : null,
    };
  });
  const json = JSON.stringify(sanitized);
  if (json.length > MAX_RECIPE_BYTES) throw badRequest("Recipe too large to save");
  return json;
}

export async function listRecipes(ctx: AuthContext, projectId: string) {
  await requireProject(ctx, projectId);
  const rows = await db
    .select()
    .from(schema.recipes)
    .where(eq(schema.recipes.projectId, projectId))
    .orderBy(asc(schema.recipes.createdAt));
  return rows.map(toDto);
}

export async function createRecipe(
  ctx: AuthContext,
  projectId: string,
  data: { name?: unknown; description?: unknown; blocks?: unknown },
) {
  requireRole(ctx, "editor");
  await requireProject(ctx, projectId);
  if (!data.name || !String(data.name).trim()) throw badRequest("name is required");
  const now = new Date();
  const row: RecipeRow = {
    id: crypto.randomUUID(),
    projectId,
    name: String(data.name).trim(),
    description: data.description ? String(data.description) : null,
    blocks: sanitizeBlocks(data.blocks),
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(schema.recipes).values(row);
  return toDto(row);
}

export async function updateRecipe(
  ctx: AuthContext,
  id: string,
  body: { name?: unknown; description?: unknown; blocks?: unknown },
) {
  requireRole(ctx, "editor");
  await requireRecipe(ctx, id);
  const updates: Partial<RecipeRow> = { updatedAt: new Date() };
  if (body.name !== undefined) {
    if (!body.name || !String(body.name).trim()) throw badRequest("name is required");
    updates.name = String(body.name).trim();
  }
  if (body.description !== undefined)
    updates.description = body.description ? String(body.description) : null;
  if (body.blocks !== undefined) updates.blocks = sanitizeBlocks(body.blocks);
  await db.update(schema.recipes).set(updates).where(eq(schema.recipes.id, id));
  return toDto(await requireRecipe(ctx, id));
}

export async function deleteRecipe(ctx: AuthContext, id: string): Promise<void> {
  requireRole(ctx, "editor");
  await requireRecipe(ctx, id);
  await db.delete(schema.recipes).where(eq(schema.recipes.id, id));
}
