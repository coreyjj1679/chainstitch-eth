import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { appUrl } from "@/server/mode";
import {
  SHARE_COOKIE,
  appendShareToken,
  parseShareTokens,
} from "@/lib/share-cookie";

type Params = { params: Promise<{ token: string }> };

/**
 * "Anyone with the link" landing: a valid token drops the share cookie and
 * forwards to the project; anything else lands on the login page. The link
 * grants nothing by itself — every request re-validates the token against
 * project_share_links (rotating or disabling the link cuts access off).
 */
export async function GET(request: Request, { params }: Params) {
  const { token } = await params;
  const [link] = await db
    .select({ projectId: schema.projectShareLinks.projectId })
    .from(schema.projectShareLinks)
    .where(eq(schema.projectShareLinks.token, token));

  if (!link) {
    return NextResponse.redirect(new URL("/login", appUrl()));
  }

  const response = NextResponse.redirect(new URL(`/p/${link.projectId}`, appUrl()));
  const existing = parseShareTokens(request.headers.get("cookie"));
  response.cookies.set(SHARE_COOKIE, appendShareToken(existing, token), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
    secure: appUrl().startsWith("https"),
  });
  return response;
}
