"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronRight,
  Code2,
  FileJson,
  Hammer,
  Play,
  Plus,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMe, useProjects } from "@/lib/hooks";
import { AccountMenu } from "@/components/workspace/account-menu";
import { Logo, LogoMark } from "@/components/logo";
import { ChainIcon } from "@/components/chains/chain-icon";
import {
  CUSTOM_VALUE,
  DEFAULT_CHAIN_VALUE,
  type ChainPreset,
  CHAIN_PRESETS,
  findChainPreset,
} from "@/components/chains/chain-presets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Skeleton } from "@/components/ui/skeleton";

function PresetIcon({ preset }: { preset: ChainPreset }) {
  if (preset.iconKind === "hammer") {
    return <Hammer className="size-4 shrink-0 text-muted-foreground" />;
  }
  if (preset.iconKind === "custom") {
    return <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />;
  }
  if (!preset.iconUrl) return null;
  return <ChainIcon src={preset.iconUrl} alt={preset.iconAlt ?? preset.label} />;
}

function CreateProjectDialog({ trigger }: { trigger: React.ReactElement }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [chainKey, setChainKey] = useState(DEFAULT_CHAIN_VALUE);
  const [chainId, setChainId] = useState("31337");
  const [rpcUrl, setRpcUrl] = useState("http://127.0.0.1:8545");
  const [explorerUrl, setExplorerUrl] = useState("");

  function applyPreset(preset: ChainPreset) {
    setChainKey(preset.value);
    if (preset.value === CUSTOM_VALUE) {
      // Hand off the fields to the user for arbitrary entry.
      setChainId("");
      setRpcUrl("");
      setExplorerUrl("");
      return;
    }
    if (preset.chainId != null) setChainId(String(preset.chainId));
    setRpcUrl(preset.rpcUrl);
    setExplorerUrl(preset.explorerUrl ?? "");
  }

  const create = useMutation({
    mutationFn: () =>
      api.projects.create({
        name,
        chainId: Number(chainId),
        rpcUrl,
        explorerUrl: explorerUrl || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setOpen(false);
      setName("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger}>
        <Plus data-icon="inline-start" />
        New project
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="p-name">Name</Label>
            <Input
              id="p-name"
              placeholder="My Protocol"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Chain</Label>
            <Select
              value={chainKey}
              onValueChange={(v) => {
                const preset = findChainPreset(v);
                if (preset) applyPreset(preset);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string | null) => {
                    const preset = findChainPreset(value);
                    if (!preset) return "Select a chain";
                    return (
                      <span className="flex w-full items-center gap-1.5">
                        <PresetIcon preset={preset} />
                        {preset.label}
                        {preset.testnet && (
                          <Badge
                            variant="secondary"
                            className="ml-auto h-4 px-1.5 text-[10px] font-normal"
                          >
                            Testnet
                          </Badge>
                        )}
                      </span>
                    );
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {CHAIN_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    <PresetIcon preset={p} />
                    {p.label}
                    {p.testnet && (
                      <Badge
                        variant="secondary"
                        className="ml-auto h-4 px-1.5 text-[10px] font-normal"
                      >
                        Testnet
                      </Badge>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="p-chain">Chain ID</Label>
              <Input
                id="p-chain"
                value={chainId}
                onChange={(e) => setChainId(e.target.value)}
              />
            </div>
            <div className="col-span-2 grid gap-2">
              <Label htmlFor="p-rpc">RPC URL</Label>
              <Input
                id="p-rpc"
                value={rpcUrl}
                onChange={(e) => setRpcUrl(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-explorer">Block explorer URL (optional)</Label>
            <Input
              id="p-explorer"
              placeholder="https://etherscan.io"
              value={explorerUrl}
              onChange={(e) => setExplorerUrl(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!name || !chainId || !rpcUrl || create.isPending}
            onClick={() => create.mutate()}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function HomePage() {
  const { data: projects, isLoading } = useProjects();
  const { data: me } = useMe();
  const isOwner = me?.role === "owner";
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: (id: string) => api.projects.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-8 py-3">
          <Logo size={24} />
          <div className="flex items-center gap-2">
            <AccountMenu />
            {isOwner && <CreateProjectDialog trigger={<Button size="sm" />} />}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-8 py-12">
        {/* Hero */}
        <div className="mb-12">
          <h1 className="mb-3 text-3xl font-semibold tracking-tight">
            Runnable notebooks for
            <br />
            <span className="text-primary">smart contract handoff</span>
          </h1>
          <p className="max-w-xl text-[0.95rem] leading-relaxed text-muted-foreground">
            Compose reads, writes and RPC calls into a shared notebook — chained
            together with variables and run like Jupyter cells. Everyone works
            from the same source of truth, with generated wagmi, viem, Python,
            Rust and Solidity snippets one click away. A collaboration tool for
            everything that touches a smart contract.
          </p>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Projects
          </h2>
          <span className="text-xs text-muted-foreground/60">
            one per chain config
          </span>
        </div>

        {isLoading ? (
          <div className="grid gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="overflow-hidden rounded-xl border">
            {projects.map((p, i) => (
              <div
                key={p.id}
                className={
                  "group relative flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-card/60 " +
                  (i > 0 ? "border-t" : "")
                }
              >
                <Link href={`/p/${p.id}`} className="absolute inset-0" aria-label={p.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                      chain {p.chainId}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {p.rpcUrl}
                  </p>
                </div>
                {isOwner && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="relative z-10 opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={`Delete ${p.name}`}
                    onClick={() => {
                      if (confirm(`Delete project "${p.name}"?`)) remove.mutate(p.id);
                    }}
                  >
                    <Trash2 className="text-muted-foreground" />
                  </Button>
                )}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center rounded-xl border border-dashed px-8 py-16 text-center">
            <LogoMark size={40} />
            <p className="mt-4 mb-1 font-medium">
              {isOwner ? "Create your first project" : "No projects yet"}
            </p>
            <p className="mb-6 max-w-sm text-sm text-muted-foreground">
              {isOwner
                ? "Point it at your chain (there is an Anvil preset for local development), drop in your ABIs, and start a notebook."
                : "A workspace owner needs to create the first project."}
            </p>
            {isOwner && <CreateProjectDialog trigger={<Button />} />}
          </div>
        )}

        {/* How it works */}
        <div className="mt-14">
          <h2 className="mb-4 text-sm font-medium tracking-wide text-muted-foreground uppercase">
            How it works
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-card/40 p-4">
              <div className="mb-3 flex size-8 items-center justify-center rounded-lg border bg-sky-400/10 text-sky-400">
                <FileJson className="size-4" />
              </div>
              <p className="mb-1 text-sm font-medium">1 · Connect a chain</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Set the chain id and RPC — Anvil preset included for local
                forks — then drag &amp; drop your ABI JSONs and fill in the
                deployed addresses.
              </p>
            </div>
            <div className="rounded-xl border bg-card/40 p-4">
              <div className="mb-3 flex size-8 items-center justify-center rounded-lg border bg-emerald-400/10 text-emerald-400">
                <Play className="size-4" />
              </div>
              <p className="mb-1 text-sm font-medium">2 · Compose &amp; run</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Add read, write and RPC blocks like Jupyter cells. Save any
                result as a variable and feed it into the next call with{" "}
                <code className="rounded bg-muted px-1 font-mono">
                  {"{{variable}}"}
                </code>
                .
              </p>
            </div>
            <div className="rounded-xl border bg-card/40 p-4">
              <div className="mb-3 flex size-8 items-center justify-center rounded-lg border bg-violet-400/10 text-violet-400">
                <Code2 className="size-4" />
              </div>
              <p className="mb-1 text-sm font-medium">3 · Hand off the code</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Every block generates its wagmi/viem snippet. Frontend devs copy
                the source or export the whole flow as a JSON manifest.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground/70">
            <span className="flex items-center gap-1.5">
              <ArrowRight className="size-3" /> Jupyter-style execution with
              chained variables
            </span>
            <span className="flex items-center gap-1.5">
              <ArrowRight className="size-3" /> Simulate-before-write surfaces
              revert reasons early
            </span>
            <span className="flex items-center gap-1.5">
              <ArrowRight className="size-3" /> Works against anvil forks and
              cheatcodes
            </span>
          </div>
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-8 py-3 text-xs text-muted-foreground/60">
          <span>Smart contract collaboration tools.</span>
          <span className="font-mono">
            {me?.mode === "team" ? "team" : "local"} · sqlite
          </span>
        </div>
      </footer>
    </div>
  );
}
