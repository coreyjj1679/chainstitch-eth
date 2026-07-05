"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import {
  BookMarked,
  Braces,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Eye,
  FileJson,
  GitBranch,
  LayoutGrid,
  NotebookPen,
  Pencil,
  Plus,
  Radio,
  ScrollText,
  SquarePlay,
  Trash2,
  UserRound,
  Variable,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  useContracts,
  useNotebooks,
  useProject,
  useRecipes,
  useRuns,
} from "@/lib/hooks";
import { duplicateNotebook } from "@/lib/duplicate-notebook";
import { blockLabel, executionOrder, isExecutableType } from "@/lib/block-label";
import { displayValue } from "@/lib/serialize";
import { confirmLosingRecipeEdits, useNotebookStore } from "@/stores/notebook-store";
import { CreateNotebookDialog } from "@/components/layout/create-notebook-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, timeAgo } from "@/lib/utils";
import type { BlockType } from "@/lib/types";

const BLOCK_ICONS: Record<BlockType, typeof Eye> = {
  read: Eye,
  write: Pencil,
  rpc: Radio,
  event: ScrollText,
  markdown: Braces,
  sender: UserRound,
  variable: Variable,
  if: GitBranch,
  recipe: BookMarked,
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </span>
  );
}

// Collapsed/expanded state lives in localStorage so it sticks across visits;
// useSyncExternalStore keeps hydration safe (server pass renders open) and
// the listener set lets toggles re-render every subscribed section.
const sectionListeners = new Set<() => void>();
function subscribeSections(listener: () => void) {
  sectionListeners.add(listener);
  return () => sectionListeners.delete(listener);
}

function useSectionOpen(id: string): [boolean, () => void] {
  const storageKey = `cn-sidebar-section-${id}`;
  const open = useSyncExternalStore(
    subscribeSections,
    () => localStorage.getItem(storageKey) !== "collapsed",
    () => true,
  );
  const toggle = () => {
    localStorage.setItem(storageKey, open ? "collapsed" : "open");
    for (const listener of sectionListeners) listener();
  };
  return [open, toggle];
}

/**
 * Collapsible sidebar section: the header row toggles its children, the
 * chevron mirrors the state, and the choice sticks per section.
 */
function SidebarSection({
  id,
  label,
  action,
  className,
  children,
}: {
  /** Storage suffix, e.g. "blocks" → cn-sidebar-section-blocks. */
  id: string;
  label: string;
  /** Optional right-aligned control (e.g. the new-notebook button). */
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, toggle] = useSectionOpen(id);

  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          title={open ? `Collapse ${label}` : `Expand ${label}`}
          className="group/section flex min-w-0 flex-1 items-center gap-1 rounded-md py-0.5 text-left"
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground/60 transition-colors group-hover/section:text-foreground" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground/60 transition-colors group-hover/section:text-foreground" />
          )}
          <SectionLabel>{label}</SectionLabel>
        </button>
        {action}
      </div>
      {open && children}
    </div>
  );
}

