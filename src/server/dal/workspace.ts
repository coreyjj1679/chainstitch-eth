import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema, LOCAL_USER_ID } from "@/db";
import { requireRole, type AuthContext } from "@/server/auth-context";
import { badRequest, forbidden, notFound } from "@/server/errors";
import { upsertMembership } from "@/server/team";
import type { WorkspaceRole } from "@/db/schema";

export interface MemberDto {
  id: string;
  userId: string;
  name: string;
  role: WorkspaceRole;
  wallets: string[];
  joinedAt: number;
}

export interface InviteDto {
  id: string;
  wallet: string;
  role: WorkspaceRole;
  status: "pending" | "accepted";
  createdAt: number;
}

const ASSIGNABLE_ROLES: WorkspaceRole[] = ["viewer", "editor", "owner"];

function parseRole(role: unknown): WorkspaceRole {
  if (typeof role === "string" && ASSIGNABLE_ROLES.includes(role as WorkspaceRole)) {
    return role as WorkspaceRole;
  }
  throw badRequest("role must be viewer, editor or owner");
}

export async function listMembers(ctx: AuthContext): Promise<MemberDto[]> {
  requireRole(ctx, "viewer");
  const rows = await db
    .select({
      id: schema.workspaceMembers.id,
      userId: schema.workspaceMembers.userId,
      role: schema.workspaceMembers.role,
      createdAt: schema.workspaceMembers.createdAt,
      name: schema.user.name,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.user, eq(schema.user.id, schema.workspaceMembers.userId))
    .where(eq(schema.workspaceMembers.workspaceId, ctx.workspaceId))
    .orderBy(asc(schema.workspaceMembers.createdAt));

  const members: MemberDto[] = [];
  for (const row of rows) {
    // The implicit local-mode owner is an implementation detail, not a teammate.
    if (row.userId === LOCAL_USER_ID) continue;
    const wallets = await db
      .select({ address: schema.walletAddress.address })
      .from(schema.walletAddress)
      .where(eq(schema.walletAddress.userId, row.userId));
    members.push({
      id: row.id,
      userId: row.userId,
      name: row.name,
      role: row.role,
      wallets: [...new Set(wallets.map((w) => w.address))],
      joinedAt: row.createdAt.getTime(),
    });
  }
  return members;
}

export async function listInvites(ctx: AuthContext): Promise<InviteDto[]> {
  requireRole(ctx, "owner");
  const rows = await db
    .select()
    .from(schema.invites)
    .where(
      and(
        eq(schema.invites.workspaceId, ctx.workspaceId),
        eq(schema.invites.status, "pending"),
      ),
    )
    .orderBy(asc(schema.invites.createdAt));
  return rows.map((r) => ({
    id: r.id,
    wallet: r.wallet,
    role: r.role,
    status: r.status as "pending" | "accepted",
    createdAt: r.createdAt.getTime(),
  }));
}

/**
 * Invite a wallet address. If a user with that wallet already exists they are
 * added as a member immediately; otherwise the invite is claimed on their
 * first SIWE sign-in.
 */
export async function createInvite(
  ctx: AuthContext,
  walletInput: unknown,
  roleInput: unknown,
): Promise<InviteDto> {
  requireRole(ctx, "owner");
  const role = parseRole(roleInput);
  const wallet = String(walletInput ?? "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    throw badRequest("Enter a valid wallet address (0x…)");
  }

  // Already a member (via any linked wallet)?
  const [existingMember] = await db
    .select({ id: schema.workspaceMembers.id })
    .from(schema.walletAddress)
    .innerJoin(
      schema.workspaceMembers,
      eq(schema.workspaceMembers.userId, schema.walletAddress.userId),
    )
    .where(
      and(
        eq(sql`lower(${schema.walletAddress.address})`, wallet),
        eq(schema.workspaceMembers.workspaceId, ctx.workspaceId),
      ),
    );
  if (existingMember) throw badRequest("That wallet already belongs to a member");

  // Re-inviting a pending wallet updates the role instead of duplicating.
  const [pending] = await db
    .select()
    .from(schema.invites)
    .where(
      and(
        eq(schema.invites.workspaceId, ctx.workspaceId),
        eq(schema.invites.wallet, wallet),
        eq(schema.invites.status, "pending"),
      ),
    );
  if (pending) {
    await db
      .update(schema.invites)
      .set({ role })
      .where(eq(schema.invites.id, pending.id));
    return {
      id: pending.id,
      wallet,
      role,
      status: "pending",
      createdAt: pending.createdAt.getTime(),
    };
  }

  // A user already signed in with this wallet before (e.g. removed member):
  // grant membership immediately, no pending state.
  const [existingUser] = await db
    .select({ userId: schema.walletAddress.userId })
    .from(schema.walletAddress)
    .where(eq(sql`lower(${schema.walletAddress.address})`, wallet));

  const invite = {
    id: crypto.randomUUID(),
    workspaceId: ctx.workspaceId,
    wallet,
    role,
    invitedBy: ctx.userId,
    status: (existingUser ? "accepted" : "pending") as "accepted" | "pending",
    createdAt: new Date(),
  };
  await db.insert(schema.invites).values(invite);
  if (existingUser) {
    await upsertMembership(ctx.workspaceId, existingUser.userId, role, false);
  }
  return {
    id: invite.id,
    wallet,
    role,
    status: invite.status,
    createdAt: invite.createdAt.getTime(),
  };
}

export async function revokeInvite(ctx: AuthContext, inviteId: string): Promise<void> {
  requireRole(ctx, "owner");
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(
      and(eq(schema.invites.id, inviteId), eq(schema.invites.workspaceId, ctx.workspaceId)),
    );
  if (!invite) throw notFound("Invite");
  await db.delete(schema.invites).where(eq(schema.invites.id, inviteId));
}

async function requireMembership(ctx: AuthContext, membershipId: string) {
  const [member] = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.id, membershipId),
        eq(schema.workspaceMembers.workspaceId, ctx.workspaceId),
      ),
    );
  if (!member || member.userId === LOCAL_USER_ID) throw notFound("Member");
  return member;
}

/** Owners minus the implicit local user; the workspace must always keep one. */
async function countRealOwners(ctx: AuthContext): Promise<number> {
  const owners = await db
    .select({ userId: schema.workspaceMembers.userId })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, ctx.workspaceId),
        eq(schema.workspaceMembers.role, "owner"),
      ),
    );
  return owners.filter((o) => o.userId !== LOCAL_USER_ID).length;
}

export async function updateMemberRole(
  ctx: AuthContext,
  membershipId: string,
  roleInput: unknown,
): Promise<void> {
  requireRole(ctx, "owner");
  const role = parseRole(roleInput);
  const member = await requireMembership(ctx, membershipId);
  if (member.role === "owner" && role !== "owner" && (await countRealOwners(ctx)) <= 1) {
    throw forbidden("The workspace needs at least one owner");
  }
  await db
    .update(schema.workspaceMembers)
    .set({ role })
    .where(eq(schema.workspaceMembers.id, membershipId));
}

export async function removeMember(ctx: AuthContext, membershipId: string): Promise<void> {
  requireRole(ctx, "owner");
  const member = await requireMembership(ctx, membershipId);
  if (member.role === "owner" && (await countRealOwners(ctx)) <= 1) {
    throw forbidden("The workspace needs at least one owner");
  }
  await db
    .delete(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.id, membershipId));
}
