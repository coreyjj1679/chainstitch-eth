import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { revokeApiToken } from "@/server/dal/api-tokens";

/** Revoke one of the caller's API tokens. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext(request.headers);
    const { id } = await params;
    await revokeApiToken(ctx, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
