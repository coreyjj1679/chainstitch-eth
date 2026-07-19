"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  ExternalLink,
} from "lucide-react";
import type { PublicClient } from "viem";
import { createPublicClient, http } from "viem";
import { displayValue } from "@/lib/serialize";
import { findRevertCause, type CallFrame } from "@/lib/trace";
import {
  displayAbiValue,
  formatIntegerWithUnits,
  parseAbiDetailLabel,
} from "@/lib/units";
import { chainForProject } from "@/components/wallet/project-web3-provider";
import { useTokenDecimals } from "@/hooks/use-token-decimals";
import { useNotebookStore } from "@/stores/notebook-store";
import type {
  BlockResult,
  CallConfig,
  ContractEntry,
  DecodedEventEntry,
  EventConfig,
  ExpectConfig,
  NotebookBlock,
  Project,
} from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface DetailRow {
  label: string;
  value?: unknown;
  /** Group header (nested object key); renders label only */
  header?: boolean;
  /** Indented child of the preceding header */
  child?: boolean;
}

/** Flatten one level of nesting so every row shares the same label column. */
function flattenDetails(record: Record<string, unknown>): DetailRow[] {
  const rows: DetailRow[] = [];
  for (const [label, value] of Object.entries(record)) {
    if (isPlainObject(value)) {
      rows.push({ label, header: true });
      for (const [k, v] of Object.entries(value)) {
        rows.push({ label: k, value: v, child: true });
      }
    } else {
      rows.push({ label, value });
    }
  }
  return rows;
}

function functionNameFromDetails(
  details?: Record<string, unknown>,
): string | undefined {
  const fn = details?.Function;
  if (typeof fn !== "string") return undefined;
  return fn.split("(")[0] || undefined;
}

function formatDetailCell(
  label: string,
  value: unknown,
  opts?: {
    decimals?: number | null;
    unitLabel?: string;
    functionName?: string;
  },
): string {
  const parsed = parseAbiDetailLabel(label);
  if (parsed) {
    return displayAbiValue(value, {
      type: parsed.type,
      name: parsed.name || undefined,
      functionName: opts?.functionName,
      decimals: opts?.decimals,
      unitLabel: opts?.unitLabel,
    });
  }
  return displayValue(value);
}

/**
 * Key/value grid where every row — nested or not — uses the same label
 * column width and baseline, so the two columns stay vertically aligned.
 * Also used by the saved-run viewer.
 */
