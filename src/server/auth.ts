import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { siwe } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { generateSiweNonce } from "viem/siwe";
import { verifyMessage } from "viem/utils";
import { db, schema } from "@/db";
import { appMode, appUrl, siweDomain } from "@/server/mode";
import { isWalletAllowedToSignIn, onUserSignedIn } from "@/server/team";

function authSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  if (appMode() === "team") {
    throw new Error(
      "BETTER_AUTH_SECRET is required in team mode. Generate one with: openssl rand -base64 32",
    );
  }
  // Local mode never authenticates (sign-in is rejected below), so the value is inert.
  return "chainstitch-local-mode-unused-secret";
}

export const auth = betterAuth({
  baseURL: appUrl(),
  secret: authSecret(),
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      walletAddress: schema.walletAddress,
    },
  }),
  plugins: [
    siwe({
      domain: siweDomain(),
      anonymous: true,
      getNonce: async () => generateSiweNonce(),
      // Nonce, domain, address and chain-id binding are enforced by the plugin;
      // this callback verifies the signature itself (offline, EOA) and applies
      // the instance sign-in policy.
      verifyMessage: async ({ message, signature, address }) => {
        if (appMode() !== "team") return false;
        const valid = await verifyMessage({
          address: address as `0x${string}`,
          message,
          signature: signature as `0x${string}`,
        }).catch(() => false);
        if (!valid) return false;
        return isWalletAllowedToSignIn(address);
      },
    }),
    nextCookies(),
  ],
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          await onUserSignedIn(session.userId);
        },
      },
    },
  },
});
