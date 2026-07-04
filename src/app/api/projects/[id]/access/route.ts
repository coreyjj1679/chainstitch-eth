import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { listProjectAccess } from "@/server/dal/workspace";

type Params = { params: Promise<{ id: string }> };

/** Who can open this project (share dialog) — project owners only. */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    return NextResponse.json(await listProjectAccess(ctx, id));
  } catch (error) {
    return handleApiError(error);
  }
}
