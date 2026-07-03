import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { saveBlocks, type IncomingBlock } from "@/server/dal/notebooks";

type Params = { params: Promise<{ id: string }> };

/** Replace-all block save. The notebook editor autosaves the full block list. */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    const body = await request.json();
    const incoming: IncomingBlock[] = Array.isArray(body.blocks) ? body.blocks : [];
    await saveBlocks(ctx, id, incoming);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
