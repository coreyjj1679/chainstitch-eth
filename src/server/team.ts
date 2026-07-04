import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema, DEFAULT_WORKSPACE_ID } from "@/db";
import { ownerWallets } from "@/server/mode";
import type { WorkspaceRole } from "@/db/schema";

/**
 * Team-mode sign-in policy: a self-hosted instance is private. A wallet may
 * sign in only when it is an OWNER_WALLETS entry, holds a pending invite, or
 * already belongs to a workspace member or project-grant holder.
 */
export async function isWalletAllowedToSignIn(address: string): Promise<boolean> {
  const wallet = address.toLowerCase();
  if (ownerWallets().includes(wallet)) return true;

  const [invite] = await db
    .select({ id: schema.invites.id })
    .from(schema.invites)
    .where(and(eq(schema.invites.wallet, wallet), eq(schema.invites.status, "pending")))
    .limit(1);
  if (invite) return true;

  const [member] = await db
    .select({ id: schema.workspaceMembers.id })
    .from(schema.walletAddress)
    .innerJoin(
      schema.workspaceMembers,
      eq(schema.workspaceMembers.userId, schema.walletAddress.userId),
    )
    .where(eq(sql`lower(${schema.walletAddress.address})`, wallet))
    .limit(1);
  if (member) return true;

  const [grantee] = await db
    .select({ id: schema.projectMembers.id })
    .from(schema.walletAddress)
    .innerJoin(
      schema.projectMembers,
      eq(schema.projectMembers.userId, schema.walletAddress.userId),
    )
    .where(eq(sql`lower(${schema.walletAddress.address})`, wallet))
    .limit(1);
  return !!grantee;
}

/** Insert a membership, or (optionally) overwrite the role of an existing one. */
export async function upsertMembership(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  overwrite: boolean,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    );
  if (!existing) {
    await db.insert(schema.workspaceMembers).values({
      id: crypto.randomUUID(),
      workspaceId,
      userId,
      role,
      createdAt: new Date(),
    });
  } else if (overwrite && existing.role !== role) {
    await db
      .update(schema.workspaceMembers)
      .set({ role })
      .where(eq(schema.workspaceMembers.id, existing.id));
  }
}

/** Insert a per-project grant, or (optionally) overwrite an existing one. */
export async function upsertProjectGrant(
  projectId: string,
  userId: string,
  role: WorkspaceRole,
  overwrite: boolean,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.projectMembers)
    .where(
      and(
        eq(schema.projectMembers.projectId, projectId),
        eq(schema.projectMembers.userId, userId),
      ),
    );
  if (!existing) {
    await db.insert(schema.projectMembers).values({
      id: crypto.randomUUID(),
      projectId,
      userId,
      role,
      createdAt: new Date(),
    });
  } else if (overwrite && existing.role !== role) {
    await db
      .update(schema.projectMembers)
      .set({ role })
      .where(eq(schema.projectMembers.id, existing.id));
  }
}

/**
 * Post sign-in bootstrap (better-auth session.create hook): grant owner role
 * to OWNER_WALLETS and claim any pending invites for the user's wallets.
 * Idempotent — runs on every login.
 */
export async function onUserSignedIn(userId: string): Promise<void> {
  const rows = await db
    .select({ address: schema.walletAddress.address })
    .from(schema.walletAddress)
    .where(eq(schema.walletAddress.userId, userId));
  const wallets = rows.map((r) => r.address.toLowerCase());
  if (wallets.length === 0) return;

  // OWNER_WALLETS wins over any invited role.
  if (wallets.some((w) => ownerWallets().includes(w))) {
    await upsertMembership(DEFAULT_WORKSPACE_ID, userId, "owner", true);
  }

  const pending = await db
    .select()
    .from(schema.invites)
    .where(
      and(inArray(schema.invites.wallet, wallets), eq(schema.invites.status, "pending")),
    );
  for (const invite of pending) {
    if (invite.projectId) {
      // Project-scoped invite → grant on that project only. Skip the grant
      // (but still settle the invite) if the project was deleted meanwhile.
      const [project] = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.id, invite.projectId));
      if (project) await upsertProjectGrant(invite.projectId, userId, invite.role, false);
    } else {
      await upsertMembership(invite.workspaceId, userId, invite.role, false);
    }
    await db
      .update(schema.invites)
      .set({ status: "accepted" })
      .where(eq(schema.invites.id, invite.id));
  }
}
