import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { getNotebookFile } from "@/server/dal/notebook-files";
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
