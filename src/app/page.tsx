import { headers } from "next/headers";
import { getSessionCookie } from "better-auth/cookies";
import { parseShareTokens } from "@/lib/share-cookie";
import { LandingPage } from "@/components/landing/landing-page";
import { ProjectsHome } from "@/components/home/projects-home";

/**
 * The root splits by audience: signed-out visitors on a team-mode (hosted)
 * instance get the marketing landing page; everyone else gets the project
 * list. The check is optimistic (cookie presence, like proxy.ts) — the DAL
 * still enforces the real session on every API call.
 */
export default async function RootPage() {
  const isTeam = process.env.APP_MODE?.trim().toLowerCase() === "team";
  if (!isTeam) return <ProjectsHome />;

  const requestHeaders = await headers();
  const hasSession = !!getSessionCookie(
    new Request("http://internal", { headers: requestHeaders }),
  );
  // "Anyone with the link" guests have no session but do have project access.
  const hasShareAccess =
    parseShareTokens(requestHeaders.get("cookie")).length > 0;

  if (hasSession || hasShareAccess) return <ProjectsHome />;
  return (
    <LandingPage
      demoUrl={process.env.DEMO_SHARE_URL || undefined}
      githubUrl={process.env.GITHUB_URL || undefined}
    />
  );
}
