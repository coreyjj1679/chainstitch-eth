import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { listRuns } from "@/server/dal/runs";

type Params = { params: Promise<{ id: string }> };

/** Saved Run-all outputs across the project's notebooks, newest first. */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    return NextResponse.json(await listRuns(ctx, id));
  } catch (error) {
    return handleApiError(error);
  }
}
