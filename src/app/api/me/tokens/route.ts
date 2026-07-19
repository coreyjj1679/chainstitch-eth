import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { createApiToken, listApiTokens } from "@/server/dal/api-tokens";

/** List the caller's API tokens (prefixes only — secrets are never re-shown). */
export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext(request.headers);
    return NextResponse.json(await listApiTokens(ctx));
  } catch (error) {
    return handleApiError(error);
  }
}

/** Mint a new token. The plaintext value is returned only in this response. */
export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext(request.headers);
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await createApiToken(ctx, body?.name));
  } catch (error) {
    return handleApiError(error);
  }
}
