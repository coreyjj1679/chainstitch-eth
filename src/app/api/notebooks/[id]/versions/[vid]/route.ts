import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { getVersion, restoreVersion } from "@/server/dal/notebooks";

type Params = { params: Promise<{ id: string; vid: string }> };

/** Full snapshot of one version (blocks included). */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id, vid } = await params;
    const ctx = await getAuthContext(request.headers);
    return NextResponse.json(await getVersion(ctx, id, vid));
  } catch (error) {
    return handleApiError(error);
  }
}

/** Restore this version as the current notebook content. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id, vid } = await params;
    const ctx = await getAuthContext(request.headers);
    return NextResponse.json(await restoreVersion(ctx, id, vid));
  } catch (error) {
    return handleApiError(error);
  }
}
