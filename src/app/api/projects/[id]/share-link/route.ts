import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import {
  deleteShareLink,
  getShareLink,
  upsertShareLink,
} from "@/server/dal/share-links";

type Params = { params: Promise<{ id: string }> };

/** The project's "anyone with the link" state — owners only. */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    return NextResponse.json(await getShareLink(ctx, id));
  } catch (error) {
    return handleApiError(error);
  }
}

/** Enable link sharing / change role; { reset: true } rotates the token. */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    const body = await request.json();
    return NextResponse.json(
      await upsertShareLink(ctx, id, body.role, body.reset === true),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    await deleteShareLink(ctx, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
