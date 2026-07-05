import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { SHARE_COOKIE } from "@/lib/share-cookie";

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

  // Marketing-only deployment (e.g. Vercel): APP_INSTANCE_URL points at the
  // real self-hosted instance. This build serves only the landing page and
  // docs — every other path (login, share links, app, API) redirects there,
  // so the SQLite-backed routes never execute on serverless.
  const instanceUrl = process.env.APP_INSTANCE_URL?.trim();
  if (instanceUrl) {
    if (pathname === "/" || pathname === "/docs") return NextResponse.next();
    return NextResponse.redirect(
      new URL(pathname + request.nextUrl.search, instanceUrl),
    );
  }

  // API routes authenticate per-request in the DAL (401 JSON, not redirects).
  if (pathname.startsWith("/api")) return NextResponse.next();
  // Share-link landing must stay reachable without any cookie at all.
  if (pathname.startsWith("/share")) return NextResponse.next();

  const hasSession = !!getSessionCookie(request);
  // "Anyone with the link" guests carry the share cookie instead of a
  // session; token validity is checked per-request in the DAL.
  const hasShareLink = !!request.cookies.get(SHARE_COOKIE)?.value;
  if (pathname === "/login") {
    return hasSession
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }
  // The root stays public: signed-out visitors get the landing page there
  // (the page itself decides), while app routes below still require access.
  if (pathname === "/") return NextResponse.next();
  // Docs are static marketing/reference content — public like the root.
  if (pathname === "/docs") return NextResponse.next();
  if (!hasSession && !hasShareLink) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except static assets and images.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
