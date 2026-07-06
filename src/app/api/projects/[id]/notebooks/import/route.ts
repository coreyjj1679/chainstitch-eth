import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { importNotebookFile } from "@/server/dal/notebook-files";

type Params = { params: Promise<{ id: string }> };

/** Import a portable notebook manifest as a new notebook in this project. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    const body = await request.json().catch(() => {
      throw new SyntaxError("Body must be JSON");
    });
    return NextResponse.json(await importNotebookFile(ctx, id, body), { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
    }
    return handleApiError(error);
  }
}
