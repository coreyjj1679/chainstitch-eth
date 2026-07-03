import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import {
  listStateViews,
  saveStateViews,
  type IncomingStateTitle,
  type IncomingStateView,
} from "@/server/dal/state-views";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    return NextResponse.json(await listStateViews(ctx, id));
  } catch (error) {
    return handleApiError(error);
  }
}

/** Replace-all save of the project's state dashboard (cards + titles). */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    const body = await request.json();
    const views: IncomingStateView[] = Array.isArray(body.views) ? body.views : [];
    const titles: IncomingStateTitle[] = Array.isArray(body.titles) ? body.titles : [];
    await saveStateViews(ctx, id, views, titles);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
