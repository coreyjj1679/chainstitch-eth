import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAuthContext } from "@/server/auth-context";
import { appMode } from "@/server/mode";
import { handleApiError } from "@/server/errors";

/**
 * Who am I + which mode is this instance running? Clients derive all
 * mode-dependent UI (login affordances, role gating) from this endpoint,
 * keeping APP_MODE a server-side-only concern.
 */
export async function GET(request: Request) {
  try {
    const mode = appMode();
    const ctx = await getAuthContext(request.headers);

    let name = "Local";
    let wallets: string[] = [];
    if (mode === "team") {
      const [user] = await db
        .select({ name: schema.user.name })
        .from(schema.user)
        .where(eq(schema.user.id, ctx.userId));
      name = user?.name ?? "Unknown";
      const rows = await db
        .select({ address: schema.walletAddress.address })
        .from(schema.walletAddress)
        .where(eq(schema.walletAddress.userId, ctx.userId));
      wallets = [...new Set(rows.map((r) => r.address))];
    }

    const [workspace] = await db
      .select({ id: schema.workspaces.id, name: schema.workspaces.name })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.workspaceId));

    return NextResponse.json({
      mode,
      user: { id: ctx.userId, name, wallets },
      role: ctx.role,
      projectRoles: ctx.projectRoles,
      workspace: workspace ?? { id: ctx.workspaceId, name: "Workspace" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
