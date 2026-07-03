import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic auth redirects for team mode (cookie presence only — real
 * enforcement lives in the data access layer, which returns 401/403).
 * Local mode is a no-op: no login, no redirects.
 */
export default function proxy(request: NextRequest) {
  if (process.env.APP_MODE?.trim().toLowerCase() !== "team") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  // API routes authenticate per-request in the DAL (401 JSON, not redirects).
  if (pathname.startsWith("/api")) return NextResponse.next();

  const hasSession = !!getSessionCookie(request);
  if (pathname === "/login") {
    return hasSession
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }
  if (!hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except static assets and images.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
