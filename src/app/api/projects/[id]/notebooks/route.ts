import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { createNotebook, listNotebooks } from "@/server/dal/notebooks";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    return NextResponse.json(await listNotebooks(ctx, id));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    const body = await request.json();
    return NextResponse.json(await createNotebook(ctx, id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
