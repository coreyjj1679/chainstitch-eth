import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema, LOCAL_USER_ID } from "@/db";
import {
  requireProjectRole,
  requireRole,
  type AuthContext,
} from "@/server/auth-context";
import { badRequest, forbidden, notFound } from "@/server/errors";
import { requireProject } from "@/server/dal/projects";
import { upsertMembership, upsertProjectGrant } from "@/server/team";
import type { WorkspaceRole } from "@/db/schema";

/** One per-project access grant, as shown in the members dialog. */
export interface ProjectGrantDto {
  id: string;
  projectId: string;
  projectName: string;
  role: WorkspaceRole;
}

export interface MemberDto {
  /** workspace_members row id; null for users who only hold project grants. */
  id: string | null;
  userId: string;
  name: string;
  /** Workspace-wide role; null for project-only members. */
  role: WorkspaceRole | null;
  wallets: string[];
  joinedAt: number;
  grants: ProjectGrantDto[];
}

export interface InviteDto {
  id: string;
  wallet: string;
  role: WorkspaceRole;
  /** Set for project-scoped invites (grant one project, not the workspace). */
  projectId: string | null;
  projectName: string | null;
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

async function walletsOf(userId: string): Promise<string[]> {
  const rows = await db
    .select({ address: schema.walletAddress.address })
    .from(schema.walletAddress)
    .where(eq(schema.walletAddress.userId, userId));
  return [...new Set(rows.map((w) => w.address))];
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

  // Per-project grants, joined to project names (single-workspace instance).
  const grantRows = await db
    .select({
      id: schema.projectMembers.id,
      projectId: schema.projectMembers.projectId,
      userId: schema.projectMembers.userId,
      role: schema.projectMembers.role,
      createdAt: schema.projectMembers.createdAt,
      projectName: schema.projects.name,
      name: schema.user.name,
    })
    .from(schema.projectMembers)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectMembers.projectId))
    .innerJoin(schema.user, eq(schema.user.id, schema.projectMembers.userId))
    .orderBy(asc(schema.projectMembers.createdAt));

  const grantsByUser = new Map<string, typeof grantRows>();
  for (const grant of grantRows) {
    const list = grantsByUser.get(grant.userId) ?? [];
    list.push(grant);
    grantsByUser.set(grant.userId, list);
  }
  const toGrantDtos = (userId: string): ProjectGrantDto[] =>
    (grantsByUser.get(userId) ?? []).map((g) => ({
      id: g.id,
      projectId: g.projectId,
      projectName: g.projectName,
      role: g.role,
    }));

  const members: MemberDto[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    // The implicit local-mode owner is an implementation detail, not a teammate.
    if (row.userId === LOCAL_USER_ID) continue;
    seen.add(row.userId);
    members.push({
      id: row.id,
      userId: row.userId,
      name: row.name,
      role: row.role,
      wallets: await walletsOf(row.userId),
      joinedAt: row.createdAt.getTime(),
      grants: toGrantDtos(row.userId),
    });
  }
  // Users who only hold project grants (no workspace membership).
  for (const [userId, grants] of grantsByUser) {
    if (seen.has(userId) || userId === LOCAL_USER_ID) continue;
    members.push({
      id: null,
      userId,
      name: grants[0].name,
      role: null,
      wallets: await walletsOf(userId),
      joinedAt: Math.min(...grants.map((g) => g.createdAt.getTime())),
      grants: toGrantDtos(userId),
    });
  }
  return members;
}

export async function listInvites(ctx: AuthContext): Promise<InviteDto[]> {
  requireRole(ctx, "owner");
  const rows = await db
    .select({
      invite: schema.invites,
      projectName: schema.projects.name,
    })
    .from(schema.invites)
    .leftJoin(schema.projects, eq(schema.projects.id, schema.invites.projectId))
    .where(
      and(
        eq(schema.invites.workspaceId, ctx.workspaceId),
        eq(schema.invites.status, "pending"),
      ),
    )
    .orderBy(asc(schema.invites.createdAt));
  return rows.map(({ invite, projectName }) => ({
    id: invite.id,
    wallet: invite.wallet,
    role: invite.role,
    projectId: invite.projectId,
    projectName: invite.projectId ? (projectName ?? "(deleted project)") : null,
    status: invite.status as "pending" | "accepted",
    createdAt: invite.createdAt.getTime(),
  }));
}

/**
 * Invite a wallet address, either workspace-wide (projectId null) or to a
 * single project. If a user with that wallet already exists the access is
 * granted immediately; otherwise the invite is claimed on their first
 * SIWE sign-in.
 *
 * Workspace-wide invites need a workspace owner; project-scoped invites are
 * open to that project's effective owners (so a shared-project owner can
 * bring in collaborators without workspace-level rights).
 */
