import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { createRecipe, listRecipes } from "@/server/dal/recipes";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    return NextResponse.json(await listRecipes(ctx, id));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    const body = await request.json();
    return NextResponse.json(await createRecipe(ctx, id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
