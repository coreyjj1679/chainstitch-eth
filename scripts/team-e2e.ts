/**
 * End-to-end test of team mode over HTTP: SIWE login, invite-only access,
 * role enforcement, proxy redirects. Spawns its own dev server on a temp
 * database — no setup needed.
 *
 * Run: npm run test:team
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const PORT = 3987;
const BASE = `http://localhost:${PORT}`;

// anvil's well-known dev keys — identities only, nothing on-chain here.
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const EDITOR_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const VIEWER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const STRANGER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";

let passed = 0;
let failed = 0;
function ok(condition: unknown, label: string) {
  if (condition) {
    passed++;
    console.log(`ok: ${label}`);
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

async function siweLogin(privateKey: `0x${string}`): Promise<string | null> {
  const account = privateKeyToAccount(privateKey);
  const nonceRes = await fetch(`${BASE}/api/auth/siwe/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ walletAddress: account.address, chainId: 1 }),
  });
  if (!nonceRes.ok) return null;
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const message = createSiweMessage({
    address: account.address,
    chainId: 1,
    domain: `localhost:${PORT}`,
    uri: BASE,
    nonce,
    version: "1",
    statement: "Sign in to Chainstitch",
  });
  const signature = await account.signMessage({ message });
  const verifyRes = await fetch(`${BASE}/api/auth/siwe/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({
      message,
      signature,
      walletAddress: account.address,
      chainId: 1,
    }),
  });
  if (!verifyRes.ok) return null;
  const setCookies = verifyRes.headers.getSetCookie();
  const session = setCookies.find((c) => c.includes("session_token"));
  return session ? session.split(";")[0] : null;
}

function client(cookie: string | null) {
  return async (method: string, urlPath: string, body?: unknown) => {
    const res = await fetch(`${BASE}${urlPath}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: BASE,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    let json: unknown = null;
    try {
      json = await res.clone().json();
    } catch {
      // non-JSON response (e.g. redirects)
    }
    return { status: res.status, json, headers: res.headers };
  };
}

async function waitForServer(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/me`, { redirect: "manual" });
      if (res.status > 0) return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("dev server did not come up in time");
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chainstitch-e2e-"));
  const ownerAddress = privateKeyToAccount(OWNER_KEY).address;

  console.log("Starting team-mode dev server…");
  const logs: string[] = [];
  const server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      CHAINSTITCH_DB_PATH: path.join(dir, "e2e.db"),
      // A developer's `next dev` may already be running in this checkout;
      // use an isolated build dir so the two don't fight over .next.
      // (Must be inside the project, hence not the temp dir.)
      NEXT_DIST_DIR: ".next-e2e",
      APP_MODE: "team",
      OWNER_WALLETS: ownerAddress,
      BETTER_AUTH_SECRET: "e2e-test-secret-e2e-test-secret-e2e",
      APP_URL: BASE,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d: Buffer) => logs.push(d.toString()));
  server.stderr.on("data", (d: Buffer) => logs.push(d.toString()));

  try {
    try {
      await waitForServer(90_000);
    } catch (e) {
      console.error("--- dev server output ---\n" + logs.join(""));
      throw e;
    }

    // Unauthenticated access
    const anon = client(null);
    ok((await anon("GET", "/api/projects")).status === 401, "anonymous API request gets 401");
    const home = await anon("GET", "/");
    ok(
      home.status === 307 && home.headers.get("location")?.includes("/login"),
      "anonymous page request redirects to /login",
    );
    ok((await anon("GET", "/login")).status === 200, "login page is reachable");

    // Login policy
    ok((await siweLogin(STRANGER_KEY)) === null, "uninvited wallet cannot sign in");
    const ownerCookie = await siweLogin(OWNER_KEY);
    ok(!!ownerCookie, "owner wallet signs in via SIWE");
    const owner = client(ownerCookie);
    const me = await owner("GET", "/api/me");
    ok(
      (me.json as { role?: string })?.role === "owner",
      "OWNER_WALLETS grants the owner role",
    );

    // Owner sets up content
    const project = await owner("POST", "/api/projects", {
      name: "E2E",
      chainId: 31337,
      rpcUrl: "http://127.0.0.1:8545",
    });
    ok(project.status === 200, "owner creates a project");
    const projectId = (project.json as { id: string }).id;

    // Invites
    const editorAddress = privateKeyToAccount(EDITOR_KEY).address;
    const viewerAddress = privateKeyToAccount(VIEWER_KEY).address;
    ok(
      (await owner("POST", "/api/workspace/invites", { wallet: editorAddress, role: "editor" }))
        .status === 200,
      "owner invites editor wallet",
    );
    ok(
      (await owner("POST", "/api/workspace/invites", { wallet: viewerAddress, role: "viewer" }))
        .status === 200,
      "owner invites viewer wallet",
    );

    // Editor: claims invite on first login, can edit content, not settings
    const editorCookie = await siweLogin(EDITOR_KEY);
    ok(!!editorCookie, "invited editor signs in");
    const editor = client(editorCookie);
    ok(
      ((await editor("GET", "/api/me")).json as { role?: string })?.role === "editor",
      "invite role is claimed on first sign-in",
    );
    ok(
      (
        await editor("POST", `/api/projects/${projectId}/notebooks`, { title: "From editor" })
      ).status === 200,
      "editor creates a notebook",
    );
    ok(
      (await editor("PATCH", `/api/projects/${projectId}`, { rpcUrl: "http://x" })).status ===
        403,
      "editor cannot change project settings",
    );
    ok(
      (
        await editor("POST", "/api/workspace/invites", {
          wallet: privateKeyToAccount(STRANGER_KEY).address,
          role: "owner",
        })
      ).status === 403,
      "editor cannot invite",
    );

    // Viewer: read + run only
    const viewerCookie = await siweLogin(VIEWER_KEY);
    const viewer = client(viewerCookie);
    ok(
      ((await viewer("GET", "/api/me")).json as { role?: string })?.role === "viewer",
      "viewer role claimed",
    );
    ok((await viewer("GET", "/api/projects")).status === 200, "viewer lists projects");
    ok(
      (await viewer("POST", `/api/projects/${projectId}/contracts`, { name: "x", abi: [] }))
        .status === 403,
      "viewer cannot add contracts",
    );

    // Member management: removing a member locks them out
    const members = await owner("GET", "/api/workspace/members");
    const list = members.json as Array<{ id: string; role: string; wallets: string[] }>;
    ok(list.length === 3, `workspace has 3 members (got ${list.length})`);
    const viewerMember = list.find((m) =>
      m.wallets.some((w) => w.toLowerCase() === viewerAddress.toLowerCase()),
    );
    ok(!!viewerMember, "viewer appears in the member list");
    ok(
      (await owner("DELETE", `/api/workspace/members/${viewerMember!.id}`)).status === 200,
      "owner removes the viewer",
    );
    ok(
      (await viewer("GET", "/api/projects")).status === 403,
      "removed member loses access immediately",
    );
    ok((await siweLogin(VIEWER_KEY)) === null, "removed member cannot sign back in");

    // Project-scoped invite: guest sees one project, nothing else
    const guestAddress = privateKeyToAccount(STRANGER_KEY).address;
    ok(
      (
        await owner("POST", "/api/workspace/invites", {
          wallet: guestAddress,
          role: "viewer",
          projectId,
        })
      ).status === 200,
      "owner invites a wallet to a single project",
    );
    const guestCookie = await siweLogin(STRANGER_KEY);
    ok(!!guestCookie, "project-scoped invite allows sign-in");
    const guest = client(guestCookie);
    const guestMe = (await guest("GET", "/api/me")).json as {
      role: string | null;
      projectRoles: Record<string, string>;
    };
    ok(
      guestMe.role === null && guestMe.projectRoles[projectId] === "viewer",
      "guest has no workspace role, only the project grant",
    );
    const guestProjects = await guest("GET", "/api/projects");
    ok(
      guestProjects.status === 200 &&
        (guestProjects.json as Array<{ id: string }>).length === 1,
      "guest lists exactly the granted project",
    );
    ok(
      (await guest("POST", `/api/projects/${projectId}/notebooks`, { title: "x" }))
        .status === 403,
      "viewer grant cannot create notebooks",
    );
    ok(
      (await guest("GET", "/api/workspace/members")).status === 403,
      "guest cannot list workspace members",
    );

    // Revoking the grant locks the guest out again
    const roster = await owner("GET", "/api/workspace/members");
    const guestEntry = (
      roster.json as Array<{
        userId: string;
        wallets: string[];
        grants: Array<{ id: string }>;
      }>
    ).find((m) => m.wallets.some((w) => w.toLowerCase() === guestAddress.toLowerCase()));
    ok(!!guestEntry && guestEntry.grants.length === 1, "guest appears in roster with grant");
    ok(
      (await owner("DELETE", `/api/workspace/grants/${guestEntry!.grants[0].id}`))
        .status === 200,
      "owner revokes the project grant",
    );
    ok(
      (await guest("GET", "/api/projects")).status === 403,
      "revoked guest loses access immediately",
    );
    ok((await siweLogin(STRANGER_KEY)) === null, "revoked guest cannot sign back in");

    // "Anyone with the link": no account required at all
    const linkRes = await owner("PUT", `/api/projects/${projectId}/share-link`, {
      role: "viewer",
    });
    ok(linkRes.status === 200, "owner turns on link sharing");
    const token = (linkRes.json as { token: string }).token;

    const landing = await fetch(`${BASE}/share/${token}`, { redirect: "manual" });
    ok(
      landing.status === 307 &&
        landing.headers.get("location")?.includes(`/p/${projectId}`),
      "share link redirects to the project",
    );
    const shareSetCookie = landing.headers
      .getSetCookie()
      .find((c) => c.startsWith("chainstitch_share="));
    ok(!!shareSetCookie, "share link sets the guest cookie");
    const linkGuest = client(shareSetCookie!.split(";")[0]);

    const lgMe = (await linkGuest("GET", "/api/me")).json as {
      role: string | null;
      user: { id: string };
      projectRoles: Record<string, string>;
    };
    ok(
      lgMe.role === null &&
        lgMe.user.id === "link-guest" &&
        lgMe.projectRoles[projectId] === "viewer",
      "link guest is anonymous with the link's role",
    );
    const lgProjects = await linkGuest("GET", "/api/projects");
    ok(
      lgProjects.status === 200 && (lgProjects.json as unknown[]).length === 1,
      "link guest sees exactly the shared project",
    );
    ok(
      (await linkGuest("GET", `/p/${projectId}`)).status === 200,
      "link guest can open project pages",
    );
    ok(
      (await linkGuest("POST", `/api/projects/${projectId}/notebooks`, { title: "x" }))
        .status === 403,
      "a viewer link cannot edit",
    );
    ok(
      (await linkGuest("GET", "/api/workspace/members")).status === 403,
      "link guest cannot see the member roster",
    );
    ok(
      (await fetch(`${BASE}/share/not-a-real-token`, { redirect: "manual" })).headers
        .get("location")
        ?.includes("/login") ?? false,
      "an invalid link lands on the login page",
    );

    // Editor links can edit; resetting the link cuts old holders off
    ok(
      (await owner("PUT", `/api/projects/${projectId}/share-link`, { role: "editor" }))
        .status === 200,
      "owner bumps the link to editor",
    );
    ok(
      (
        await linkGuest("POST", `/api/projects/${projectId}/notebooks`, {
          title: "From link",
        })
      ).status === 200,
      "an editor link can edit",
    );
    const resetRes = await owner("PUT", `/api/projects/${projectId}/share-link`, {
      role: "editor",
      reset: true,
    });
    ok(
      (resetRes.json as { token: string }).token !== token,
      "resetting issues a fresh token",
    );
    ok(
      (await linkGuest("GET", "/api/projects")).status === 401,
      "the old link stops working after reset",
    );
    ok(
      (await owner("DELETE", `/api/projects/${projectId}/share-link`)).status === 200,
      "owner turns link sharing off",
    );
  } finally {
    // Wait for the server to actually exit before deleting its dirs.
    const exited = new Promise<void>((resolve) => {
      server.once("exit", () => resolve());
      setTimeout(resolve, 5000);
    });
    server.kill("SIGTERM");
    await exited;
    for (const target of [dir, path.join(__dirname, "..", ".next-e2e")]) {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