export function DetailsGrid({
  record,
  decimals,
  unitLabel,
  functionName,
}: {
  record: Record<string, unknown>;
  decimals?: number | null;
  unitLabel?: string;
  functionName?: string;
}) {
  const rows = flattenDetails(record);
  if (rows.length === 0) {
    return <p className="text-[11px] text-muted-foreground/60">Nothing to show.</p>;
  }
  return (
    <dl className="grid gap-1">
      {rows.map((row, i) => (
        <div
          key={`${row.label}-${i}`}
          className="grid grid-cols-[9.5rem_1fr] items-baseline gap-2"
        >
          <dt
            title={row.label}
            className={cn(
              "truncate font-mono text-[11px] leading-5",
              row.child
                ? "pl-3 text-muted-foreground/60"
                : "font-medium text-muted-foreground",
            )}
          >
            {row.label}
          </dt>
          <dd className="min-w-0 font-mono text-[11px] leading-5 break-all whitespace-pre-wrap text-foreground/90">
            {row.header
              ? ""
              : formatDetailCell(row.label, row.value, {
                  decimals,
                  unitLabel,
                  functionName,
                })}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function EventArgsGrid({
  args,
  contract,
  publicClient,
}: {
  args: Record<string, unknown>;
  contract?: ContractEntry;
  publicClient?: PublicClient;
}) {
  const { data: decimals } = useTokenDecimals(publicClient, contract);
  return (
    <DetailsGrid
      record={args}
      decimals={decimals}
      unitLabel={contract?.name}
    />
  );
}

/**
 * Receipt logs decoded against the address book: one card per event with
 * its emitter and an args grid — the "did the right event fire?" check.
 */
function EventsList({
  events,
  contracts,
  publicClient,
}: {
  events: DecodedEventEntry[];
  contracts: ContractEntry[];
  publicClient?: PublicClient;
}) {
  return (
    <div className="grid max-h-72 gap-1.5 overflow-y-auto">
      {events.map((entry, i) => {
        const contract = contracts.find(
          (c) => c.address.toLowerCase() === entry.address.toLowerCase(),
        );
        return (
          <div
            key={`${entry.logIndex ?? i}-${entry.event}`}
            className="rounded-md border border-border/40 px-2 py-1.5"
          >
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">
                [{entry.logIndex ?? i}]
              </span>
              <span
                className={cn(
                  "min-w-0 truncate font-mono text-[11px]",
                  entry.args ? "font-medium text-emerald-400" : "text-muted-foreground",
                )}
                title={entry.event}
              >
                {entry.event}
              </span>
              <span
                className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/60"
                title={entry.address}
              >
                {entry.contract}
              </span>
            </div>
            {entry.args && Object.keys(entry.args).length > 0 && (
              <div className="mt-1 border-t border-border/40 pt-1">
                <EventArgsGrid
                  args={entry.args}
                  contract={contract}
                  publicClient={publicClient}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One frame of a decoded call tree; recurses into its inner calls. */
function TraceFrame({ frame }: { frame: CallFrame }) {
  const [open, setOpen] = useState(true);
  const hasChildren = frame.children.length > 0;

  const argText =
    frame.args && frame.args.length > 0
      ? frame.args.map((a) => displayValue(a)).join(", ").replace(/\s+/g, " ")
      : "";
  let label: string;
  if (frame.functionName) {
    label = `${frame.contract ?? "?"}.${frame.functionName}(${argText})`;
  } else if (frame.selector && frame.selector !== "0x") {
    label = `${frame.contract ?? "?"}.${frame.selector}…`;
  } else if (frame.contract) {
    label = `${frame.type.toLowerCase()} ${frame.contract}`;
  } else {
    label = frame.type;
  }
  // Only tag the non-plain call kinds (staticcall/delegatecall/create/…).
  const kindTag = frame.type !== "CALL" ? frame.type.toLowerCase() : undefined;

  return (
    <div className="grid gap-1">
      <div
        className={cn(
          "flex items-start gap-1.5 font-mono text-[11px] leading-5",
          frame.reverted ? "text-destructive" : "text-foreground/90",
        )}
      >
        {hasChildren ? (
          <button
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </button>
        ) : (
          <span className="mt-0.5 w-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 break-all" title={frame.signature}>
          {kindTag && (
            <span className="mr-1 rounded border border-border/60 bg-muted/40 px-1 text-[10px] text-muted-foreground">
              {kindTag}
            </span>
          )}
          {label}
          {frame.reverted && (
            <span className="ml-1 rounded border border-destructive/40 bg-destructive/10 px-1 text-[10px]">
              reverted
            </span>
          )}
        </span>
        {frame.gasUsed !== undefined && (
          <span className="shrink-0 text-[10px] text-muted-foreground/60">
            {frame.gasUsed.toString()} gas
          </span>
        )}
      </div>
      {frame.reverted && frame.revertReason && (
        <p className="ml-4 break-all font-mono text-[10px] text-destructive/80">
          ↳ {frame.revertReason}
        </p>
      )}
      {frame.value !== undefined && frame.value > 0n && (
        <p className="ml-4 font-mono text-[10px] text-muted-foreground/60">
          ↳ value: {formatIntegerWithUnits(frame.value, 18, "ETH")}
        </p>
      )}
      {hasChildren && open && (
        <div className="ml-2 border-l border-border/40 pl-2">
          {frame.children.map((child, i) => (
            <TraceFrame key={i} frame={child} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Decoded call tree with the reverting cause surfaced on top. */
function CallTree({ trace }: { trace: CallFrame }) {
  const cause = findRevertCause(trace);
  return (
    <div className="grid gap-2">
      {cause?.reverted && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5">
          <p className="break-all font-mono text-[11px] text-destructive">
            Reverted
            {cause.contract
              ? ` in ${cause.contract}${cause.functionName ? `.${cause.functionName}` : ""}`
              : ""}
            {cause.revertReason ? `: ${cause.revertReason}` : ""}
          </p>
        </div>
      )}
      <div className="max-h-72 overflow-auto">
        <TraceFrame frame={trace} />
      </div>
    </div>
  );
}

function statusTime(ranAt?: number): string {
  if (!ranAt) return "";
  const d = new Date(ranAt);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString() : d.toLocaleString();
}

/** One collapsed history entry; expands to the full output. */
function HistoryEntry({ entry }: { entry: BlockResult }) {
  const [open, setOpen] = useState(false);
  const ok = entry.status === "success";
  const preview = ok ? displayValue(entry.value) : (entry.error ?? "");
  return (
    <div className="rounded-md border border-border/40">
      <button
        className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-muted/40"
        onClick={() => setOpen((v) => !v)}
        title={open ? "Collapse output" : "Show full output"}
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            "shrink-0 font-mono text-[11px]",
            ok ? "text-primary" : "text-destructive",
          )}
        >
          [{entry.execIndex ?? "·"}]
        </span>
        {ok ? (
          <CircleCheck className="size-3 shrink-0 text-emerald-500" />
        ) : (
          <CircleAlert className="size-3 shrink-0 text-destructive" />
        )}
        {entry.simulated && (
          <span className="shrink-0 rounded border border-teal-400/30 bg-teal-400/10 px-1 font-mono text-[10px] text-teal-400">
            sim
          </span>
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mono text-[11px]",
            ok ? "text-foreground/80" : "text-destructive",
          )}
        >
          {preview.replace(/\s+/g, " ")}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground/60">
          {statusTime(entry.ranAt)}
          {typeof entry.durationMs === "number" && ` · ${entry.durationMs}ms`}
        </span>
      </button>
      {open && (
        <pre className="max-h-48 overflow-auto border-t border-border/40 px-2 py-1.5 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all">
          {preview}
        </pre>
      )}
    </div>
  );
}

/** Call / Transaction / Run / History tabs under a finished result. */
function DetailTabs({
  blockId,
  result,
  project,
  contracts,
  publicClient,
  decimals,
  unitLabel,
}: {
  blockId: string;
  result: BlockResult;
  project: Project;
  contracts: ContractEntry[];
  publicClient?: PublicClient;
  decimals?: number | null;
  unitLabel?: string;
}) {
  const history = useNotebookStore((s) => s.history[blockId]) ?? [];
  const functionName = functionNameFromDetails(result.details);

  const runMeta: Record<string, unknown> = {
    ...(result.kind ? { Kind: result.kind } : {}),
    ...(result.sender ? { Sender: result.sender } : {}),
    ...(result.execIndex !== undefined ? { "Exec index": `[${result.execIndex}]` } : {}),
    ...(result.ranAt
      ? { "Executed at": new Date(result.ranAt).toLocaleString() }
      : {}),
    ...(typeof result.durationMs === "number"
      ? { Duration: `${result.durationMs} ms` }
      : {}),
    ...(result.blockNumber !== undefined ? { "Block number": result.blockNumber } : {}),
    Chain: project.chainId,
  };

  const tabs = [
    ...(result.details
      ? [
          {
            value: "call",
            // Recipe cells put their per-step outcomes here.
            label: result.kind?.startsWith("Recipe") ? "Steps" : "Call",
          },
        ]
      : []),
    ...(result.events && result.events.length > 0
      ? [{ value: "events", label: `Events (${result.events.length})` }]
      : []),
    ...(result.trace ? [{ value: "trace", label: "Trace" }] : []),
    ...(result.txDetails ? [{ value: "tx", label: "Transaction" }] : []),
    { value: "run", label: "Run" },
    { value: "history", label: `History (${history.length})` },
  ];

  return (
    <Tabs
      // Remount when the tab set changes (e.g. success → error) so the
      // selection always points at an existing tab.
      key={tabs.map((t) => t.value).join(".")}
      defaultValue={tabs[0].value}
      className="mt-2 gap-1.5 border-t border-border/40 pt-2"
    >
      <TabsList className="group-data-horizontal/tabs:h-6">
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="px-2 text-[11px]">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {result.details && (
        <TabsContent value="call">
          <DetailsGrid
            record={result.details}
            decimals={decimals}
            unitLabel={unitLabel}
            functionName={functionName}
          />
        </TabsContent>
      )}
      {result.events && result.events.length > 0 && (
        <TabsContent value="events">
          <EventsList
            events={result.events}
            contracts={contracts}
            publicClient={publicClient}
          />
        </TabsContent>
      )}
      {result.trace && (
        <TabsContent value="trace">
          <CallTree trace={result.trace} />
        </TabsContent>
      )}
      {result.txDetails && (
        <TabsContent value="tx">
          <DetailsGrid record={result.txDetails} />
        </TabsContent>
      )}
      <TabsContent value="run">
        <DetailsGrid record={runMeta} />
      </TabsContent>
      <TabsContent value="history">
        {history.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/60">
            No runs recorded yet.
          </p>
        ) : (
          <div className="grid max-h-72 gap-1 overflow-y-auto">
            {history.map((entry, i) => (
              <HistoryEntry key={`${entry.ranAt ?? 0}-${i}`} entry={entry} />
            ))}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}

function DetailsToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="ml-auto flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title="Show call, transaction and run details plus past outputs"
    >
      {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      details
    </button>
  );
}

function contractIdFromBlock(block?: NotebookBlock): string | undefined {
  if (!block) return undefined;
  const cfg = block.config as CallConfig | EventConfig | ExpectConfig;
  if ("contractId" in cfg && typeof cfg.contractId === "string") {
    return cfg.contractId || undefined;
  }
  return undefined;
}

function formatPrimaryValue(
  result: BlockResult,
  decimals?: number | null,
  unitLabel?: string,
): string {
  const functionName = functionNameFromDetails(result.details);
  const output = result.details?.Output;
  if (isPlainObject(output)) {
    const entries = Object.entries(output);
    if (entries.length === 1) {
      const [label, val] = entries[0];
      const parsed = parseAbiDetailLabel(label);
      if (parsed) {
        return displayAbiValue(val, {
          type: parsed.type,
          name: parsed.name || undefined,
          functionName,
          decimals,
          unitLabel,
        });
      }
    }
  }
  if (typeof result.value === "bigint") {
    return displayAbiValue(result.value, {
      type: "uint256",
      functionName,
      decimals,
      unitLabel,
    });
  }
  return displayValue(result.value);
}

export function ResultPanel({
  blockId,
  result,
  project,
  block,
  contracts = [],
  publicClient: publicClientProp,
}: {
  blockId: string;
  result: BlockResult;
  project: Project;
  block?: NotebookBlock;
  contracts?: ContractEntry[];
  publicClient?: PublicClient;
}) {
  const showDetailsGlobal = useNotebookStore((s) => s.showDetails);
  const [showDetailsLocal, setShowDetailsLocal] = useState(false);
  const detailsOpen = showDetailsGlobal || showDetailsLocal;

  const fallbackClient = useMemo(
    () =>
      createPublicClient({
        chain: chainForProject(project),
        transport: http(project.rpcUrl),
      }) as PublicClient,
    [project],
  );
  const publicClient = publicClientProp ?? fallbackClient;

  const contract = useMemo(() => {
    const id = contractIdFromBlock(block);
    return id ? contracts.find((c) => c.id === id) : undefined;
  }, [block, contracts]);
  const { data: decimals } = useTokenDecimals(publicClient, contract);
  const unitLabel = contract?.name;
  const tabsProps = {
    blockId,
    result,
    project,
    contracts,
    publicClient,
    decimals,
    unitLabel,
  };

  if (result.status === "idle") return null;

  if (result.status === "running") {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <span className="size-2 animate-pulse rounded-full bg-primary" />
        Running…
      </div>
    );
  }

  if (result.status === "skipped") {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-xs text-muted-foreground/70">
        <CircleSlash className="size-3.5 shrink-0" />
        {result.kind ?? "Skipped"}
      </div>
    );
  }

  if (result.status === "error") {
    return (
      <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
        <div className="flex items-start gap-2 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1 break-words font-mono text-xs leading-5">
            {result.error}
          </span>
          <DetailsToggle
            open={detailsOpen}
            onToggle={() => setShowDetailsLocal((v) => !v)}
          />
        </div>
        {detailsOpen && <DetailTabs {...tabsProps} />}
      </div>
    );
  }

  const text = formatPrimaryValue(result, decimals, unitLabel);
  const isLong = text.length > 400 || text.includes("\n");

  return (
    <div className="mt-2 rounded-lg border bg-muted/40 px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <CircleCheck className="size-3.5 text-emerald-500" />
        {typeof result.execIndex === "number" && (
          <span className="font-mono text-[11px] text-muted-foreground/70">
            Out [{result.execIndex}]
          </span>
        )}
        {result.simulated && (
          <span className="rounded border border-teal-400/30 bg-teal-400/10 px-1 font-mono text-[10px] text-teal-400">
            simulated
          </span>
        )}
        {typeof result.durationMs === "number" && <span>{result.durationMs}ms</span>}
        {result.blockNumber !== undefined && (
          <span className="hidden font-mono sm:inline">
            block {String(result.blockNumber)}
          </span>
        )}
        {result.txHash && (
          <span className="flex items-center gap-1 font-mono">
            tx {result.txHash.slice(0, 10)}…
            {project.explorerUrl && (
              <a
                href={`${project.explorerUrl}/tx/${result.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                <ExternalLink className="size-3" />
              </a>
            )}
          </span>
        )}
        <DetailsToggle
          open={detailsOpen}
          onToggle={() => setShowDetailsLocal((v) => !v)}
        />
      </div>
      <pre
        className={
          "overflow-x-auto font-mono text-xs leading-5 text-foreground " +
          (isLong ? "max-h-64 overflow-y-auto whitespace-pre" : "whitespace-pre-wrap")
        }
      >
        {text}
      </pre>
      {detailsOpen && <DetailTabs {...tabsProps} />}
    </div>
  );
}
