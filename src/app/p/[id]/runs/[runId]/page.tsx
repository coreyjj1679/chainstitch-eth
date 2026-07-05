"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  NotebookPen,
  SquarePlay,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useProject } from "@/lib/hooks";
import { parseBigIntSafe, displayValue } from "@/lib/serialize";
import { cn, formatWhen } from "@/lib/utils";
import { closeDocTab } from "@/stores/doc-tabs";
import { DetailsGrid } from "@/components/notebook/result-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { SavedRunEntry, SavedRunRecord } from "@/lib/types";

function StatusIcon({ entry }: { entry: SavedRunEntry }) {
  switch (entry.result?.status) {
    case "success":
      return <CircleCheck className="size-3.5 shrink-0 text-emerald-500" />;
    case "error":
      return <CircleAlert className="size-3.5 shrink-0 text-destructive" />;
    case "skipped":
      return <CircleSlash className="size-3.5 shrink-0 text-muted-foreground/60" />;
    default:
      return (
        <span
          className="mx-[3px] size-2 shrink-0 rounded-full border border-muted-foreground/40"
          title="The run stopped before reaching this block"
        />
      );
  }
}

/** One block's frozen output inside a saved run. */
function RunEntry({ entry, index }: { entry: SavedRunEntry; index: number }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const result = entry.result;
  const details: Record<string, unknown> = {
    ...(result?.kind ? { Kind: result.kind } : {}),
    ...(result?.sender ? { Sender: result.sender } : {}),
    ...(result?.blockNumber !== undefined
      ? { "Block number": result.blockNumber }
      : {}),
    ...(result?.details ? result.details : {}),
    ...(result?.events && result.events.length > 0
      ? {
          Events: Object.fromEntries(
            result.events.map((e, i) => [
              `[${e.logIndex ?? i}] ${e.contract}.${e.event}`,
              e.args ?? "(not decoded)",
            ]),
          ),
        }
      : {}),
    ...(result?.txDetails ? { Transaction: result.txDetails } : {}),
  };
  const hasDetails = Object.keys(details).length > 0;

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="w-5 shrink-0 text-right font-mono text-[10px] text-muted-foreground/50">
          {index + 1}
        </span>
        <StatusIcon entry={entry} />
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs"
          title={entry.label}
        >
          {entry.label}
        </span>
        {result?.simulated && (
          <span className="shrink-0 rounded border border-teal-400/30 bg-teal-400/10 px-1 font-mono text-[10px] text-teal-400">
            sim
          </span>
        )}
        {typeof result?.execIndex === "number" && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
            Out [{result.execIndex}]
          </span>
        )}
        {typeof result?.durationMs === "number" && (
          <span className="shrink-0 text-[11px] text-muted-foreground/60">
            {result.durationMs}ms
          </span>
        )}
        {hasDetails && (
          <button
            className="flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setDetailsOpen((v) => !v)}
            title="Show call and transaction details"
          >
            {detailsOpen ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            details
          </button>
        )}
      </div>

      {result?.status === "success" && result.value !== undefined && (
        <pre className="max-h-64 overflow-auto border-t bg-muted/40 px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-all">
          {displayValue(result.value)}
        </pre>
      )}
      {result?.status === "error" && (
        <p className="border-t border-destructive/30 bg-destructive/10 px-3 py-2 font-mono text-xs leading-5 wrap-break-word text-destructive">
          {result.error}
        </p>
      )}
      {result?.status === "skipped" && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground/70">
          {result.kind ?? "Skipped"}
        </p>
      )}
      {!result && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground/50 italic">
          Not reached — the run stopped earlier.
        </p>
      )}

      {detailsOpen && hasDetails && (
        <div className="border-t px-3 py-2">
          <DetailsGrid record={details} />
        </div>
      )}
    </div>
  );
}

/** Read-only viewer for one saved Run-all output (opens as a document tab). */
export default function SavedRunPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: project } = useProject(id);
  const canEdit = project?.role === "editor" || project?.role === "owner";

  const { data: run, isLoading, error } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.runs.get(runId),
    // Saved runs are immutable; no reason to refetch.
    staleTime: Infinity,
    retry: false,
  });

  const remove = useMutation({
    mutationFn: () => api.runs.remove(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runs", id] });
      const remaining = closeDocTab(id, { kind: "run", id: runId });
      const next = remaining[remaining.length - 1];
      router.push(
        next
          ? next.kind === "run"
            ? `/p/${id}/runs/${next.id}`
            : `/p/${id}/${next.kind === "notebook" ? "n" : "r"}/${next.id}`
          : `/p/${id}`,
      );
      toast.success("Saved run deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !project) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center rounded-xl border border-dashed px-8 py-14 text-center">
        <p className="mb-1 font-medium">Saved run not found</p>
        <p className="text-sm text-muted-foreground">
          It may have been deleted, or pruned by the per-notebook cap.
        </p>
      </div>
    );
  }

  let record: SavedRunRecord | null = null;
  try {
    record = parseBigIntSafe(run.state) as SavedRunRecord;
  } catch {
    // Corrupt blob: fall through to the empty state below.
  }
  const entries = record?.entries ?? [];

  return (
    <div className="grid gap-4">
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <SquarePlay className="size-3.5 shrink-0 text-emerald-400" />
          Saved run output
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {run.notebookTitle}
          </h1>
          <Badge variant="secondary" className="font-mono text-xs">
            {formatWhen(run.createdAt)}
          </Badge>
          {run.simulated && (
            <Badge
              variant="secondary"
              className="border border-teal-400/30 bg-teal-400/10 font-mono text-xs text-teal-400"
            >
              simulated
            </Badge>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {run.ranByName && <span>ran by {run.ranByName}</span>}
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            {run.succeeded} succeeded
          </span>
          {run.failed > 0 && (
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-red-400" />
              {run.failed} failed
            </span>
          )}
          {run.skipped > 0 && (
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-muted-foreground/40" />
              {run.skipped} skipped
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            <Link
              href={`/p/${id}/n/${run.notebookId}`}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-muted hover:text-foreground",
              )}
            >
              <NotebookPen className="size-3.5" />
              Open notebook
            </Link>
            {canEdit && (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground hover:text-destructive"
                disabled={remove.isPending}
                onClick={() => {
                  if (confirm("Delete this saved run output?")) remove.mutate();
                }}
              >
                <Trash2 data-icon="inline-start" />
                Delete
              </Button>
            )}
          </span>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed px-8 py-10 text-center text-sm text-muted-foreground">
          This run recorded no block outputs.
        </div>
      ) : (
        <div className="grid gap-2">
          {entries.map((entry, index) => (
            <RunEntry key={`${entry.blockId}-${index}`} entry={entry} index={index} />
          ))}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground/50">
        A snapshot of the outputs when this run finished — later notebook edits
        don&apos;t change it.
      </p>
    </div>
  );
}