export async function createInvite(
  ctx: AuthContext,
  walletInput: unknown,
  roleInput: unknown,
  projectIdInput?: unknown,
): Promise<InviteDto> {
  const projectId = projectIdInput ? String(projectIdInput) : null;
  let projectName: string | null = null;
  if (projectId) {
    const project = await requireProject(ctx, projectId, "owner");
    projectName = project.name;
  } else {
    requireRole(ctx, "owner");
  }

  const role = parseRole(roleInput);
  const wallet = String(walletInput ?? "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    throw badRequest("Enter a valid wallet address (0x…)");
  }

  // Whole-workspace invites for someone who is already a member are a no-op;
  // reject them. Project invites are allowed for existing members — a grant
  // can raise their role on that one project.
  if (!projectId) {
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
  }

  // Re-inviting a wallet with the same scope updates the role instead of
  // duplicating (a workspace invite and a project invite can coexist).
  const [pending] = await db
    .select()
    .from(schema.invites)
    .where(
      and(
        eq(schema.invites.workspaceId, ctx.workspaceId),
        eq(schema.invites.wallet, wallet),
        eq(schema.invites.status, "pending"),
        projectId
          ? eq(schema.invites.projectId, projectId)
          : isNull(schema.invites.projectId),
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
      projectId,
      projectName,
      status: "pending",
      createdAt: pending.createdAt.getTime(),
    };
  }

  // A user already signed in with this wallet before (e.g. removed member):
  // grant access immediately, no pending state.
  const [existingUser] = await db
    .select({ userId: schema.walletAddress.userId })
    .from(schema.walletAddress)
    .where(eq(sql`lower(${schema.walletAddress.address})`, wallet));

  const invite = {
    id: crypto.randomUUID(),
    workspaceId: ctx.workspaceId,
    wallet,
    role,
    projectId,
    invitedBy: ctx.userId,
    status: (existingUser ? "accepted" : "pending") as "accepted" | "pending",
    createdAt: new Date(),
  };
  await db.insert(schema.invites).values(invite);
  if (existingUser) {
    if (projectId) {
      await upsertProjectGrant(projectId, existingUser.userId, role, true);
    } else {
      await upsertMembership(ctx.workspaceId, existingUser.userId, role, false);
    }
  }
  return {
    id: invite.id,
    wallet,
    role,
    projectId,
    projectName,
    status: invite.status,
    createdAt: invite.createdAt.getTime(),
  };
}

export async function revokeInvite(ctx: AuthContext, inviteId: string): Promise<void> {
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(
      and(eq(schema.invites.id, inviteId), eq(schema.invites.workspaceId, ctx.workspaceId)),
    );
  if (!invite) throw notFound("Invite");
  // Project-scoped invites can be revoked by that project's effective owners.
  if (invite.projectId) requireProjectRole(ctx, invite.projectId, "owner", "Invite");
  else requireRole(ctx, "owner");
  await db.delete(schema.invites).where(eq(schema.invites.id, inviteId));
}

/** Per-project sharing panel: everyone with access, and pending invites. */
export interface ProjectAccessDto {
  members: Array<{
    /** project_members row id — null for workspace members (not revocable here). */
    grantId: string | null;
    userId: string;
    name: string;
    wallets: string[];
    role: WorkspaceRole;
    /** Access source: their workspace role or a project grant. */
    via: "workspace" | "grant";
  }>;
  invites: InviteDto[];
}

/** Who can open this project, and how — visible to the project's owners. */
export async function listProjectAccess(
  ctx: AuthContext,
  projectId: string,
): Promise<ProjectAccessDto> {
  const project = await requireProject(ctx, projectId, "owner");

  const memberRows = await db
    .select({
      userId: schema.workspaceMembers.userId,
      role: schema.workspaceMembers.role,
      name: schema.user.name,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.user, eq(schema.user.id, schema.workspaceMembers.userId))
    .where(eq(schema.workspaceMembers.workspaceId, ctx.workspaceId))
    .orderBy(asc(schema.workspaceMembers.createdAt));
  const grantRows = await db
    .select({
      grantId: schema.projectMembers.id,
      userId: schema.projectMembers.userId,
      role: schema.projectMembers.role,
      name: schema.user.name,
    })
    .from(schema.projectMembers)
    .innerJoin(schema.user, eq(schema.user.id, schema.projectMembers.userId))
    .where(eq(schema.projectMembers.projectId, projectId))
    .orderBy(asc(schema.projectMembers.createdAt));

  const members: ProjectAccessDto["members"] = [];
  const granted = new Set(grantRows.map((g) => g.userId));
  for (const grant of grantRows) {
    members.push({
      grantId: grant.grantId,
      userId: grant.userId,
      name: grant.name,
      wallets: await walletsOf(grant.userId),
      role: grant.role,
      via: "grant",
    });
  }
  for (const member of memberRows) {
    // Workspace members see every project; a grant row (higher role) wins.
    if (member.userId === LOCAL_USER_ID || granted.has(member.userId)) continue;
    members.push({
      grantId: null,
      userId: member.userId,
      name: member.name,
      wallets: await walletsOf(member.userId),
      role: member.role,
      via: "workspace",
    });
  }

  const inviteRows = await db
    .select()
    .from(schema.invites)
    .where(
      and(
        eq(schema.invites.projectId, projectId),
        eq(schema.invites.status, "pending"),
      ),
    )
    .orderBy(asc(schema.invites.createdAt));
  return {
    members,
    invites: inviteRows.map((invite) => ({
      id: invite.id,
      wallet: invite.wallet,
      role: invite.role,
      projectId,
      projectName: project.name,
      status: "pending" as const,
      createdAt: invite.createdAt.getTime(),
    })),
  };
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
  // Removal means full lockout: any per-project grants go too. Use
  // removeProjectGrant to trim access instead of removing the member.
  await db
    .delete(schema.projectMembers)
    .where(eq(schema.projectMembers.userId, member.userId));
}

/** Revoke a single per-project grant (the project-scoped removeMember). */
export async function removeProjectGrant(ctx: AuthContext, grantId: string): Promise<void> {
  const [grant] = await db
    .select({
      id: schema.projectMembers.id,
      projectId: schema.projectMembers.projectId,
    })
    .from(schema.projectMembers)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectMembers.projectId))
    .where(
      and(
        eq(schema.projectMembers.id, grantId),
        eq(schema.projects.workspaceId, ctx.workspaceId),
      ),
    );
  if (!grant) throw notFound("Grant");
  // Workspace owners can always revoke; project owners within their project.
  if (ctx.role !== "owner") requireProjectRole(ctx, grant.projectId, "owner", "Grant");
  await db.delete(schema.projectMembers).where(eq(schema.projectMembers.id, grantId));
}
