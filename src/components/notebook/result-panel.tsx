"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  ExternalLink,
} from "lucide-react";
import { displayValue } from "@/lib/serialize";
import { useNotebookStore } from "@/stores/notebook-store";
import type { BlockResult, DecodedEventEntry, Project } from "@/lib/types";
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

/**
 * Key/value grid where every row — nested or not — uses the same label
 * column width and baseline, so the two columns stay vertically aligned.
 * Also used by the saved-run viewer.
 */
export function DetailsGrid({ record }: { record: Record<string, unknown> }) {
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
            {row.header ? "" : displayValue(row.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Receipt logs decoded against the address book: one card per event with
 * its emitter and an args grid — the "did the right event fire?" check.
 */
function EventsList({ events }: { events: DecodedEventEntry[] }) {
  return (
    <div className="grid max-h-72 gap-1.5 overflow-y-auto">
      {events.map((entry, i) => (
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
              <DetailsGrid record={entry.args} />
            </div>
          )}
        </div>
      ))}
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
}: {
  blockId: string;
  result: BlockResult;
  project: Project;
}) {
  const history = useNotebookStore((s) => s.history[blockId]) ?? [];

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
          <DetailsGrid record={result.details} />
        </TabsContent>
      )}
      {result.events && result.events.length > 0 && (
        <TabsContent value="events">
          <EventsList events={result.events} />
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

export function ResultPanel({
  blockId,
  result,
  project,
}: {
  blockId: string;
  result: BlockResult;
  project: Project;
}) {
  const showDetailsGlobal = useNotebookStore((s) => s.showDetails);
  const [showDetailsLocal, setShowDetailsLocal] = useState(false);
  const detailsOpen = showDetailsGlobal || showDetailsLocal;

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
        {detailsOpen && (
          <DetailTabs blockId={blockId} result={result} project={project} />
        )}
      </div>
    );
  }

  const text = displayValue(result.value);
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
      {detailsOpen && (
        <DetailTabs blockId={blockId} result={result} project={project} />
      )}
    </div>
  );
}
