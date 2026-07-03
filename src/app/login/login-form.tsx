"use client";

import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { LogIn, Wallet } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { LoginWeb3Provider } from "@/components/wallet/login-web3-provider";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

/** SIWE identity messages are pinned to mainnet; execution chains are per-project. */
const SIWE_CHAIN_ID = 1;

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function SignInCard() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const nonceRes = await authClient.siwe.nonce({
        walletAddress: address,
        chainId: SIWE_CHAIN_ID,
      });
      if (nonceRes.error || !nonceRes.data) {
        throw new Error(nonceRes.error?.message ?? "Could not get a sign-in nonce");
      }
      const message = createSiweMessage({
        address,
        chainId: SIWE_CHAIN_ID,
        domain: window.location.host,
        uri: window.location.origin,
        nonce: nonceRes.data.nonce,
        version: "1",
        statement: "Sign in to Chainstitch",
      });
      const signature = await signMessageAsync({ message });
      const verifyRes = await authClient.siwe.verify({
        message,
        signature,
        walletAddress: address,
        chainId: SIWE_CHAIN_ID,
      });
      if (verifyRes.error) {
        throw new Error(
          "This wallet isn't authorized on this instance. Ask an owner to invite it.",
        );
      }
      // Full navigation so the session cookie drives the proxy redirect logic.
      window.location.href = "/";
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sign-in failed";
      setError(/rejected|denied|cancel/i.test(message) ? "Signature request cancelled" : message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-xl border bg-card/40 p-6">
      <div className="mb-6 flex flex-col items-center text-center">
        <Logo size={28} />
        <h1 className="mt-4 text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This is a team instance. Sign in with the wallet an owner invited —
          your signature is your login, no password involved.
        </p>
      </div>

      <div className="grid gap-3">
        <div className="flex justify-center">
          <ConnectButton showBalance={false} chainStatus="none" />
        </div>
        {isConnected && address && (
          <Button className="w-full" onClick={signIn} disabled={busy}>
            <LogIn data-icon="inline-start" />
            {busy ? "Waiting for signature…" : `Sign in as ${shortAddress(address)}`}
          </Button>
        )}
        {!isConnected && (
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Wallet className="size-3.5" />
            Connect a wallet to continue
          </p>
        )}
        {error && <p className="text-center text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

export function LoginForm() {
  return (
    <LoginWeb3Provider>
      <div className="flex min-h-screen items-center justify-center p-6">
        <SignInCard />
      </div>
    </LoginWeb3Provider>
  );
}
