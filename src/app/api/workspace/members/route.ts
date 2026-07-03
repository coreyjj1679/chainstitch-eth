import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { listMembers } from "@/server/dal/workspace";

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext(request.headers);
    return NextResponse.json(await listMembers(ctx));
  } catch (error) {
    return handleApiError(error);
  }
}
