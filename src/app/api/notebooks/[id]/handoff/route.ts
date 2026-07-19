import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { getNotebookHandoff } from "@/server/dal/notebook-files";

type Params = { params: Promise<{ id: string }> };

/** Static integration handoff brief (call sequence, events, variables). */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    return NextResponse.json(await getNotebookHandoff(ctx, id));
  } catch (error) {
    return handleApiError(error);
  }
}
