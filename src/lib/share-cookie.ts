/**
 * "Anyone with the link" cookie: holds the share-link tokens a browser has
 * visited (newest first, capped). Deliberately free of server-only imports —
 * the proxy (edge runtime) needs the name for its optimistic check.
 */
export const SHARE_COOKIE = "chainstitch_share";

/** Most links a browser keeps at once; visiting more evicts the oldest. */
const MAX_TOKENS = 5;

export function parseShareTokens(cookieHeader: string | null): string[] {
  if (!cookieHeader) return [];
  const pair = cookieHeader
    .split(/;\s*/)
    .find((c) => c.startsWith(`${SHARE_COOKIE}=`));
  if (!pair) return [];
  const value = decodeURIComponent(pair.slice(SHARE_COOKIE.length + 1));
  return value.split(".").filter(Boolean).slice(0, MAX_TOKENS);
}

/** New cookie value after visiting `token` (deduped, newest first). */
export function appendShareToken(existing: string[], token: string): string {
  return [token, ...existing.filter((t) => t !== token)]
    .slice(0, MAX_TOKENS)
    .join(".");
}
