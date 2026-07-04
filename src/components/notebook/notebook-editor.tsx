"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPublicClient, http, isAddress, type PublicClient } from "viem";
import { useAccount, useConfig } from "wagmi";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  BookMarked,
  BookmarkPlus,
  Braces,
  ChevronsDownUp,
  ChevronsUpDown,
  Code2,
  Copy,
  Download,
  Eye,
  FlaskConical,
  GitBranch,
  Info,
  ListRestart,
  Pencil,
  Play,
  Plus,
  Radio,
  Settings2,
  StepForward,
  UserRound,
  Variable,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { runBlock, shortError } from "@/lib/engine";
import { evaluateCondition } from "@/lib/condition";
import { interpolate } from "@/lib/variables";
import {
  blockLabel,
  executionOrder,
  isBlockConfigured,
  isGroupType,
} from "@/lib/block-label";
import { parseBigIntSafe, stringifyBigIntSafe } from "@/lib/serialize";
import { generateNotebookCode, type CodeFlavor } from "@/lib/codegen";
import { chainForProject } from "@/components/wallet/project-web3-provider";
import { useNotebookStore } from "@/stores/notebook-store";
import { BlockShell } from "@/components/notebook/block-shell";
import { BlockSummary } from "@/components/notebook/block-summary";
import { CallBlock } from "@/components/notebook/call-block";
import { RpcBlock } from "@/components/notebook/rpc-block";
import { MarkdownBlock } from "@/components/notebook/markdown-block";
import { SenderBlock } from "@/components/notebook/sender-block";
import { VariableBlock } from "@/components/notebook/variable-block";
import { IfBlock } from "@/components/notebook/if-block";
import { RecipeBlock } from "@/components/notebook/recipe-block";
import { CodePanel } from "@/components/notebook/code-panel";
import { SaveRecipeDialog } from "@/components/notebook/recipe-dialogs";
import type {
  BlockResult,
  BlockType,
  CallConfig,
  ContractEntry,
  IfConfig,
  MarkdownConfig,
  NotebookBlock,
  NotebookRunState,
  Project,
  Recipe,
  RecipeBlockConfig,
  RpcConfig,
  SenderConfig,
  VariableConfig,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const BLOCK_TYPES: Array<{
  type: BlockType;
  label: string;
  description: string;
  icon: typeof Eye;
}> = [
  { type: "read", label: "Read", description: "Call a view function", icon: Eye },
  { type: "write", label: "Write", description: "Send a transaction", icon: Pencil },
  { type: "rpc", label: "RPC", description: "Raw JSON-RPC call", icon: Radio },
  { type: "markdown", label: "Text", description: "Markdown notes", icon: Braces },
  {
    type: "variable",
    label: "Variable",
    description: "Define a constant",
    icon: Variable,
  },
  {
    type: "sender",
    label: "Simulation",
    description: "Run child blocks as one caller",
    icon: UserRound,
  },
  {
    type: "if",
    label: "Condition",
    description: "Run blocks only when a condition holds",
    icon: GitBranch,
  },
  {
    type: "recipe",
    label: "Recipe",
    description: "Rerun a saved recipe as one cell",
    icon: BookMarked,
  },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

function scrollToBlock(id: string) {
  setTimeout(() => {
    document
      .getElementById(`block-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 60);
}

function AddBlockMenu({
  trigger,
  onAdd,
  align = "start",
  recipes,
  recipesLabel = "Recipes",
  onInsertRecipe,
  onManageRecipes,
}: {
  trigger: React.ReactElement;
  onAdd: (type: BlockType) => void;
  align?: "start" | "center" | "end";
  /** Saved recipes offered below the block types (already filtered by caller). */
  recipes?: Recipe[];
  /** Section heading — callers use it to hint what insertion does. */
  recipesLabel?: string;
  onInsertRecipe?: (recipe: Recipe) => void;
  onManageRecipes?: () => void;
}) {
  const showRecipes = !!onInsertRecipe && !!recipes && recipes.length > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger}>
        <Plus />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-56">
        {BLOCK_TYPES.map(({ type, label, description, icon: Icon }) => (
          <DropdownMenuItem key={type} onClick={() => onAdd(type)} className="gap-2">
            <Icon className="size-3.5 text-muted-foreground" />
            <span className="flex flex-col gap-0">
              <span className="text-xs font-medium leading-4">{label}</span>
              <span className="text-[11px] leading-4 text-muted-foreground">
                {description}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
        {showRecipes && (
          <>
            <DropdownMenuSeparator />
            {/* Base UI requires group labels to live inside a Menu.Group. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{recipesLabel}</DropdownMenuLabel>
              {recipes.map((recipe) => (
                <DropdownMenuItem
                  key={recipe.id}
                  onClick={() => onInsertRecipe(recipe)}
                  className="gap-2"
                >
                  <BookMarked className="size-3.5 text-muted-foreground" />
                  <span className="flex min-w-0 flex-col gap-0">
                    <span className="truncate text-xs font-medium leading-4">
                      {recipe.name}
                    </span>
                    <span className="truncate text-[11px] leading-4 text-muted-foreground">
                      {recipe.description ||
                        `${recipe.blocks.length} ${recipe.blocks.length === 1 ? "block" : "blocks"}`}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
              {onManageRecipes && (
                <DropdownMenuItem onClick={onManageRecipes} className="gap-2">
                  <Settings2 className="size-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Manage recipes…</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Notion-style hover inserter between cells */
function CellInserter({
  onAdd,
  recipes,
  onInsertRecipe,
}: {
  onAdd: (type: BlockType) => void;
  recipes?: Recipe[];
  onInsertRecipe?: (recipe: Recipe) => void;
}) {
  return (
    <div className="group/ins relative -my-1 flex h-4 items-center px-11">
      <div className="h-px w-full bg-transparent transition-colors group-hover/ins:bg-border" />
      <div className="absolute left-1/2 -translate-x-1/2">
        <AddBlockMenu
          align="center"
          onAdd={onAdd}
          recipes={recipes}
          onInsertRecipe={onInsertRecipe}
          trigger={
            <Button
              variant="outline"
              size="icon-xs"
              aria-label="Insert block here"
              className="rounded-full opacity-0 shadow-sm transition-opacity group-hover/ins:opacity-100 aria-expanded:opacity-100"
            />
          }
        />
      </div>
    </div>
  );
}

export function NotebookEditor({
  notebookId,
  project,
  contracts,
}: {
  notebookId: string;
  project: Project;
  contracts: ContractEntry[];
}) {
  const wagmiConfig = useConfig();
  const { address: account } = useAccount();
  const queryClient = useQueryClient();
  const router = useRouter();

  const blocks = useNotebookStore((s) => s.blocks);
  const readOnly = useNotebookStore((s) => s.readOnly);
  const setReadOnly = useNotebookStore((s) => s.setReadOnly);
  const editing = useNotebookStore((s) => s.editing);
  const showDetails = useNotebookStore((s) => s.showDetails);
  const toggleShowDetails = useNotebookStore((s) => s.toggleShowDetails);
  const setAllEditing = useNotebookStore((s) => s.setAllEditing);
  const dirty = useNotebookStore((s) => s.dirty);
  const initialize = useNotebookStore((s) => s.initialize);
  const addBlock = useNotebookStore((s) => s.addBlock);
  const insertBlockAt = useNotebookStore((s) => s.insertBlockAt);
  const insertBlocksAt = useNotebookStore((s) => s.insertBlocksAt);
  const addBlockToGroup = useNotebookStore((s) => s.addBlockToGroup);
  const updateBlockConfig = useNotebookStore((s) => s.updateBlockConfig);
  const setEditing = useNotebookStore((s) => s.setEditing);
  const removeBlock = useNotebookStore((s) => s.removeBlock);
  const moveBlockTo = useNotebookStore((s) => s.moveBlockTo);
  const setResult = useNotebookStore((s) => s.setResult);
  const setScopeVariable = useNotebookStore((s) => s.setScopeVariable);
  const beginRunAll = useNotebookStore((s) => s.beginRunAll);
  const resetRun = useNotebookStore((s) => s.resetRun);
  const markSaved = useNotebookStore((s) => s.markSaved);
  const hydrateRunState = useNotebookStore((s) => s.hydrateRunState);
  const runRevision = useNotebookStore((s) => s.runRevision);
  const markRunSaved = useNotebookStore((s) => s.markRunSaved);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNotebookCode, setShowNotebookCode] = useState(false);
  const [running, setRunning] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [simulateAs, setSimulateAs] = useState("");
  const [simulateError, setSimulateError] = useState<string | null>(null);
  const [simulateChecking, setSimulateChecking] = useState(false);
  const [recipeSaveOpen, setRecipeSaveOpen] = useState(false);
  const [recipeAnchorId, setRecipeAnchorId] = useState<string | null>(null);

  const { data: notebook, isLoading } = useQuery({
    queryKey: ["notebook", notebookId],
    queryFn: () => api.notebooks.get(notebookId),
  });

  const { data: recipes = [] } = useQuery({
    queryKey: ["recipes", project.id],
    queryFn: () => api.recipes.list(project.id),
  });

  const initializedFor = useRef<string | null>(null);
  useEffect(() => {
    if (notebook && initializedFor.current !== notebook.id) {
      initializedFor.current = notebook.id;
      initialize(notebook.id, notebook.blocks);
      setTitle(notebook.title);
      setDescription(notebook.description ?? "");
    }
  }, [notebook, initialize]);

  // Jupyter-style persisted outputs: restore saved results/history once,
  // after the notebook itself has been initialized.
  const { data: savedRunState } = useQuery({
    queryKey: ["runState", notebookId],
    queryFn: () => api.notebooks.getRunState(notebookId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!notebook || initializedFor.current !== notebook.id) return;
    if (!savedRunState || hydratedFor.current === notebook.id) return;
    hydratedFor.current = notebook.id;
    if (!savedRunState.state) return;
    try {
      hydrateRunState(
        notebook.id,
        parseBigIntSafe(savedRunState.state) as NotebookRunState,
      );
    } catch {
      // Corrupt or incompatible saved state: start with a clean slate.
    }
  }, [notebook, savedRunState, hydrateRunState]);

  // Viewers get a read-only notebook: no edits, no autosave — running still
  // works. Gated on the project's effective role (workspace role or grant).
  useEffect(() => {
    setReadOnly(project.role === "viewer");
  }, [project.role, setReadOnly]);

  const saveMeta = useMutation({
    mutationFn: () => api.notebooks.update(notebookId, { title, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notebooks", project.id] });
      queryClient.invalidateQueries({ queryKey: ["notebook", notebookId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publicClient = useMemo<PublicClient>(
    () =>
      createPublicClient({
        chain: chainForProject(project),
        transport: http(project.rpcUrl),
      }) as PublicClient,
    [project],
  );

  // Debounced autosave whenever blocks change.
  useEffect(() => {
    if (!dirty || !notebook || readOnly) return;
    const timer = setTimeout(async () => {
      try {
        await api.notebooks.saveBlocks(notebookId, useNotebookStore.getState().blocks);
        markSaved();
      } catch (e) {
        toast.error(`Autosave failed: ${shortError(e)}`);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [blocks, dirty, notebook, notebookId, markSaved, readOnly]);

  // Debounced autosave of run output (results/history/counter) after runs.
  // Viewers run session-only; their results are never persisted.
  useEffect(() => {
    if (!notebook || readOnly || hydratedFor.current !== notebook.id) return;
    if (!useNotebookStore.getState().runDirty) return;
    const timer = setTimeout(async () => {
      const s = useNotebookStore.getState();
      const revision = s.runRevision;
      try {
        await api.notebooks.saveRunState(
          notebookId,
          stringifyBigIntSafe({
            execCounter: s.execCounter,
            results: s.results,
            history: s.history,
          } satisfies NotebookRunState),
        );
        markRunSaved(revision);
      } catch (e) {
        toast.error(`Saving run outputs failed: ${shortError(e)}`);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [runRevision, notebook, notebookId, readOnly, markRunSaved]);

  /**
   * Resolve the sender group (if any) a block belongs to. `list` defaults to
   * the notebook's blocks; recipe runs pass the recipe's own block list.
   */
  const senderScopeFor = useCallback(
    (
      block: NotebookBlock,
      list?: NotebookBlock[],
    ): { address: `0x${string}`; simulateOnly: boolean } | null => {
      if (!block.parentId) return null;
      const all = list ?? useNotebookStore.getState().blocks;
      const parent = all.find((b) => b.id === block.parentId);
      if (!parent || parent.type !== "sender") return null;
      const cfg = parent.config as SenderConfig;
      const resolved = String(interpolate(cfg.address, useNotebookStore.getState().scope));
      if (!isAddress(resolved)) {
        throw new Error(`Sender group has an invalid address: "${cfg.address}"`);
      }
      return { address: resolved, simulateOnly: cfg.simulateOnly !== false };
    },
    [],
  );

  /**
   * Execute one read/write/rpc block against the shared notebook scope and
   * return its result — no store writes except output variables, so recipe
   * steps (which have no cell of their own) can reuse it.
   */
  const executeBlock = useCallback(
    async (
      block: NotebookBlock,
      opts?: { mode?: "execute" | "simulate"; sender?: `0x${string}` },
      context?: {
        /** Block list used to resolve the block's sender group. */
        list?: NotebookBlock[];
        /** Fallback sender scope (e.g. the recipe cell's own group). */
        outerSender?: { address: `0x${string}`; simulateOnly: boolean } | null;
      },
    ): Promise<BlockResult> => {
      const started = performance.now();
      try {
        let mode = opts?.mode ?? "execute";
        let sender = opts?.sender;
        let impersonate = false;

        // A block inside a sender group inherits its caller.
        const scope =
          senderScopeFor(block, context?.list) ?? context?.outerSender ?? null;
        if (scope) {
          sender = scope.address;
          if (mode === "execute" && !scope.simulateOnly) impersonate = true;
          if (mode === "execute" && scope.simulateOnly && block.type === "write") {
            // Group is simulate-only: a real run can't honor the override, so simulate.
            mode = "simulate";
          }
        }

        const outcome = await runBlock(block, {
          publicClient,
          contracts,
          scope: useNotebookStore.getState().scope,
          wagmiConfig,
          account,
          mode,
          sender,
          impersonate,
        });
        if (block.outputVariable) setScopeVariable(block.outputVariable, outcome.value);
        return {
          status: "success",
          value: outcome.value,
          txHash: outcome.txHash,
          simulated: outcome.simulated,
          kind: outcome.kind,
          sender: outcome.sender,
          blockNumber: outcome.blockNumber,
          details: outcome.details,
          txDetails: outcome.txDetails,
          durationMs: Math.round(performance.now() - started),
          ranAt: Date.now(),
        };
      } catch (e) {
        return {
          status: "error",
          error: shortError(e),
          durationMs: Math.round(performance.now() - started),
          ranAt: Date.now(),
        };
      }
    },
    [publicClient, contracts, wagmiConfig, account, setScopeVariable, senderScopeFor],
  );

  const runCallBlock = useCallback(
    async (
      block: NotebookBlock,
      opts?: { mode?: "execute" | "simulate"; sender?: `0x${string}` },
    ): Promise<boolean> => {
      if (block.type !== "read" && block.type !== "write" && block.type !== "rpc")
        return true;
      setResult(block.id, { status: "running" });
      const result = await executeBlock(block, opts);
      setResult(block.id, result);
      return result.status === "success";
    },
    [executeBlock, setResult],
  );

  /**
   * Run a recipe cell: every step of the referenced recipe executes in order
   * against the notebook scope. Step-level semantics mirror Run all — sender
   * groups scope their children, `if` groups and "run when" guards skip, the
   * first error stops. The cell's result summarizes all steps.
   */
  const runRecipeBlock = useCallback(
    async (
      block: NotebookBlock,
      opts?: { mode?: "execute" | "simulate"; sender?: `0x${string}` },
    ): Promise<boolean> => {
      const started = performance.now();
      const fail = (error: string) => {
        setResult(block.id, {
          status: "error",
          error,
          durationMs: Math.round(performance.now() - started),
          ranAt: Date.now(),
        });
        return false;
      };

      const recipeId = (block.config as RecipeBlockConfig).recipeId;
      if (!recipeId) return fail("Select a recipe for this block");
      const recipe = recipes.find((r) => r.id === recipeId);
      if (!recipe) return fail("Recipe not found — it may have been deleted");

      setResult(block.id, { status: "running" });

      // The recipe cell's own sender group applies to steps that don't sit in
      // a sender group of their own inside the recipe.
      let outerSender: { address: `0x${string}`; simulateOnly: boolean } | null;
      try {
        outerSender = senderScopeFor(block);
      } catch (e) {
        return fail(shortError(e));
      }

      const steps = executionOrder(recipe.blocks);
      const rows: Record<string, unknown> = {};
      /** Steps to pass over, with the row text explaining why. */
      const skip = new Map<string, string>();
      let ran = 0;
      let skipped = 0;
      let error: string | null = null;

      for (const [index, step] of steps.entries()) {
        const label = `${index + 1}. ${blockLabel(step, contracts)}`;
        const skipReason = skip.get(step.id);
        if (skipReason) {
          rows[label] = skipReason;
          skipped++;
          continue;
        }
        if (step.type === "variable") {
          const { name, value } = step.config as VariableConfig;
          if (name) {
            setScopeVariable(name, value);
            rows[label] = value;
          }
          continue;
        }
        if (step.type === "markdown" || step.type === "sender") continue;
        if (step.type === "if") {
          // Same leniency as Run all: a half-built condition group skips
          // itself and its children instead of failing the recipe.
          if (!isBlockConfigured(step)) {
            rows[label] = "skipped — condition not set";
            skipped++;
            for (const child of recipe.blocks.filter((b) => b.parentId === step.id)) {
              skip.set(child.id, "skipped — condition group not configured");
            }
            continue;
          }
          try {
            const verdict = evaluateCondition(
              (step.config as IfConfig).condition ?? "",
              useNotebookStore.getState().scope,
            );
            rows[label] = verdict.resolved;
            if (!verdict.result) {
              for (const child of recipe.blocks.filter((b) => b.parentId === step.id)) {
                skip.set(child.id, "skipped — condition was false");
              }
            }
          } catch (e) {
            error = shortError(e);
            rows[label] = `error: ${error}`;
            break;
          }
          continue;
        }
        if (step.type !== "read" && step.type !== "write" && step.type !== "rpc") {
          continue;
        }
        if (!isBlockConfigured(step)) {
          rows[label] = "skipped — step not configured";
          skipped++;
          continue;
        }
        if (step.runWhen?.trim()) {
          try {
            const verdict = evaluateCondition(
              step.runWhen,
              useNotebookStore.getState().scope,
            );
            if (!verdict.result) {
              rows[label] = `skipped — run when: ${verdict.resolved}`;
              skipped++;
              continue;
            }
          } catch (e) {
            error = `run when: ${shortError(e)}`;
            rows[label] = `error: ${error}`;
            break;
          }
        }
        const result = await executeBlock(step, opts, {
          list: recipe.blocks,
          outerSender,
        });
        if (result.status === "error") {
          error = result.error ?? "step failed";
          rows[label] = `error: ${error}`;
          break;
        }
        // Writes return the whole receipt; keep the step row compact.
        rows[label] = result.txHash ? `tx ${result.txHash}` : result.value;
        ran++;
      }

      const durationMs = Math.round(performance.now() - started);
      if (error) {
        setResult(block.id, {
          status: "error",
          error,
          kind: `Recipe "${recipe.name}"`,
          details: rows,
          durationMs,
          ranAt: Date.now(),
        });
        return false;
      }
      setResult(block.id, {
        status: "success",
        value: `${ran} ${ran === 1 ? "step" : "steps"} ran${skipped ? `, ${skipped} skipped` : ""}`,
        kind: `Recipe "${recipe.name}"`,
        details: rows,
        durationMs,
        ranAt: Date.now(),
      });
      return true;
    },
    [recipes, contracts, executeBlock, senderScopeFor, setResult, setScopeVariable],
  );

  /**
   * Evaluate a condition group against the current scope, recording the
   * outcome as the block's result. Returns the verdict, or null on error
   * (bad syntax / unresolved variable) — errors stop a run like any block.
   */
  const evaluateIfBlock = useCallback(
    (block: NotebookBlock): boolean | null => {
      const condition = (block.config as IfConfig).condition ?? "";
      const started = performance.now();
      try {
        const { result, resolved } = evaluateCondition(
          condition,
          useNotebookStore.getState().scope,
        );
        setResult(block.id, {
          status: "success",
          value: result,
          kind: "Condition check",
          details: { Condition: condition, Evaluation: resolved },
          durationMs: Math.round(performance.now() - started),
          ranAt: Date.now(),
        });
        return result;
      } catch (e) {
        setResult(block.id, {
          status: "error",
          error: shortError(e),
          durationMs: Math.round(performance.now() - started),
          ranAt: Date.now(),
        });
        return null;
      }
    },
    [setResult],
  );

  /**
   * Per-block "run when" guard, checked in batch runs (Run all / condition
   * groups). Returns false when the block was skipped, null on error;
   * direct manual runs bypass it (explicit user intent).
   */
  const checkRunWhen = useCallback(
    (block: NotebookBlock): boolean | null => {
      const condition = block.runWhen?.trim();
      if (!condition) return true;
      try {
        const { result, resolved } = evaluateCondition(
          condition,
          useNotebookStore.getState().scope,
        );
        if (!result) {
          setResult(block.id, {
            status: "skipped",
            kind: `Skipped — run when: ${resolved}`,
            ranAt: Date.now(),
          });
        }
        return result;
      } catch (e) {
        setResult(block.id, {
          status: "error",
          error: `run when: ${shortError(e)}`,
          ranAt: Date.now(),
        });
        return null;
      }
    },
    [setResult],
  );

  /**
   * Batch runs skip half-built cells instead of aborting on them (running a
   * cell directly still surfaces the real "configure me" error).
   */
  const skipUnconfigured = useCallback(
    (block: NotebookBlock): boolean => {
      if (isBlockConfigured(block)) return false;
      setResult(block.id, {
        status: "skipped",
        kind: "Skipped — configure this cell first",
        ranAt: Date.now(),
      });
      return true;
    },
    [setResult],
  );

  /** Mark a condition group's runnable children as skipped (not an error). */
  const markChildrenSkipped = useCallback(
    (parentId: string, reason = "Skipped — condition was false") => {
      const children = useNotebookStore
        .getState()
        .blocks.filter(
          (b) =>
            b.parentId === parentId &&
            (b.type === "read" ||
              b.type === "write" ||
              b.type === "rpc" ||
              b.type === "recipe"),
        );
      for (const child of children) {
        setResult(child.id, {
          status: "skipped",
          kind: reason,
          ranAt: Date.now(),
        });
      }
    },
    [setResult],
  );

  /** Run one cell: condition groups evaluate and then run their children. */
  const runOne = useCallback(
    async (
      block: NotebookBlock,
      opts?: { mode?: "execute" | "simulate"; sender?: `0x${string}` },
    ): Promise<boolean> => {
      if (block.type === "recipe") return runRecipeBlock(block, opts);
      if (block.type !== "if") return runCallBlock(block, opts);
      const verdict = evaluateIfBlock(block);
      if (verdict === null) return false;
      if (!verdict) {
        markChildrenSkipped(block.id);
        return true;
      }
      const children = useNotebookStore
        .getState()
        .blocks.filter((b) => b.parentId === block.id);
      for (const child of children) {
        if (skipUnconfigured(child)) continue;
        const gate = checkRunWhen(child);
        if (gate === null) return false;
        if (!gate) continue;
        const ok =
          child.type === "recipe"
            ? await runRecipeBlock(child, opts)
            : await runCallBlock(child, opts);
        if (!ok) return false;
      }
      return true;
    },
    [
      runCallBlock,
      runRecipeBlock,
      evaluateIfBlock,
      markChildrenSkipped,
      checkRunWhen,
      skipUnconfigured,
    ],
  );

  /** Simulate a single block as a chosen caller (writes are eth_call'd). */
  const simulateOne = useCallback(
    (block: NotebookBlock) => {
      let sender = account as `0x${string}` | undefined;
      try {
        const scope = senderScopeFor(block);
        if (scope) sender = scope.address;
      } catch (e) {
        toast.error(shortError(e));
        return;
      }
      if (!sender) {
        toast.error("Put this block in a sender group or connect a wallet to simulate");
        return;
      }
      runOne(block, { mode: "simulate", sender });
    },
    [account, senderScopeFor, runOne],
  );

  /** Runs every block in execution order. With `simulateAs`, writes are
   *  eth_call'd (no wallet, nothing sent); sender groups override the caller.
   *  Condition groups gate their children: false skips them, errors stop. */
  const runAllWith = useCallback(
    async (simulateAs?: `0x${string}`) => {
      setRunning(true);
      // Jupyter-style: outputs restart, the exec counter and history continue.
      beginRunAll();
      const all = useNotebookStore.getState().blocks;
      const opts = simulateAs
        ? ({ mode: "simulate", sender: simulateAs } as const)
        : undefined;
      const skipped = new Set<string>();
      let failed = false;
      for (const block of executionOrder(all)) {
        if (skipped.has(block.id)) continue;
        if (block.type === "if") {
          if (skipUnconfigured(block)) {
            for (const child of all.filter((b) => b.parentId === block.id)) {
              skipped.add(child.id);
            }
            markChildrenSkipped(block.id, "Skipped — configure the condition group first");
            continue;
          }
          const verdict = evaluateIfBlock(block);
          if (verdict === null) {
            failed = true;
            break;
          }
          if (!verdict) {
            for (const child of all.filter((b) => b.parentId === block.id)) {
              skipped.add(child.id);
            }
            markChildrenSkipped(block.id);
          }
          continue;
        }
        if (block.type === "recipe") {
          if (skipUnconfigured(block)) continue;
          const ok = await runRecipeBlock(block, opts);
          if (!ok) {
            failed = true;
            break;
          }
          continue;
        }
        if (block.type !== "read" && block.type !== "write" && block.type !== "rpc")
          continue;
        if (skipUnconfigured(block)) continue;
        const gate = checkRunWhen(block);
        if (gate === null) {
          failed = true;
          break;
        }
        if (!gate) continue;
        const ok = await runCallBlock(block, opts);
        if (!ok) {
          failed = true;
          break;
        }
      }
      if (failed) toast.error("Run stopped: a block failed");
      setRunning(false);
    },
    [
      beginRunAll,
      runCallBlock,
      runRecipeBlock,
      evaluateIfBlock,
      markChildrenSkipped,
      checkRunWhen,
      skipUnconfigured,
    ],
  );

  const runAll = useCallback(() => runAllWith(), [runAllWith]);

  /** Validate a caller is a well-formed EOA before kicking off a simulate run. */
  const startSimulateAll = useCallback(async () => {
    if (!isAddress(simulateAs)) {
      setSimulateError("Enter a valid 0x address");
      return;
    }
    setSimulateChecking(true);
    setSimulateError(null);
    try {
      const code = await publicClient.getCode({ address: simulateAs as `0x${string}` });
      if (code && code !== "0x") {
        setSimulateError("That address is a contract. Use an externally-owned account (EOA).");
        return;
      }
      setSimulateOpen(false);
      runAllWith(simulateAs as `0x${string}`);
    } catch (e) {
      setSimulateError(shortError(e));
    } finally {
      setSimulateChecking(false);
    }
  }, [simulateAs, publicClient, runAllWith]);

  // Jupyter-style keyboard shortcuts on the selected block.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) {
        // Cmd/Ctrl+Enter runs the selected block even while typing in it
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && selectedId) {
          const block = useNotebookStore.getState().blocks.find((b) => b.id === selectedId);
          if (block) {
            e.preventDefault();
            runOne(block);
          }
        }
        return;
      }
      const state = useNotebookStore.getState();
      const selected = state.blocks.find((b) => b.id === selectedId);
      if ((e.key === "b" || e.key === "B") && !state.readOnly) {
        e.preventDefault();
        setSelectedId(addBlock("read", selected?.id));
      } else if ((e.key === "m" || e.key === "M") && !state.readOnly) {
        e.preventDefault();
        setSelectedId(addBlock("markdown", selected?.id));
      } else if (e.key === "Enter" && e.shiftKey && selected) {
        e.preventDefault();
        runOne(selected).then(() => {
          const list = useNotebookStore.getState().blocks;
          const index = list.findIndex((b) => b.id === selected.id);
          if (index >= 0 && index < list.length - 1) setSelectedId(list[index + 1].id);
        });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, addBlock, runOne]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const all = useNotebookStore.getState().blocks;
    const overBlock = all.find((b) => b.id === over.id);
    if (!overBlock) return;
    if (isGroupType(overBlock.type)) {
      // Drop onto a group header → become its first child
      const firstChild = all.find((b) => b.parentId === overBlock.id);
      moveBlockTo(String(active.id), overBlock.id, firstChild?.id ?? null);
    } else {
      moveBlockTo(String(active.id), overBlock.parentId ?? null, String(over.id));
    }
  }

  function handleInsert(type: BlockType, index: number) {
    const id = insertBlockAt(type, index);
    setSelectedId(id);
    scrollToBlock(id);
  }

  /** Insert a linked recipe cell that reruns the recipe's steps. */
  function handleInsertRecipeBlock(recipe: Recipe, index: number) {
    const id = insertBlockAt("recipe", index);
    if (!id) return;
    updateBlockConfig(id, { recipeId: recipe.id });
    setEditing(id, false);
    setSelectedId(id);
    scrollToBlock(id);
  }

  /** Paste an editable copy of a recipe's blocks at `index` (or into a group). */
  function handlePasteRecipe(recipe: Recipe, index: number, parentId?: string) {
    const ids = insertBlocksAt(recipe.blocks, index, parentId ?? null);
    if (ids.length === 0) return;
    setSelectedId(ids[0]);
    scrollToBlock(ids[0]);
    toast.success(
      `Inserted "${recipe.name}" (${ids.length} ${ids.length === 1 ? "block" : "blocks"})`,
    );
  }

  /** Swap a linked recipe cell for an editable copy of its blocks. */
  function detachRecipeBlock(block: NotebookBlock) {
    const recipeId = (block.config as RecipeBlockConfig).recipeId;
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    const all = useNotebookStore.getState().blocks;
    const index = all.findIndex((b) => b.id === block.id);
    const ids = insertBlocksAt(recipe.blocks, index, block.parentId ?? null);
    removeBlock(block.id);
    if (ids.length > 0) setSelectedId(ids[0]);
    toast.success(
      `Detached "${recipe.name}" into ${ids.length} editable ${ids.length === 1 ? "block" : "blocks"}`,
    );
  }

  function openSaveRecipe(anchorId: string | null) {
    setRecipeAnchorId(anchorId);
    setRecipeSaveOpen(true);
  }

  /** Recipes containing a group can't be pasted inside another group. */
  const groupSafeRecipes = recipes.filter((r) =>
    r.blocks.every((b) => !isGroupType(b.type)),
  );

  if (isLoading || !notebook) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const isRunnableType = (t: BlockType) => t === "read" || t === "write" || t === "rpc";
  const isExecutableType = (t: BlockType) =>
    isRunnableType(t) || t === "if" || t === "recipe";
  const runnableBlocks = blocks.filter((b) => isExecutableType(b.type));
  const runnableCount = runnableBlocks.length;
  const allExpanded =
    runnableCount > 0 && runnableBlocks.every((b) => editing[b.id]);
  const selectedBlock = blocks.find((b) => b.id === selectedId);
  const canRunSelected = !!selectedBlock && isExecutableType(selectedBlock.type);
  const topLevelBlocks = blocks.filter((b) => !b.parentId);

  function renderBlockBody(block: NotebookBlock, isEditing: boolean) {
    if (block.type === "markdown") {
      return (
        <MarkdownBlock
          config={block.config as MarkdownConfig}
          editing={isEditing}
          onChange={(c) => updateBlockConfig(block.id, c)}
        />
      );
    }
    if (block.type === "sender") {
      return (
        <SenderBlock
          config={block.config as SenderConfig}
          editing={isEditing}
          onChange={(c) => updateBlockConfig(block.id, c)}
        />
      );
    }
    if (block.type === "variable") {
      return (
        <VariableBlock
          config={block.config as VariableConfig}
          editing={isEditing}
          onChange={(c) => updateBlockConfig(block.id, c)}
        />
      );
    }
    if (block.type === "if") {
      return (
        <IfBlock
          config={block.config as IfConfig}
          editing={isEditing}
          onChange={(c) => updateBlockConfig(block.id, c)}
        />
      );
    }
    if (block.type === "recipe") {
      return (
        <RecipeBlock
          config={block.config as RecipeBlockConfig}
          editing={isEditing}
          recipes={recipes}
          contracts={contracts}
          onChange={(c) => updateBlockConfig(block.id, c)}
          onDetach={readOnly ? undefined : () => detachRecipeBlock(block)}
        />
      );
    }
    if (!isEditing) return <BlockSummary block={block} contracts={contracts} />;
    if (block.type === "rpc") {
      return (
        <RpcBlock
          config={block.config as RpcConfig}
          onChange={(c) => updateBlockConfig(block.id, c)}
        />
      );
    }
    return (
      <CallBlock
        type={block.type}
        config={block.config as CallConfig}
        contracts={contracts}
        onChange={(c) => updateBlockConfig(block.id, c)}
      />
    );
  }

  function renderBlock(block: NotebookBlock): React.ReactNode {
    const isGroup = isGroupType(block.type);
    const childBlocks = isGroup
      ? blocks.filter((b) => b.parentId === block.id)
      : [];
    return (
      <BlockShell
        key={block.id}
        block={block}
        project={project}
        contracts={contracts}
        selected={selectedId === block.id}
        onSelect={() => setSelectedId(block.id)}
        onRun={() => runOne(block)}
        onSimulate={isRunnableType(block.type) ? () => simulateOne(block) : undefined}
        onSaveAsRecipe={
          // Recipe cells can't be nested into recipes — no bookmark for them.
          readOnly || block.type === "recipe"
            ? undefined
            : () => openSaveRecipe(block.id)
        }
        groupChildren={
          isGroup ? (
            <div className="grid gap-2">
              {childBlocks.map((child) => renderBlock(child))}
              {!readOnly && (
                <AddBlockMenu
                  onAdd={(type) => {
                    const id = addBlockToGroup(type, block.id);
                    setSelectedId(id);
                    scrollToBlock(id);
                  }}
                  recipes={groupSafeRecipes}
                  recipesLabel="Paste recipe blocks"
                  onInsertRecipe={(recipe) =>
                    handlePasteRecipe(recipe, blocks.length, block.id)
                  }
                  trigger={
                    <Button
                      variant="ghost"
                      size="xs"
                      className="w-fit text-muted-foreground"
                    >
                      <Plus data-icon="inline-start" />
                      Add to group
                    </Button>
                  }
                />
              )}
              {childBlocks.length === 0 && !readOnly && (
                <p className="text-xs text-muted-foreground/50">
                  Empty group — drag blocks here or use &ldquo;Add to group&rdquo;.
                </p>
              )}
            </div>
          ) : undefined
        }
      >
        {(isEditing) => renderBlockBody(block, isEditing)}
      </BlockShell>
    );
  }

  function copySource() {
    const code = generateNotebookCode(
      useNotebookStore.getState().blocks,
      contracts,
      project,
      "wagmi",
    );
    navigator.clipboard.writeText(code);
    toast.success("Copied notebook source (wagmi flavor)");
  }

  function exportNotebook() {
    const manifest = {
      title,
      description,
      chain: { id: project.chainId, rpcUrl: project.rpcUrl },
      blocks: useNotebookStore.getState().blocks.map((b) => ({
        id: b.id,
        type: b.type,
        config: b.config,
        outputVariable: b.outputVariable,
        // Group membership (sender/condition groups) — ids make it resolvable.
        parentId: b.parentId ?? null,
        runWhen: b.runWhen ?? null,
      })),
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "notebook"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Document header: inline-editable title + description (Notion-style) */}
      <div className="group/meta relative mb-4 px-11">
        {!readOnly && (
          <Pencil className="pointer-events-none absolute top-2 right-2 size-3.5 text-muted-foreground/0 transition-colors group-hover/meta:text-muted-foreground/50" />
        )}
        <input
          value={title}
          readOnly={readOnly}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (readOnly) return;
            if (title.trim() && title !== notebook.title) saveMeta.mutate();
            else if (!title.trim()) setTitle(notebook.title);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="Untitled notebook"
          aria-label="Notebook title"
          title={readOnly ? undefined : "Click to edit the title"}
          className={cn(
            "-mx-1.5 w-full rounded-md bg-transparent px-1.5 text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/40",
            !readOnly && "cursor-text hover:bg-muted/30 focus:bg-muted/20",
          )}
        />
        <input
          value={description}
          readOnly={readOnly}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (readOnly) return;
            if (description !== (notebook.description ?? "")) saveMeta.mutate();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder={readOnly ? "" : "Add a description…"}
          aria-label="Notebook description"
          title={readOnly ? undefined : "Click to edit the description"}
          className={cn(
            "mt-1 -mx-1.5 w-full rounded-md bg-transparent px-1.5 py-0.5 text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/40",
            !readOnly && "cursor-text hover:bg-muted/30 focus:bg-muted/20",
          )}
        />
      </div>

      {/* Sticky compact toolbar (Jupyter-style) */}
      <div className="sticky top-2 z-30 mb-5 flex items-center gap-0.5 rounded-xl border bg-background/95 p-1 shadow-sm backdrop-blur">
        <Button
          size="sm"
          onClick={runAll}
          disabled={running || runnableCount === 0}
          title="Run all blocks top to bottom"
        >
          <Play data-icon="inline-start" />
          Run all
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!simulateAs && account) setSimulateAs(account);
            setSimulateOpen(true);
          }}
          disabled={running || runnableCount === 0}
          title="Dry-run everything as a chosen caller — writes are simulated, nothing is sent"
        >
          <FlaskConical data-icon="inline-start" />
          Simulate all
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => selectedBlock && runOne(selectedBlock)}
          disabled={!canRunSelected}
          aria-label="Run selected block"
          title="Run selected block (Shift+Enter)"
        >
          <StepForward />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            resetRun();
            toast.success(
              readOnly
                ? "Cleared this session's results"
                : "Cleared results, history and execution counter",
            );
          }}
          disabled={runnableCount === 0}
          aria-label="Reset state"
          title="Reset: clear results, run history, variables and the execution counter (like Jupyter's restart & clear output)"
        >
          <ListRestart />
        </Button>

        <div className="mx-1 h-5 w-px bg-border" />

        {!readOnly && (
          <AddBlockMenu
            onAdd={(type) => handleInsert(type, blocks.length)}
            recipes={recipes}
            onInsertRecipe={(recipe) => handleInsertRecipeBlock(recipe, blocks.length)}
            onManageRecipes={() => router.push(`/p/${project.id}/recipes`)}
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Add block"
                title="Add block at the end"
              />
            }
          />
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setAllEditing(!allExpanded)}
          disabled={blocks.length === 0}
          aria-label={allExpanded ? "Collapse all blocks" : "Expand all blocks"}
          title={
            allExpanded
              ? "Collapse all blocks to summaries"
              : "Expand all blocks to their editable form"
          }
        >
          {allExpanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleShowDetails}
          className={cn(showDetails && "bg-muted text-foreground")}
          aria-label="Toggle transaction details"
          title="Show sender and call/tx details on every result"
        >
          <Info />
        </Button>

        <div className="mx-1 h-5 w-px bg-border" />

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setShowNotebookCode((v) => !v)}
          className={cn(showNotebookCode && "bg-muted text-foreground")}
          aria-label="Toggle notebook source"
          title="Show the full integration source"
        >
          <Code2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={copySource}
          disabled={runnableCount === 0}
          aria-label="Copy source"
          title="Copy the full wagmi source to clipboard"
        >
          <Copy />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={exportNotebook}
          disabled={blocks.length === 0}
          aria-label="Export notebook"
          title="Export notebook as a JSON call manifest"
        >
          <Download />
        </Button>
        {!readOnly && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => openSaveRecipe(selectedId)}
            disabled={blocks.length === 0}
            aria-label="Save as recipe"
            title="Save blocks as a reusable recipe for this project"
          >
            <BookmarkPlus />
          </Button>
        )}

        <span className="ml-auto flex items-center gap-2 pr-2 text-xs text-muted-foreground/60">
          <span>
            {blocks.length} {blocks.length === 1 ? "block" : "blocks"}
          </span>
          {readOnly ? (
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-sky-400/70" />
              read-only
            </span>
          ) : (
            <span
              className={cn(
                "flex items-center gap-1.5",
                dirty ? "text-amber-400" : undefined,
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  dirty ? "animate-pulse bg-amber-400" : "bg-emerald-500/70",
                )}
              />
              {dirty ? "saving" : "saved"}
            </span>
          )}
        </span>
      </div>

      <Dialog open={simulateOpen} onOpenChange={setSimulateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Simulate all as</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="sim-addr">Caller address (EOA)</Label>
            <Input
              id="sim-addr"
              className="font-mono"
              placeholder="0x…"
              value={simulateAs}
              aria-invalid={!!simulateError}
              onChange={(e) => {
                setSimulateAs(e.target.value);
                setSimulateError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") startSimulateAll();
              }}
            />
            {simulateError ? (
              <p className="text-xs text-destructive">{simulateError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Reads and RPC calls run normally; writes are simulated via{" "}
                <code className="rounded bg-muted px-1 font-mono">eth_call</code>{" "}
                as this address — no wallet needed, nothing is sent on-chain.
                Sender groups override the caller for their blocks.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={!isAddress(simulateAs) || simulateChecking}
              onClick={startSimulateAll}
            >
              <FlaskConical data-icon="inline-start" />
              {simulateChecking ? "Checking…" : "Simulate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SaveRecipeDialog
        open={recipeSaveOpen}
        onOpenChange={setRecipeSaveOpen}
        projectId={project.id}
        contracts={contracts}
        initialSelectedId={recipeAnchorId}
      />

      {showNotebookCode && (
        <div className="mb-6 rounded-xl border p-4">
          <p className="mb-2 text-sm font-medium">Full notebook source</p>
          <CodePanel
            generate={(flavor: CodeFlavor) =>
              generateNotebookCode(
                useNotebookStore.getState().blocks,
                contracts,
                project,
                flavor,
              )
            }
          />
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <div>
            {topLevelBlocks.map((block, index) => (
              <div key={block.id}>
                {!readOnly && (
                  <CellInserter
                    onAdd={(type) => handleInsert(type, blocks.indexOf(block))}
                    recipes={recipes}
                    onInsertRecipe={(recipe) =>
                      handleInsertRecipeBlock(recipe, blocks.indexOf(block))
                    }
                  />
                )}
                {renderBlock(block)}
                {index === topLevelBlocks.length - 1 && !readOnly && (
                  <CellInserter
                    onAdd={(type) => handleInsert(type, blocks.length)}
                    recipes={recipes}
                    onInsertRecipe={(recipe) =>
                      handleInsertRecipeBlock(recipe, blocks.length)
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {blocks.length === 0 && (
        <div className="mx-11 flex flex-col items-center rounded-xl border border-dashed px-8 py-14 text-center">
          <p className="mb-1 font-medium">Empty notebook</p>
          <p className="mb-5 text-sm text-muted-foreground">
            {readOnly
              ? "Nothing here yet — you have read-only access to this workspace."
              : "Add your first block — read a contract, send a transaction, make an RPC call, or write some notes."}
          </p>
          {!readOnly && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {BLOCK_TYPES.map(({ type, label, icon: Icon }) => (
                <Button
                  key={type}
                  variant="outline"
                  size="sm"
                  onClick={() => handleInsert(type, 0)}
                >
                  <Icon data-icon="inline-start" />
                  {label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground/50">
        {readOnly ? (
          <>
            read-only access · <kbd>Shift+Enter</kbd> run selected block
          </>
        ) : (
          <>
            <kbd>B</kbd> add block below · <kbd>M</kbd> add text ·{" "}
            <kbd>Shift+Enter</kbd> run selected · <kbd>Cmd+Enter</kbd> run while
            editing · double-click a block to edit
          </>
        )}
      </p>
    </div>
  );
}
