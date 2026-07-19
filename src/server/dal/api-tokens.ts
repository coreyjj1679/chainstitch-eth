import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema, LOCAL_USER_ID } from "@/db";
import {
  LINK_GUEST_ID,
  type AuthContext,
  hasAnyAccess,
} from "@/server/auth-context";
import { appMode } from "@/server/mode";
import { badRequest, forbidden, notFound, unauthorized } from "@/server/errors";

/** Public prefix on every minted token (agents search for `cst_`). */
export const API_TOKEN_PREFIX = "cst_";

export interface ApiTokenInfo {
  id: string;
  name: string;
  /** Leading chars only — the secret is never re-shown. */
  tokenPrefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Create response: list fields plus the plaintext token (once). */
export interface CreatedApiToken extends ApiTokenInfo {
  token: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function mintPlaintext(): { token: string; prefix: string; hash: string } {
  const secret = randomBytes(32).toString("hex");
  const token = `${API_TOKEN_PREFIX}${secret}`;
  return {
    token,
    prefix: token.slice(0, 12),
    hash: hashToken(token),
  };
}

function requireTokenOwner(ctx: AuthContext): void {
  if (appMode() !== "team") {
    throw badRequest("API tokens are only available in team mode");
  }
  if (ctx.userId === LINK_GUEST_ID || ctx.userId === LOCAL_USER_ID) {
    throw unauthorized();
  }
  if (!hasAnyAccess(ctx)) {
    throw forbidden("You need workspace or project access to create API tokens");
  }
}

function toInfo(row: {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}): ApiTokenInfo {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    createdAt: row.createdAt.getTime(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.getTime() : null,
  };
}

/** Tokens belonging to the caller, newest first. */
export async function listApiTokens(ctx: AuthContext): Promise<ApiTokenInfo[]> {
  requireTokenOwner(ctx);
  const rows = await db
    .select({
      id: schema.apiTokens.id,
      name: schema.apiTokens.name,
      tokenPrefix: schema.apiTokens.tokenPrefix,
      createdAt: schema.apiTokens.createdAt,
      lastUsedAt: schema.apiTokens.lastUsedAt,
    })
    .from(schema.apiTokens)
    .where(eq(schema.apiTokens.userId, ctx.userId))
    .orderBy(desc(schema.apiTokens.createdAt));
  return rows.map(toInfo);
}

/**
 * Mint a new token. The plaintext `token` is returned only here — store it
 * (e.g. in the agent's MCP config); subsequent list calls show the prefix.
 */
export async function createApiToken(
  ctx: AuthContext,
  nameInput: unknown,
): Promise<CreatedApiToken> {
  requireTokenOwner(ctx);
  const name = typeof nameInput === "string" ? nameInput.trim() : "";
  if (!name || name.length > 80) {
    throw badRequest("Name is required (max 80 characters)");
  }
  const { token, prefix, hash } = mintPlaintext();
  const row = {
    id: crypto.randomUUID(),
    userId: ctx.userId,
    name,
    tokenPrefix: prefix,
    tokenHash: hash,
    createdAt: new Date(),
    lastUsedAt: null as Date | null,
  };
  await db.insert(schema.apiTokens).values(row);
  return { ...toInfo(row), token };
}

/** Revoke one of the caller's tokens. */
export async function revokeApiToken(ctx: AuthContext, id: string): Promise<void> {
  requireTokenOwner(ctx);
  const deleted = await db
    .delete(schema.apiTokens)
    .where(and(eq(schema.apiTokens.id, id), eq(schema.apiTokens.userId, ctx.userId)))
    .returning({ id: schema.apiTokens.id });
  if (deleted.length === 0) throw notFound("API token");
}

/**
 * Resolve a Bearer token to its owning user id, or null if unknown/invalid.
 * Updates `lastUsedAt` on a successful match (best-effort).
 */
export async function resolveApiTokenUserId(
  plaintext: string,
): Promise<string | null> {
  if (!plaintext.startsWith(API_TOKEN_PREFIX) || plaintext.length < 20) {
    return null;
  }
  const hash = hashToken(plaintext);
  const [row] = await db
    .select({
      id: schema.apiTokens.id,
      userId: schema.apiTokens.userId,
    })
    .from(schema.apiTokens)
    .where(eq(schema.apiTokens.tokenHash, hash));
  if (!row) return null;
  // Fire-and-forget; auth must not fail if the touch write races.
  void db
    .update(schema.apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiTokens.id, row.id))
    .catch(() => undefined);
  return row.userId;
}
