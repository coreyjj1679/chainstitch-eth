import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { deleteRecipe, updateRecipe } from "@/server/dal/recipes";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    const body = await request.json();
    return NextResponse.json(await updateRecipe(ctx, id, body));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    await deleteRecipe(ctx, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
