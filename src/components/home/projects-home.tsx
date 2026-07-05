"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Hammer,
  Plus,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMe, useProjects } from "@/lib/hooks";
import { GITHUB_URL } from "@/lib/site";
import { AccountMenu } from "@/components/workspace/account-menu";
import { GithubIcon } from "@/components/github-link";
import { Logo, LogoMark } from "@/components/logo";
import { ChainIcon } from "@/components/chains/chain-icon";
import { ChainBadge } from "@/components/chains/chain-badge";
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

/** The signed-in home: project list + how-it-works (formerly the root page). */
export function ProjectsHome() {
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
                    <ChainBadge chainId={p.chainId} className="shrink-0" />
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {p.rpcUrl}
                  </p>
                </div>
                {p.role === "owner" && (
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
          <div className="overflow-hidden rounded-xl border">
            <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {[
                {
                  step: "01",
                  title: "Connect a chain",
                  body: (
                    <>
                      Point a project at any RPC — Anvil preset included — then
                      fetch verified ABIs by address or drop in your artifacts.
                    </>
                  ),
                },
                {
                  step: "02",
                  title: "Compose & run",
                  body: (
                    <>
                      Chain read, write and RPC blocks like Jupyter cells — every
                      output becomes a{" "}
                      <code className="rounded bg-muted px-1 font-mono">
                        {"{{variable}}"}
                      </code>{" "}
                      for the next call, and writes simulate before they send.
                    </>
                  ),
                },
                {
                  step: "03",
                  title: "Hand off the code",
                  body: (
                    <>
                      Flip any block into its wagmi, viem, Python, Rust or
                      Solidity source, or export the whole flow as a JSON
                      manifest.
                    </>
                  ),
                },
              ].map((s) => (
                <div key={s.step} className="bg-card/30 p-5">
                  <span className="font-mono text-xs font-medium text-primary">
                    {s.step}
                  </span>
                  <p className="mt-2 mb-1.5 text-sm font-medium">{s.title}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {s.body}
                  </p>
                </div>
              ))}
            </div>
            <div className="border-t bg-card/50 px-5 py-2.5 text-xs text-muted-foreground/70">
              Runs against anvil forks and cheatcodes · everything is autosaved ·
              nothing leaves your machine in local mode
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-8 py-3 text-xs text-muted-foreground/60">
          <span>Smart contract collaboration tools.</span>
          <span className="flex items-center gap-4">
            <Link href="/docs" className="transition-colors hover:text-foreground">
              Docs
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <GithubIcon className="size-3.5" />
              GitHub
            </a>
            <span className="font-mono">
              {me?.mode === "team" ? "team" : "local"} · sqlite
            </span>
          </span>
        </div>
      </footer>
    </div>
  );
}