/** Jupyter-style table of contents for the document currently loaded. */
function BlockToc({ projectId }: { projectId: string }) {
  const storeNotebookId = useNotebookStore((s) => s.notebookId);
  const docKind = useNotebookStore((s) => s.docKind);
  const blocks = useNotebookStore((s) => s.blocks);
  const results = useNotebookStore((s) => s.results);
  const { data: contracts } = useContracts(projectId);
  const { data: recipes } = useRecipes(projectId);
  const pathname = usePathname();
  const router = useRouter();

  if (!storeNotebookId || blocks.length === 0) return null;
  const notebookPath =
    docKind === "recipe"
      ? `/p/${projectId}/r/${storeNotebookId}`
      : `/p/${projectId}/n/${storeNotebookId}`;

  // Scroll to a block, navigating back to the notebook page first if needed.
  const goToBlock = (blockId: string) => {
    const scroll = () =>
      document
        .getElementById(`block-${blockId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (pathname !== notebookPath) {
      router.push(notebookPath);
      setTimeout(scroll, 300);
    } else {
      scroll();
    }
  };

  return (
    <SidebarSection id="blocks" label="Blocks" className="border-t px-3 pt-3 pb-2">
      <div className="mt-1.5 grid gap-px">
        {executionOrder(blocks).map((block, index) => {
          const Icon = BLOCK_ICONS[block.type];
          const result = results[block.id];
          // Only blocks that execute carry a run-status dot.
          const isRunnable = isExecutableType(block.type);
          return (
            <button
              key={block.id}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
                block.parentId && "pl-3",
              )}
              onClick={() => goToBlock(block.id)}
              title={blockLabel(block, contracts ?? [], recipes)}
            >
              <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted-foreground/40">
                {index + 1}
              </span>
              <Icon
                className={cn(
                  "size-3 shrink-0",
                  block.type === "sender" && "text-teal-400",
                  block.type === "variable" && "text-amber-300",
                  block.type === "if" && "text-fuchsia-400",
                  block.type === "recipe" && "text-cyan-400",
                )}
              />
              <span className="min-w-0 flex-1 truncate font-mono">
                {blockLabel(block, contracts ?? [], recipes)}
              </span>
              {isRunnable && (
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    result?.status === "success" && "bg-emerald-400",
                    result?.status === "error" && "bg-red-400",
                    result?.status === "running" && "animate-pulse bg-amber-400",
                    result?.status === "skipped" && "bg-muted-foreground/40",
                    (!result || result.status === "idle") && "bg-muted-foreground/25",
                  )}
                  title={result?.status ?? "not run"}
                />
              )}
            </button>
          );
        })}
      </div>
    </SidebarSection>
  );
}

/**
 * Turns a decoded run value into `[key, value]` rows for an expandable table.
 * Arrays become `[0]`, `[1]`, …; plain objects become their own entries.
 * Scalars (bigint, string, number, etc.) return null so the row stays compact.
 */
function structuredEntries(value: unknown): [string, unknown][] | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map((v, i) => [`[${i}]`, v] as [string, unknown]);
  }
  const entries = Object.entries(value);
  return entries.length > 0 ? entries : null;
}

/** Key/value table for a structured (tuple/object/array) output. */
function StructuredTable({ entries }: { entries: [string, unknown][] }) {
  return (
    <dl className="mt-1 grid gap-1 pl-5">
      {entries.map(([key, val], i) => {
        const text = displayValue(val);
        return (
          <div
            key={`${key}-${i}`}
            className="grid grid-cols-[minmax(0,6.5rem)_1fr] items-baseline gap-2"
          >
            <dt
              title={key}
              className="truncate font-mono text-[10px] leading-4 text-muted-foreground/70"
            >
              {key}
            </dt>
            <dd className="min-w-0 font-mono text-[10px] leading-4 text-foreground/90">
              <button
                className="break-all whitespace-pre-wrap text-left line-clamp-3 hover:text-primary"
                title={`Click to copy\n${text}`}
                onClick={() => {
                  navigator.clipboard.writeText(text);
                  toast.success(`Copied ${key}`);
                }}
              >
                {text}
              </button>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * A variable row: click the name to copy `{{name}}` (for reuse in other blocks),
 * click the value to copy the value itself. Scalar values render inline (wrapped
 * up to two lines, full value on hover). Structured outputs (tuples, objects,
 * arrays) render as just a chevron + name — no inline preview — and expand into
 * a key/value table on toggle, so fields like `slot0` or `latestRoundData` are
 * readable in the narrow sidebar.
 */
function VariableRow({
  name,
  value,
  structured,
  muted,
  accent,
}: {
  name: string;
  value: string | null;
  structured: [string, unknown][] | null;
  muted?: boolean;
  accent: string;
}) {
  const [open, setOpen] = useState(false);
  const display = value ?? "not run";
  const expandable = !!structured && structured.length > 1;

  return (
    <div className="group/var rounded-md px-1.5 py-1 font-mono text-xs transition-colors hover:bg-muted/50">
      <div className="flex items-baseline gap-1.5">
        {expandable ? (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Collapse" : "Expand"}
            title={open ? "Collapse" : "Expand"}
            className="flex size-3 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            {open ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <button
          className={cn("shrink-0 hover:underline", accent)}
          title={`Click to copy {{${name}}}`}
          onClick={() => {
            navigator.clipboard.writeText(`{{${name}}}`);
            toast.success(`Copied {{${name}}}`);
          }}
        >
          {name}
        </button>
        { !expandable && (
          <button
            className={cn(
              "min-w-0 flex-1 break-all whitespace-pre-wrap text-left line-clamp-2",
              muted
                ? "italic text-muted-foreground/40"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={
              muted
                ? `{{${name}}} has not been run yet`
                : `Click to copy the value\n${display}`
            }
            disabled={muted}
            onClick={() => {
              if (!value) return;
              navigator.clipboard.writeText(value);
              toast.success(`Copied value of ${name}`);
            }}
          >
            {display}
          </button>
        )}
      </div>
      {open && expandable && structured && <StructuredTable entries={structured} />}
    </div>
  );
}

/** Constants (variable blocks) and run-declared output variables, click to copy. */
function VariablesPanel() {
  const storeNotebookId = useNotebookStore((s) => s.notebookId);
  const blocks = useNotebookStore((s) => s.blocks);
  const scope = useNotebookStore((s) => s.scope);
  const results = useNotebookStore((s) => s.results);

  if (!storeNotebookId) return null;

  const constants = blocks
    .filter((b) => b.type === "variable")
    .map((b) => b.config as { name: string; value: string })
    .filter((c) => c.name);

  const declaredBlocks = blocks.filter((b) => !!b.outputVariable);

  if (constants.length === 0 && declaredBlocks.length === 0) return null;

  return (
    <>
      {constants.length > 0 && (
        <SidebarSection
          id="constants"
          label="Constants"
          className="border-t px-3 pt-3 pb-2"
        >
          <div className="mt-1.5 grid gap-px">
            {constants.map((c, i) => (
              <VariableRow
                key={`${c.name}-${i}`}
                name={c.name}
                value={c.value || "—"}
                structured={null}
                accent="text-amber-300"
              />
            ))}
          </div>
        </SidebarSection>
      )}
      {declaredBlocks.length > 0 && (
        <SidebarSection
          id="variables"
          label="Variables"
          className="border-t px-3 pt-3 pb-2"
        >
          <div className="mt-1.5 grid gap-px">
            {declaredBlocks.map((b, i) => {
              const name = b.outputVariable as string;
              const hasValue = name in scope;
              const raw = scope[name];
              // Reads expose ABI-named outputs in details.Output (e.g.
              // "sqrtPriceX96 (uint160)"); fall back to the raw decoded value
              // for RPC calls and writes.
              const structured = hasValue
                ? structuredEntries(results[b.id]?.details?.Output ?? raw)
                : null;
              return (
                <VariableRow
                  key={`${name}-${i}`}
                  name={name}
                  value={hasValue ? displayValue(raw) : null}
                  structured={structured}
                  muted={!hasValue}
                  accent="text-primary"
                />
              );
            })}
          </div>
        </SidebarSection>
      )}
    </>
  );
}

/**
 * Saved "Run all" outputs, pinned as the sidebar's bottom group. Each entry
 * is an immutable run record that opens in its own document tab.
 */
function SavedRunsSection({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: runs } = useRuns(projectId);
  const base = `/p/${projectId}`;

  const removeRun = useMutation({
    mutationFn: (runId: string) => api.runs.remove(runId),
    onSuccess: (_data, runId) => {
      queryClient.invalidateQueries({ queryKey: ["runs", projectId] });
      if (pathname === `${base}/runs/${runId}`) router.push(base);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <SidebarSection
      id="runs"
      label="Saved runs"
      className="shrink-0 border-t px-3 pt-3 pb-1"
    >
      <nav className="-mx-1 mt-1 max-h-[22vh] overflow-y-auto pb-1">
        {runs && runs.length > 0 ? (
          <div className="grid gap-0.5">
            {runs.map((run) => {
              const href = `${base}/runs/${run.id}`;
              const active = pathname === href;
              return (
                <Link
                  key={run.id}
                  href={href}
                  onClick={(e) => {
                    if (!confirmLosingRecipeEdits()) e.preventDefault();
                  }}
                  title={[
                    `${run.notebookTitle} — ${new Date(run.createdAt).toLocaleString()}`,
                    run.ranByName ? `ran by ${run.ranByName}` : null,
                    `${run.succeeded} succeeded, ${run.failed} failed, ${run.skipped} skipped`,
                    run.simulated ? "simulated" : null,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                  className={cn(
                    "group/link relative flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors",
                    active
                      ? "bg-muted font-medium text-foreground before:absolute before:inset-y-1 before:-left-1 before:w-0.5 before:rounded-full before:bg-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <SquarePlay
                    className={cn(
                      "size-3.5 shrink-0",
                      run.failed > 0 ? "text-red-400/80" : "text-emerald-400/80",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{run.notebookTitle}</span>
                  {run.simulated && (
                    <span className="shrink-0 rounded border border-teal-400/30 bg-teal-400/10 px-1 font-mono text-[10px] text-teal-400">
                      sim
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">
                    {timeAgo(run.createdAt)}
                  </span>
                  {canEdit && (
                    <span className="hidden shrink-0 items-center group-hover/link:flex">
                      <button
                        className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label="Delete saved run"
                        title="Delete this saved run"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (confirm("Delete this saved run output?")) {
                            removeRun.mutate(run.id);
                          }
                        }}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="px-2 py-2 text-xs text-muted-foreground/70">
            No saved runs yet. &ldquo;Run all&rdquo; in a notebook saves its
            output here.
          </p>
        )}
      </nav>
    </SidebarSection>
  );
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const WIDTH_STORAGE_KEY = "cn-sidebar-width";

export function ProjectSidebar({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: notebooks, isLoading } = useNotebooks(projectId);
  const { data: recipes, isLoading: recipesLoading } = useRecipes(projectId);
  const { data: project } = useProject(projectId);
  // Effective role on this project (workspace role or per-project grant).
  const canEdit = project?.role === "editor" || project?.role === "owner";
  const base = `/p/${projectId}`;

  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 240;
    const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    return saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : 240;
  });
  const draggingRef = useRef(false);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ev.clientX));
      setWidth(next);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidth((w) => {
        localStorage.setItem(WIDTH_STORAGE_KEY, String(w));
        return w;
      });
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const remove = useMutation({
    mutationFn: (notebookId: string) => api.notebooks.remove(notebookId),
    onSuccess: (_data, notebookId) => {
      queryClient.invalidateQueries({ queryKey: ["notebooks", projectId] });
      if (pathname === `${base}/n/${notebookId}`) router.push(base);
    },
  });

  const createRecipe = useMutation({
    mutationFn: () =>
      api.recipes.create(projectId, { name: "Untitled recipe", blocks: [] }),
    onSuccess: (recipe) => {
      queryClient.invalidateQueries({ queryKey: ["recipes", projectId] });
      router.push(`${base}/r/${recipe.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRecipe = useMutation({
    mutationFn: (recipeId: string) => api.recipes.remove(recipeId),
    onSuccess: (_data, recipeId) => {
      queryClient.invalidateQueries({ queryKey: ["recipes", projectId] });
      if (pathname === `${base}/r/${recipeId}`) router.push(base);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicate = useMutation({
    mutationFn: (notebookId: string) => duplicateNotebook(projectId, notebookId),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["notebooks", projectId] });
      router.push(`${base}/n/${created.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <aside
      className="relative flex shrink-0 flex-col overflow-hidden border-r bg-background/50"
      style={{ width }}
      suppressHydrationWarning
    >
      {/* Project-level nav pinned at the top */}
      <div className="grid gap-0.5 border-b p-2">
        <Link
          href={base}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
            pathname === base
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          <LayoutGrid className="size-3.5 shrink-0" />
          Overview
        </Link>
        <Link
          href={`${base}/contracts`}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
            pathname === `${base}/contracts`
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          <FileJson className="size-3.5 shrink-0" />
          Contracts
        </Link>
        <Link
          href={`${base}/state`}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
            pathname === `${base}/state`
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          <Database className="size-3.5 shrink-0" />
          State
        </Link>
      </div>

      <SidebarSection
        id="notebooks"
        label="Notebooks"
        className="shrink-0 px-3 pt-3 pb-1"
        action={
          canEdit && (
            <CreateNotebookDialog
              projectId={projectId}
              trigger={<Button variant="ghost" size="icon-xs" aria-label="New notebook" />}
            >
              <Plus />
            </CreateNotebookDialog>
          )
        }
      >
        <nav className="-mx-1 mt-1 max-h-[40vh] overflow-y-auto pb-1">
          {isLoading ? (
          <div className="grid gap-1 p-1">
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
          </div>
        ) : notebooks && notebooks.length > 0 ? (
          <div className="grid gap-0.5">
            {notebooks.map((n) => {
              const href = `${base}/n/${n.id}`;
              const active = pathname === href;
              return (
                <Link
                  key={n.id}
                  href={href}
                  onClick={(e) => {
                    if (!confirmLosingRecipeEdits(n.id)) e.preventDefault();
                  }}
                  className={cn(
                    "group/link relative flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors",
                    active
                      ? "bg-muted font-medium text-foreground before:absolute before:inset-y-1 before:-left-1 before:w-0.5 before:rounded-full before:bg-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <NotebookPen className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{n.title}</span>
                  {canEdit && (
                    <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/link:opacity-100">
                      <button
                        className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={`Duplicate ${n.title}`}
                        title="Duplicate notebook"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          duplicate.mutate(n.id);
                        }}
                      >
                        <Copy className="size-3" />
                      </button>
                      <button
                        className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={`Delete ${n.title}`}
                        title="Delete notebook"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (confirm(`Delete notebook "${n.title}"?`)) remove.mutate(n.id);
                        }}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="px-2 py-2 text-xs text-muted-foreground/70">
            {canEdit ? "No notebooks yet. Click + to create one." : "No notebooks yet."}
          </p>
        )}
        </nav>
      </SidebarSection>

      {/* Recipes are documents like notebooks: open one to edit & test it. */}
      <SidebarSection
        id="recipes"
        label="Recipes"
        className="shrink-0 border-t px-3 pt-3 pb-1"
        action={
          canEdit && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="New recipe"
              title="New recipe — build it like a notebook, then Save"
              disabled={createRecipe.isPending}
              onClick={() => {
                if (confirmLosingRecipeEdits()) createRecipe.mutate();
              }}
            >
              <Plus />
            </Button>
          )
        }
      >
        <nav className="-mx-1 mt-1 max-h-[30vh] overflow-y-auto pb-1">
          {recipesLoading ? (
            <div className="grid gap-1 p-1">
              <Skeleton className="h-7" />
            </div>
          ) : recipes && recipes.length > 0 ? (
            <div className="grid gap-0.5">
              {recipes.map((r) => {
                const href = `${base}/r/${r.id}`;
                const active = pathname === href;
                const usedIn = r.usedIn ?? 0;
                return (
                  <Link
                    key={r.id}
                    href={href}
                    onClick={(e) => {
                      if (!confirmLosingRecipeEdits(r.id)) e.preventDefault();
                    }}
                    title={
                      [
                        r.description,
                        usedIn > 0
                          ? `Linked in ${usedIn} ${usedIn === 1 ? "notebook" : "notebooks"}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join("\n") || undefined
                    }
                    className={cn(
                      "group/link relative flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors",
                      active
                        ? "bg-muted font-medium text-foreground before:absolute before:inset-y-1 before:-left-1 before:w-0.5 before:rounded-full before:bg-primary"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <BookMarked className="size-3.5 shrink-0 text-cyan-400/80" />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    {canEdit && (
                      <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/link:opacity-100">
                        <button
                          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label={`Delete ${r.name}`}
                          title="Delete recipe"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const warning =
                              usedIn > 0
                                ? `Delete recipe "${r.name}"? ${usedIn} ${usedIn === 1 ? "notebook links" : "notebooks link"} to it — their recipe cells will show it as deleted.`
                                : `Delete recipe "${r.name}"?`;
                            if (confirm(warning)) removeRecipe.mutate(r.id);
                          }}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="px-2 py-2 text-xs text-muted-foreground/70">
              {canEdit
                ? "No recipes yet. Bookmark cells in a notebook, or click + to start one."
                : "No recipes yet."}
            </p>
          )}
        </nav>
      </SidebarSection>

      {/* Blocks / Constants / Variables — stay visible across all project pages */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <BlockToc projectId={projectId} />
        <VariablesPanel />
      </div>

      {/* Saved Run-all outputs, pinned at the bottom */}
      <SavedRunsSection projectId={projectId} canEdit={canEdit} />

      {/* Resize handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={startResize}
        onDoubleClick={() => {
          setWidth(240);
          localStorage.setItem(WIDTH_STORAGE_KEY, "240");
        }}
        className="group/resize absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize"
        title="Drag to resize · double-click to reset"
      >
        <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover/resize:bg-primary/40" />
      </div>
    </aside>
  );
}
