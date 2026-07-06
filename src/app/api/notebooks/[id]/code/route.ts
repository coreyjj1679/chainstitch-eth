import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { getNotebookCode } from "@/server/dal/notebook-files";

type Params = { params: Promise<{ id: string }> };

/** Whole-notebook generated source: ?flavor=wagmi|viem|python|rust|solidity */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    const flavor = new URL(request.url).searchParams.get("flavor") ?? "wagmi";
    return NextResponse.json(await getNotebookCode(ctx, id, flavor));
  } catch (error) {
    return handleApiError(error);
  }
}
