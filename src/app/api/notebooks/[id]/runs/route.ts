import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { saveRun } from "@/server/dal/runs";

type Params = { params: Promise<{ id: string }> };

/** Save one completed Run-all output (opaque BigInt-safe JSON state). */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    const body = await request.json();
    return NextResponse.json(await saveRun(ctx, id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
