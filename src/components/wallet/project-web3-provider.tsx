"use client";

import { useMemo, type ReactNode } from "react";
import { WagmiProvider, http, createConfig } from "wagmi";
import { defineChain, type Chain } from "viem";
import * as knownChains from "viem/chains";
import { RainbowKitProvider, darkTheme, getDefaultConfig } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { injected } from "wagmi/connectors";
import type { Project } from "@/lib/types";

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export function chainForProject(project: Project): Chain {
  const known = (Object.values(knownChains) as unknown[]).find(
    (c): c is Chain =>
      typeof c === "object" && c !== null && "id" in c &&
      (c as Chain).id === project.chainId,
  );
  const base =
    known ??
    defineChain({
      id: project.chainId,
      name: `Chain ${project.chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [project.rpcUrl] } },
    });
  return {
    ...base,
    rpcUrls: { ...base.rpcUrls, default: { http: [project.rpcUrl] } },
    blockExplorers: project.explorerUrl
      ? { default: { name: "Explorer", url: project.explorerUrl } }
      : base.blockExplorers,
  };
}

export function ProjectWeb3Provider({
  project,
  children,
}: {
  project: Project;
  children: ReactNode;
}) {
  const config = useMemo(() => {
    const chain = chainForProject(project);
    if (WC_PROJECT_ID) {
      return getDefaultConfig({
        appName: "Chainstitch",
        projectId: WC_PROJECT_ID,
        chains: [chain],
        transports: { [chain.id]: http(project.rpcUrl) },
        ssr: true,
      });
    }
    // No WalletConnect project id configured: injected wallets only.
    return createConfig({
      chains: [chain],
      connectors: [injected()],
      transports: { [chain.id]: http(project.rpcUrl) },
      ssr: true,
    });
  }, [project]);

  return (
    <WagmiProvider config={config}>
      <RainbowKitProvider theme={darkTheme({ borderRadius: "medium" })}>
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
}
