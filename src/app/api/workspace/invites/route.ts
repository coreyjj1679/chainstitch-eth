import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { createInvite, listInvites } from "@/server/dal/workspace";

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext(request.headers);
    return NextResponse.json(await listInvites(ctx));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext(request.headers);
    const body = await request.json();
    return NextResponse.json(await createInvite(ctx, body.wallet, body.role));
  } catch (error) {
    return handleApiError(error);
  }
}
