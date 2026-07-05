"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createPublicClient, getAddress, http, isAddress } from "viem";
import { Check, CircleHelp, Download, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getReadFunctions, getWriteFunctions } from "@/lib/abi";
import { chainForProject } from "@/components/wallet/project-web3-provider";
import { CHAIN_PRESETS } from "@/components/chains/chain-presets";
import type { AbiLookupResult, ContractEntry, Project } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** EIP-1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1. */
const EIP1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Read the EIP-1967 implementation address behind `address` via the project
 * RPC (client-side, like all chain access). Null for non-proxies, zero slots,
 * chains where the address has no code, or any RPC hiccup.
 */
async function readImplementationSlot(
  project: Project,
  address: string,
): Promise<string | null> {
  try {
    const client = createPublicClient({
      chain: chainForProject(project),
      transport: http(project.rpcUrl),
    });
    const raw = await client.getStorageAt({
      address: address as `0x${string}`,
      slot: EIP1967_IMPL_SLOT,
    });
    if (!raw || raw === "0x") return null;
    const implementation = getAddress(`0x${raw.slice(-40)}`);
    return implementation === "0x0000000000000000000000000000000000000000"
      ? null
      : implementation;
  } catch {
    return null;
  }
}

interface LookupOutcome {
  address: string;
  chainId: number;
  result: AbiLookupResult;
}

/**
 * "Add by address" — fetch a verified ABI from Sourcify / Etherscan /
 * Blockscout (per the selected chain) instead of dropping a JSON file.
 * Proxies resolve to the implementation ABI paired with the proxy address,
 * matching the address book's proxy convention: explorer hints first, then a
 * client-side EIP-1967 slot read against the project RPC as fallback (which
 * also covers anvil forks).
 */
export function LookupContract({
  project,
  contracts,
}: {
  project: Project;
  contracts: ContractEntry[];
}) {
  const queryClient = useQueryClient();
  const [address, setAddress] = useState("");
  const [chainValue, setChainValue] = useState(String(project.chainId));
  const [outcome, setOutcome] = useState<LookupOutcome | null>(null);

  // Project chain first, then the well-known presets (minus duplicates and
  // the pseudo-entries) — fork users pick the chain their fork is based on.
  const chainOptions: Array<{ value: string; label: string }> = [
    { value: String(project.chainId), label: `Project chain (${project.chainId})` },
    ...CHAIN_PRESETS.filter(
      (p) => p.chainId !== null && p.chainId !== project.chainId && p.chainId !== 31337,
    ).map((p) => ({ value: String(p.chainId), label: p.label })),
  ];

  const lookup = useMutation({
    mutationFn: async (): Promise<LookupOutcome> => {
      const target = address.trim();
      const chainId = Number(chainValue);
      const result = await api.abiLookup(project.id, target, chainId);

      // No proxy hint from the explorer? Ask the chain itself.
      if (result.found && !result.implementation) {
        const implementation = await readImplementationSlot(project, target);
        if (implementation) {
          const implResult = await api.abiLookup(project.id, implementation, chainId);
          if (implResult.found && implResult.abi) {
            return {
              address: target,
              chainId,
              result: {
                ...implResult,
                implementation: {
                  address: implementation,
                  name: implResult.name,
                  abiResolved: true,
                },
              },
            };
          }
          return {
            address: target,
            chainId,
            result: {
              ...result,
              implementation: { address: implementation, abiResolved: false },
            },
          };
        }
      }
      return { address: target, chainId, result };
    },
    onSuccess: setOutcome,
    onError: (e: Error) => toast.error(e.message),
  });

  const add = useMutation({
    mutationFn: async (o: LookupOutcome) => {
      const name = o.result.name ?? `Contract ${shortAddress(o.address)}`;
      return api.contracts.create(project.id, {
        name,
        address: o.address,
        abi: o.result.abi,
      });
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["contracts", project.id] });
      toast.success(`Added ${created.name} to the address book`);
      setOutcome(null);
      setAddress("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const validAddress = isAddress(address.trim());
  const alreadyAdded =
    outcome &&
    contracts.some(
      (c) => c.address.toLowerCase() === outcome.address.toLowerCase(),
    );
  const found = outcome?.result.found ?? false;
  const abi = outcome?.result.abi;

  return (
    <div className="mb-6 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <Input
          className="min-w-56 flex-1 font-mono"
          placeholder="0x… fetch a verified ABI by address"
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            setOutcome(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && validAddress && !lookup.isPending) {
              lookup.mutate();
            }
          }}
        />
        <Select
          value={chainValue}
          onValueChange={(v) => {
            if (v) setChainValue(v);
          }}
          items={chainOptions}
        >
          <SelectTrigger className="w-44" size="sm" aria-label="Chain to search">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {chainOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={!validAddress || lookup.isPending}
          onClick={() => lookup.mutate()}
        >
          {lookup.isPending ? "Looking up…" : "Look up"}
        </Button>
      </div>
      {project.chainId === 31337 && Number(chainValue) === 31337 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleHelp className="size-3 shrink-0" />
          Local chains have no explorer — on an anvil fork, pick the chain the
          fork is based on.
        </p>
      )}

      {outcome && found && abi && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2">
          <Check className="size-3.5 shrink-0 text-emerald-400" />
          <span className="text-sm font-medium">
            {outcome.result.name ?? `Contract ${shortAddress(outcome.address)}`}
          </span>
          <Badge variant="outline" className="text-xs">
            {getReadFunctions(abi).length} reads
          </Badge>
          <Badge variant="outline" className="text-xs">
            {getWriteFunctions(abi).length} writes
          </Badge>
          <Badge variant="secondary" className="text-xs">
            via {outcome.result.source}
          </Badge>
          {outcome.result.implementation && (
            <span
              className="text-xs text-muted-foreground"
              title={outcome.result.implementation.address}
            >
              {outcome.result.implementation.abiResolved
                ? `proxy → implementation ABI (${shortAddress(outcome.result.implementation.address)})`
                : `proxy detected (${shortAddress(outcome.result.implementation.address)}) — implementation not verified, using the proxy ABI`}
            </span>
          )}
          <div className="ml-auto">
            <Button
              size="sm"
              disabled={!!alreadyAdded || add.isPending}
              onClick={() => add.mutate(outcome)}
            >
              <Download data-icon="inline-start" />
              {alreadyAdded ? "Already in the address book" : "Add to address book"}
            </Button>
          </div>
        </div>
      )}
      {outcome && !found && (
        <p className="mt-3 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          No verified source found for {shortAddress(outcome.address)} on chain{" "}
          {outcome.chainId} (tried {outcome.result.tried.join(", ")}).
          {!outcome.result.etherscanConfigured && (
            <>
              {" "}
              Setting <code className="rounded bg-muted px-1 font-mono">
                ETHERSCAN_API_KEY
              </code>{" "}
              adds Etherscan&apos;s much larger index.
            </>
          )}
        </p>
      )}
    </div>
  );
}
