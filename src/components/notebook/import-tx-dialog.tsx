"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createPublicClient, getAddress, http, type PublicClient } from "viem";
import {
  ArrowLeft,
  FileJson,
  ListTree,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { blockLabel, executionOrder } from "@/lib/block-label";
import { chainForProject } from "@/components/wallet/project-web3-provider";
import { CHAIN_PRESETS } from "@/components/chains/chain-presets";
import {
  importTransaction,
  missingContractId,
  type TxImportResult,
} from "@/lib/tx-import";
import type { CallConfig, ContractEntry, NotebookBlock, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * Paste a transaction hash → decode it into notebook blocks. The tx and its
 * internal call tree are fetched from the project RPC; ABIs for every touched
 * contract are pulled from the verified-source explorers (with an optional
 * chain override for forks), and missing ones are added to the address book on
 * insert. Blocks land at the end of the document, fully editable.
 */
export function ImportTxDialog({
  open,
  onOpenChange,
  project,
  contracts,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  contracts: ContractEntry[];
  onInsert: (blocks: NotebookBlock[]) => void;
}) {
  const queryClient = useQueryClient();
  const [hash, setHash] = useState("");
  const [chainValue, setChainValue] = useState(String(project.chainId));
  const [busy, setBusy] = useState<"decode" | "insert" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TxImportResult | null>(null);
  const [addMissing, setAddMissing] = useState(true);

  // Project chain first, then the presets (minus dupes / pseudo-entries) —
  // fork users fetch ABIs from the chain the fork is based on.
  const chainOptions: Array<{ value: string; label: string }> = [
    { value: String(project.chainId), label: `Project chain (${project.chainId})` },
    ...CHAIN_PRESETS.filter(
      (p) => p.chainId !== null && p.chainId !== project.chainId && p.chainId !== 31337,
    ).map((p) => ({ value: String(p.chainId), label: p.label })),
  ];

  const publicClient = useMemo<PublicClient>(
    () =>
      createPublicClient({
        chain: chainForProject(project),
        transport: http(project.rpcUrl),
      }) as PublicClient,
    [project],
  );

  const validHash = TX_HASH.test(hash.trim());

  function handleOpenChange(next: boolean) {
    if (!next) {
      setResult(null);
      setError(null);
    }
    onOpenChange(next);
  }

  async function decode() {
    setBusy("decode");
    setError(null);
    try {
      const chainId = Number(chainValue);
      const imported = await importTransaction({
        txHash: hash.trim() as `0x${string}`,
        publicClient,
        contracts,
        resolveAbi: async (address) => {
          const res = await api.abiLookup(project.id, address, chainId);
          return res.found && res.abi ? { name: res.name, abi: res.abi } : null;
        },
      });
      setResult(imported);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Create missing contracts (with their real addresses) then insert. */
  async function insert() {
    if (!result) return;
    setBusy("insert");
    try {
      if (addMissing && result.missing.length > 0) {
        for (const m of result.missing) {
          try {
            const created = await api.contracts.create(project.id, {
              name: m.name,
              address: getAddress(m.address),
              abi: m.abi,
            });
            for (const block of result.blocks) {
              if (m.blockIds.includes(block.id)) {
                (block.config as CallConfig).contractId = created.id;
              }
            }
          } catch (e) {
            toast.error(
              `Could not add "${m.name}" to the address book: ${e instanceof Error ? e.message : e}`,
            );
          }
        }
        queryClient.invalidateQueries({ queryKey: ["contracts", project.id] });
      }
      onInsert(result.blocks);
      setResult(null);
      setHash("");
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  }

  // Preview labels resolve missing contracts via synthetic entries so the
  // blocks read as "Name.fn(...)" instead of "(unconfigured)".
  const previewContracts: ContractEntry[] = useMemo(() => {
    if (!result) return contracts;
    const extras = result.missing.map<ContractEntry>((m) => ({
      id: missingContractId(m.address),
      projectId: project.id,
      name: m.name,
      address: m.address,
      abi: m.abi,
      createdAt: 0,
    }));
    return [...contracts, ...extras];
  }, [result, contracts, project.id]);

  const previewSteps = result ? executionOrder(result.blocks) : [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListTree className="size-4 text-primary" />
            Import a transaction
          </DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="tx-hash">Transaction hash</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="tx-hash"
                  className="min-w-56 flex-1 font-mono"
                  placeholder="0x… (66-char tx hash)"
                  value={hash}
                  aria-invalid={hash.trim() !== "" && !validHash}
                  onChange={(e) => {
                    setHash(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && validHash && !busy) decode();
                  }}
                />
                <Select
                  value={chainValue}
                  onValueChange={(v) => {
                    if (v) setChainValue(v);
                  }}
                  items={chainOptions}
                >
                  <SelectTrigger className="w-44" size="sm" aria-label="Chain for ABI lookup">
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
              </div>
              <p className="text-xs text-muted-foreground/70">
                The transaction and its internal calls are read from this project&apos;s
                RPC; ABIs are fetched from verified-source explorers on the selected
                chain. A full call tree needs a trace-enabled RPC (anvil, or an archive
                node) — otherwise only the top-level call is imported.
              </p>
              {project.chainId === 31337 && Number(chainValue) === 31337 && (
                <p className="text-xs text-muted-foreground">
                  On an anvil fork, pick the chain the fork is based on so ABIs resolve.
                </p>
              )}
            </div>

            {error && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono",
                  result.summary.status === "reverted"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-border bg-muted/40",
                )}
              >
                {result.summary.status}
              </span>
              <span className="font-mono">{result.summary.callCount} calls decoded</span>
              {!result.summary.traced && (
                <span className="rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-amber-500">
                  top-level only (no trace)
                </span>
              )}
            </div>

            {result.warnings.length > 0 && (
              <div className="grid gap-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
                {result.warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-xs text-amber-500">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                    {w}
                  </p>
                ))}
              </div>
            )}

            {result.missing.length > 0 && (
              <div className="grid gap-1.5 rounded-md border p-2.5">
                <p className="text-xs font-medium">
                  {result.missing.length}{" "}
                  {result.missing.length === 1 ? "contract" : "contracts"} to add to the
                  address book
                </p>
                {result.missing.map((m) => (
                  <p key={m.address} className="flex items-start gap-1.5 text-xs">
                    <FileJson className="mt-0.5 size-3.5 shrink-0 text-cyan-400" />
                    <span className="min-w-0 text-muted-foreground">
                      <span className="font-mono text-foreground">{m.name}</span>{" "}
                      <span className="font-mono text-muted-foreground/70">
                        {m.address}
                      </span>
                    </span>
                  </p>
                ))}
                <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={addMissing}
                    onChange={() => setAddMissing((v) => !v)}
                  />
                  Add {result.missing.length}{" "}
                  {result.missing.length === 1 ? "contract" : "contracts"} to the address
                  book on insert
                </label>
              </div>
            )}

            <div className="grid gap-2">
              <Label>
                Preview — {result.blocks.length}{" "}
                {result.blocks.length === 1 ? "block" : "blocks"}
              </Label>
              <div className="grid max-h-64 gap-0.5 overflow-y-auto rounded-md border p-1.5">
                {previewSteps.map((step, index) => (
                  <div
                    key={step.id}
                    className={cn(
                      "flex items-center gap-2 rounded px-1.5 py-1 text-xs",
                      step.parentId && "ml-5",
                    )}
                  >
                    <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted-foreground/40">
                      {index + 1}
                    </span>
                    <span className="shrink-0 rounded border border-border/60 bg-muted/40 px-1 font-mono text-[10px] text-muted-foreground">
                      {step.type}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {blockLabel(step, previewContracts)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground/70">
                Blocks insert at the end of the document, fully editable — nothing runs
                until you run it.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {!result ? (
            <Button disabled={!validHash || busy === "decode"} onClick={decode}>
              {busy === "decode" ? (
                <LoaderCircle data-icon="inline-start" className="animate-spin" />
              ) : (
                <ListTree data-icon="inline-start" />
              )}
              {busy === "decode" ? "Decoding…" : "Decode transaction"}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setResult(null)}>
                <ArrowLeft data-icon="inline-start" />
                Back
              </Button>
              <Button disabled={busy === "insert"} onClick={insert}>
                {busy === "insert" && (
                  <LoaderCircle data-icon="inline-start" className="animate-spin" />
                )}
                Insert {result.blocks.length}{" "}
                {result.blocks.length === 1 ? "block" : "blocks"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
