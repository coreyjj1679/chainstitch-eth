"use client";

import { create } from "zustand";

/**
 * Session-only local signer (beta). A private key pasted by the user is held
 * in memory for the current tab only — never written to localStorage, never
 * sent to the server, cleared on reload. It exists so "Run all" can sign and
 * broadcast many write blocks back-to-back with no per-transaction wallet
 * prompt, on chains where anvil impersonation isn't available (real
 * testnets/mainnet). Keyed by project so switching projects never leaks a key.
 */
export interface LocalSigner {
  /** 0x-prefixed 32-byte private key, in memory for this session only. */
  privateKey: `0x${string}`;
  /** Address derived from the key, for display. */
  address: `0x${string}`;
}

interface SignerState {
  /** Active signers keyed by project id. Not persisted — dies with the tab. */
  signers: Record<string, LocalSigner>;
  setSigner: (projectId: string, signer: LocalSigner) => void;
  clearSigner: (projectId: string) => void;
}

export const useSignerStore = create<SignerState>((set) => ({
  signers: {},
  setSigner: (projectId, signer) =>
    set((state) => ({ signers: { ...state.signers, [projectId]: signer } })),
  clearSigner: (projectId) =>
    set((state) => {
      const signers = { ...state.signers };
      delete signers[projectId];
      return { signers };
    }),
}));
