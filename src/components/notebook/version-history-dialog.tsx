"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { blockLabel } from "@/lib/block-label";
import { diffVersions, type VersionDiff } from "@/lib/version-diff";
import { cn, formatWhen } from "@/lib/utils";
import type {
  ContractEntry,
  NotebookBlock,
  NotebookMeta,
  NotebookVersionMeta,
  Recipe,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

function editorLabel(version: NotebookVersionMeta): string {
  if (!version.editorId) return "Original";
  return version.editorName ?? "Guest";
}

/** One row in the change summary: colored marker + block label. */
function DiffRow({
  marker,
  markerClass,
  label,
  children,
}: {
  marker: string;
  markerClass: string;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid gap-0.5">
      <div className="flex items-baseline gap-2">
        <span className={cn("w-3 shrink-0 text-center font-mono text-xs", markerClass)}>
          {marker}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={label}>
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

/** field: old → new rows under an edited block. */
function FieldChanges({
  changes,
}: {
  changes: Array<{ field: string; from: string; to: string }>;
}) {
  return (
    <div className="grid gap-0.5 pl-5">
      {changes.map((c, i) => (
        <div
          key={`${c.field}-${i}`}
          className="grid grid-cols-[minmax(0,6rem)_1fr] items-baseline gap-2 text-[11px] leading-4"
        >
          <span className="truncate font-mono text-muted-foreground/70" title={c.field}>
            {c.field}
          </span>
          <span className="min-w-0 break-all font-mono">
            <span className="text-muted-foreground line-through decoration-muted-foreground/50">
              {c.from}
            </span>
            <span className="mx-1 text-muted-foreground/50">→</span>
            <span className="text-foreground/90">{c.to}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function ChangeSummary({
  diff,
  contracts,
  recipes,
}: {
  diff: VersionDiff;
  contracts: ContractEntry[];
  recipes: Recipe[];
}) {
  if (diff.isEmpty) {
    return (
      <p className="text-xs text-muted-foreground/70">
        No content changes against the previous version.
      </p>
    );
  }
  const label = (b: NotebookBlock) => blockLabel(b, contracts, recipes);
  return (
    <div className="grid gap-1.5">
      {diff.titleChange && (
        <DiffRow marker="±" markerClass="text-amber-300" label="Title">
          <FieldChanges
            changes={[{ field: "title", from: diff.titleChange.from, to: diff.titleChange.to }]}
          />
        </DiffRow>
      )}
      {diff.descriptionChange && (
        <DiffRow marker="±" markerClass="text-amber-300" label="Description">
          <FieldChanges
            changes={[
              {
                field: "description",
                from: diff.descriptionChange.from,
                to: diff.descriptionChange.to,
              },
            ]}
          />
        </DiffRow>
      )}
      {diff.added.map((b) => (
        <DiffRow key={b.id} marker="+" markerClass="text-emerald-400" label={label(b)} />
      ))}
      {diff.removed.map((b) => (
        <DiffRow key={b.id} marker="−" markerClass="text-red-400" label={label(b)} />
      ))}
      {diff.changed.map(({ block, changes }) => (
        <DiffRow
          key={block.id}
          marker="±"
          markerClass="text-amber-300"
          label={label(block)}
        >
          <FieldChanges changes={changes} />
        </DiffRow>
      ))}
      {diff.reordered && (
        <DiffRow marker="⇅" markerClass="text-sky-400" label="Blocks reordered" />
      )}
    </div>
  );
}

/**
 * Google-Docs-style version history: autosaved versions listed on the left
 * (grouped into editing sessions per editor), the selected version's changes
 * against its predecessor on the right, with one-click restore. Restoring
 * appends a new version — history never rewinds.
 */
export function VersionHistoryDialog({
  open,
  onOpenChange,
  notebookId,
  contracts,
  recipes,
  readOnly,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebookId: string;
  contracts: ContractEntry[];
  recipes: Recipe[];
  readOnly: boolean;
  onRestored: (notebook: NotebookMeta & { blocks: NotebookBlock[] }) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: versions, isLoading } = useQuery({
    queryKey: ["versions", notebookId],
    queryFn: () => api.notebooks.versions.list(notebookId),
    enabled: open,
    // The list should reflect the latest autosaves every time it opens.
    staleTime: 0,
  });

  // Newest first; fall back to the newest when nothing is selected.
  const selected =
    (selectedId && versions?.find((v) => v.id === selectedId)) || versions?.[0];
  const selectedIndex = selected && versions ? versions.indexOf(selected) : -1;
  const previous =
    versions && selectedIndex >= 0 ? versions[selectedIndex + 1] : undefined;

  // Closing drops the selection so the dialog reopens on the newest version.
  const handleOpenChange = (next: boolean) => {
    if (!next) setSelectedId(null);
    onOpenChange(next);
  };

  const { data: selectedFull } = useQuery({
    queryKey: ["version", notebookId, selected?.id],
    queryFn: () => api.notebooks.versions.get(notebookId, selected!.id),
    enabled: open && !!selected,
    staleTime: Infinity,
  });
  const { data: previousFull } = useQuery({
    queryKey: ["version", notebookId, previous?.id],
    queryFn: () => api.notebooks.versions.get(notebookId, previous!.id),
    enabled: open && !!previous,
    staleTime: Infinity,
  });

  const diff = useMemo(
    () =>
      selectedFull && previousFull
        ? diffVersions(previousFull, selectedFull, contracts)
        : null,
    [selectedFull, previousFull, contracts],
  );

  const restore = useMutation({
    mutationFn: (versionId: string) =>
      api.notebooks.versions.restore(notebookId, versionId),
    onSuccess: (notebook) => {
      queryClient.invalidateQueries({ queryKey: ["versions", notebookId] });
      toast.success("Version restored — the previous state stays in history");
      handleOpenChange(false);
      onRestored(notebook);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isCurrent = selectedIndex === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4 text-muted-foreground" />
            Version history
          </DialogTitle>
          <DialogDescription>
            Every save is recorded automatically; consecutive edits by the same
            editor group into one version. Restoring never loses work — the
            current state stays in history.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="grid gap-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : !versions || versions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No versions yet — they are recorded automatically as the notebook
            is edited.
          </p>
        ) : (
          <div className="grid grid-cols-[minmax(0,15rem)_1fr] overflow-hidden rounded-lg border">
            {/* Version list */}
            <div className="max-h-104 overflow-y-auto border-r bg-muted/20">
              {versions.map((v, index) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedId(v.id)}
                  className={cn(
                    "grid w-full gap-0.5 border-b border-border/40 px-3 py-2 text-left transition-colors last:border-b-0",
                    selected?.id === v.id
                      ? "bg-muted"
                      : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    <span className="truncate">{formatWhen(v.updatedAt)}</span>
                    {index === 0 && (
                      <span className="shrink-0 rounded border border-emerald-400/30 bg-emerald-400/10 px-1 font-mono text-[10px] text-emerald-400">
                        current
                      </span>
                    )}
                    {v.restoredFrom && (
                      <span
                        className="shrink-0 rounded border border-sky-400/30 bg-sky-400/10 px-1 font-mono text-[10px] text-sky-400"
                        title="Created by restoring an earlier version"
                      >
                        restored
                      </span>
                    )}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {editorLabel(v)} · {v.blockCount}{" "}
                    {v.blockCount === 1 ? "block" : "blocks"}
                  </span>
                </button>
              ))}
            </div>

            {/* Selected version details */}
            <div className="grid max-h-104 content-start gap-3 overflow-y-auto p-3">
              {selected && (
                <>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {formatWhen(selected.updatedAt)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {editorLabel(selected)} · &ldquo;{selected.title}&rdquo;
                      </p>
                    </div>
                    {!readOnly && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isCurrent || restore.isPending}
                        title={
                          isCurrent
                            ? "This is already the current version"
                            : "Make this version the current notebook content"
                        }
                        onClick={() => {
                          if (
                            confirm(
                              `Restore the version from ${formatWhen(selected.updatedAt)}? The current content stays available in history.`,
                            )
                          ) {
                            restore.mutate(selected.id);
                          }
                        }}
                      >
                        <RotateCcw data-icon="inline-start" />
                        {restore.isPending ? "Restoring…" : "Restore"}
                      </Button>
                    )}
                  </div>

                  <div className="grid gap-1.5">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {previous
                        ? "Changes in this version"
                        : "Oldest saved version"}
                    </p>
                    {previous ? (
                      diff ? (
                        <ChangeSummary
                          diff={diff}
                          contracts={contracts}
                          recipes={recipes}
                        />
                      ) : (
                        <Skeleton className="h-16" />
                      )
                    ) : (
                      <p className="text-xs text-muted-foreground/70">
                        {selected.editorId
                          ? "The beginning of this notebook's recorded history."
                          : "The notebook as it was before edit tracking began."}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-1.5">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Blocks in this version ({selected.blockCount})
                    </p>
                    {selectedFull ? (
                      selectedFull.blocks.length === 0 ? (
                        <p className="text-xs text-muted-foreground/70">
                          The notebook was empty.
                        </p>
                      ) : (
                        <div className="grid gap-px">
                          {selectedFull.blocks.map((b, i) => (
                            <div
                              key={b.id}
                              className="flex items-baseline gap-2 text-xs"
                            >
                              <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted-foreground/40">
                                {i + 1}
                              </span>
                              <span
                                className={cn(
                                  "min-w-0 flex-1 truncate font-mono text-muted-foreground",
                                  b.parentId && "pl-3",
                                )}
                                title={blockLabel(b, contracts, recipes)}
                              >
                                {blockLabel(b, contracts, recipes)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )
                    ) : (
                      <Skeleton className="h-16" />
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
