import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { getNotebookFile, updateNotebookBlocks } from "@/server/dal/notebook-files";
import { notebookFileName } from "@/lib/notebook-file";

type Params = { params: Promise<{ id: string }> };

/** The notebook as a portable, versioned JSON manifest (download-friendly). */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    const file = await getNotebookFile(ctx, id);
    return NextResponse.json(file, {
      headers: {
        "Content-Disposition": `attachment; filename="${notebookFileName(file.title)}"`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Replace the notebook's content from a manifest — the in-place counterpart
 * to the project-level import. The previous content stays restorable in the
 * notebook's edit history.
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    const body = await request.json().catch(() => {
      throw new SyntaxError("Body must be JSON");
    });
    return NextResponse.json(await updateNotebookBlocks(ctx, id, body));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
    }
    return handleApiError(error);
  }
}
