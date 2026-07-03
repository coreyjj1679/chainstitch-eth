"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ChevronDown, CircleAlert, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const connected = mounted && account && chain;

        if (!mounted) {
          return <Button size="sm" variant="outline" className="invisible">…</Button>;
        }

        if (!connected) {
          return (
            <Button size="sm" onClick={openConnectModal}>
              <Wallet data-icon="inline-start" />
              Connect wallet
            </Button>
          );
        }

        if (chain.unsupported) {
          return (
            <Button size="sm" variant="destructive" onClick={openChainModal}>
              <CircleAlert data-icon="inline-start" />
              Wrong network
            </Button>
          );
        }

        return (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={openChainModal}>
              <span className="size-1.5 rounded-full bg-emerald-400" />
              {chain.name ?? `Chain ${chain.id}`}
              <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="font-mono"
              onClick={openAccountModal}
            >
              {account.displayName}
            </Button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
