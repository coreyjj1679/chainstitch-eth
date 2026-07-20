import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { reorderNotebooks } from "@/server/dal/notebooks";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    const body = (await request.json()) as { orderedIds?: unknown };
    return NextResponse.json(
      await reorderNotebooks(ctx, id, body.orderedIds),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
