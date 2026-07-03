import "server-only";

export type AppMode = "local" | "team";

/**
 * APP_MODE is read server-side only (not NEXT_PUBLIC_*) so one build/image can
 * serve any mode; clients learn the mode from /api/me.
 *
 * - local (default): no auth, implicit owner — today's clone-and-run behavior.
 * - team: SIWE login, invite teammates by wallet address.
 */
export function appMode(): AppMode {
  const raw = (process.env.APP_MODE ?? "local").trim().toLowerCase();
  if (raw === "team") return "team";
  if (raw !== "local" && raw !== "") {
    throw new Error(`Invalid APP_MODE "${raw}" — expected "local" or "team"`);
  }
  return "local";
}

/** Wallets granted the owner role on sign-in (team mode bootstrap). Lowercased. */
export function ownerWallets(): string[] {
  return (process.env.OWNER_WALLETS ?? "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter((w) => /^0x[a-f0-9]{40}$/.test(w));
}

/** Public URL of this instance; SIWE domain binding and auth cookies derive from it. */
export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** SIWE domain (host[:port]) the login message must be bound to. */
export function siweDomain(): string {
  return new URL(appUrl()).host;
}
