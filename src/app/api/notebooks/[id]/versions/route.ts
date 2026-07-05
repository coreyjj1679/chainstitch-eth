import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { listVersions } from "@/server/dal/notebooks";

type Params = { params: Promise<{ id: string }> };

/** Edit history of a notebook, newest first (metadata only). */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    return NextResponse.json(await listVersions(ctx, id));
  } catch (error) {
    return handleApiError(error);
  }
}
