"use client";

import { useMemo, type ReactNode } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { RainbowKitProvider, darkTheme, getDefaultConfig } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

/**
 * Minimal app-level wallet context for the login page. Sign-In with Ethereum
 * only signs a message — chain state is irrelevant — so this is pinned to
 * mainnet regardless of what the instance's projects use.
 */
export function LoginWeb3Provider({ children }: { children: ReactNode }) {
  const config = useMemo(() => {
    if (WC_PROJECT_ID) {
      return getDefaultConfig({
        appName: "Chainstitch",
        projectId: WC_PROJECT_ID,
        chains: [mainnet],
        transports: { [mainnet.id]: http() },
        ssr: true,
      });
    }
    return createConfig({
      chains: [mainnet],
      connectors: [injected()],
      transports: { [mainnet.id]: http() },
      ssr: true,
    });
  }, []);

  return (
    <WagmiProvider config={config}>
      <RainbowKitProvider theme={darkTheme({ borderRadius: "medium" })}>
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
}
