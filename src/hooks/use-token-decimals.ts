"use client";

import { useQuery } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import { contractHasDecimals } from "@/lib/units";
import type { ContractEntry } from "@/lib/types";

/**
 * Fetch ERC-20 `decimals()` when the ABI exposes it. Cached per address
 * for the session — decimals don't change.
 */
export function useTokenDecimals(
  publicClient: PublicClient | undefined,
  contract: ContractEntry | undefined,
) {
  const enabled = Boolean(
    publicClient && contract && contractHasDecimals(contract.abi),
  );

  return useQuery({
    queryKey: [
      "token-decimals",
      publicClient?.chain?.id,
      contract?.address?.toLowerCase(),
    ],
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const value = await publicClient!.readContract({
        address: contract!.address as `0x${string}`,
        abi: contract!.abi,
        functionName: "decimals",
      });
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 255) {
        throw new Error(`Unexpected decimals: ${String(value)}`);
      }
      return n;
    },
  });
}
