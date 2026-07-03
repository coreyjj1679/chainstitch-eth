import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { createProject, listProjects } from "@/server/dal/projects";

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext(request.headers);
    return NextResponse.json(await listProjects(ctx));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext(request.headers);
    const body = await request.json();
    return NextResponse.json(await createProject(ctx, body));
  } catch (error) {
    return handleApiError(error);
  }
}
