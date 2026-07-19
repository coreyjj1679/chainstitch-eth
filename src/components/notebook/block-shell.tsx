"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BookMarked,
  BookmarkPlus,
  Braces,
  Check,
  CircleCheck,
  Code2,
  Copy,
  Eye,
  FlaskConical,
  GitBranch,
  GripVertical,
  Pencil,
  Play,
  Radio,
  ScrollText,
  Trash2,
  UserRound,
  Variable,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { CodePanel } from "@/components/notebook/code-panel";
import { ResultPanel } from "@/components/notebook/result-panel";
import { useNotebookStore } from "@/stores/notebook-store";
import { generateBlockCode, type CodeFlavor } from "@/lib/codegen";
import { isExecutableType, isGroupType, isRunnableType } from "@/lib/block-label";
import { isValidVariableName } from "@/lib/variables";
import type { ContractEntry, NotebookBlock, Project } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const TYPE_META = {
  read: {
    label: "Read",
    icon: Eye,
    badge: "text-sky-400 border-sky-400/30 bg-sky-400/10",
    accent: "bg-sky-400",
  },
  write: {
    label: "Write",
    icon: Pencil,
    badge: "text-amber-400 border-amber-400/30 bg-amber-400/10",
    accent: "bg-amber-400",
  },
  rpc: {
    label: "RPC",
    icon: Radio,
    badge: "text-violet-400 border-violet-400/30 bg-violet-400/10",
    accent: "bg-violet-400",
  },
  event: {
    label: "Events",
    icon: ScrollText,
    badge: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
    accent: "bg-emerald-400",
  },
  markdown: {
    label: "Text",
    icon: Braces,
    badge: "text-muted-foreground border-border bg-muted/50",
    accent: "bg-muted-foreground/60",
  },
  sender: {
    label: "Simulation",
    icon: UserRound,
    badge: "text-teal-400 border-teal-400/30 bg-teal-400/10",
    accent: "bg-teal-400",
  },
  variable: {
    label: "Variable",
    icon: Variable,
    badge: "text-amber-300 border-amber-300/30 bg-amber-300/10",
    accent: "bg-amber-300",
  },
  if: {
    label: "Condition",
    icon: GitBranch,
    badge: "text-fuchsia-400 border-fuchsia-400/30 bg-fuchsia-400/10",
    accent: "bg-fuchsia-400",
  },
  expect: {
    label: "Expect",
    icon: CircleCheck,
    badge: "text-rose-400 border-rose-400/30 bg-rose-400/10",
    accent: "bg-rose-400",
  },
  recipe: {
    label: "Recipe",
    icon: BookMarked,
    badge: "text-cyan-400 border-cyan-400/30 bg-cyan-400/10",
    accent: "bg-cyan-400",
  },
} as const;

/** Jupyter-style `In [n]` gutter */
function ExecGutter({ block }: { block: NotebookBlock }) {
  const result = useNotebookStore((s) => s.results[block.id]);
  if (!isExecutableType(block.type)) return <div className="w-11 shrink-0 pr-4" />;

  let label = "[ ]";
  let className = "text-muted-foreground/40";
  if (result?.status === "running") {
    label = "[*]";
    className = "animate-pulse text-amber-400";
  } else if (result?.status === "skipped") {
    label = "[–]";
    className = "text-muted-foreground/40";
  } else if (result?.execIndex !== undefined) {
    label = `[${result.execIndex}]`;
    className = result.status === "error" ? "text-destructive" : "text-primary";
  }
  return (
    <div
      className={cn(
        "w-11 shrink-0 pt-2 pr-4 text-right font-mono text-xs select-none",
        className,
      )}
      title={result?.status === "error" ? "Last run failed" : undefined}
    >
      {label}
    </div>
  );
}

export function BlockShell({
  block,
  project,
  contracts,
  selected,
  onSelect,
  onRun,
  onSimulate,
  onSaveAsRecipe,
  groupChildren,
  children,
}: {
  block: NotebookBlock;
  project: Project;
  contracts: ContractEntry[];
  selected: boolean;
  onSelect: () => void;
  onRun: () => void;
  onSimulate?: () => void;
  /** Open the "Save as recipe" dialog with this block pre-checked. */
  onSaveAsRecipe?: () => void;
  /** For sender blocks: the nested child cells */
  groupChildren?: React.ReactNode;
  children: (editing: boolean) => React.ReactNode;
}) {
  const [showCode, setShowCode] = useState(false);
  // Edit mode lives in the store so the toolbar can expand/collapse all cells
  const editing = useNotebookStore((s) => s.editing[block.id] ?? false);
  const setEditingById = useNotebookStore((s) => s.setEditing);
  const setEditing = (v: boolean) => setEditingById(block.id, v);
  const result = useNotebookStore((s) => s.results[block.id]);
  const removeBlock = useNotebookStore((s) => s.removeBlock);
  const duplicateBlock = useNotebookStore((s) => s.duplicateBlock);
  const setOutputVariable = useNotebookStore((s) => s.setOutputVariable);
  const setRunWhen = useNotebookStore((s) => s.setRunWhen);
  const readOnly = useNotebookStore((s) => s.readOnly);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });

  // Constants (global) + variables declared by blocks above this one, for the chips
  const availableVariables = useNotebookStore(
    useShallow((s) => {
      const index = s.blocks.findIndex((b) => b.id === block.id);
      const constants = s.blocks
        .filter((b) => b.type === "variable")
        .map((b) => (b.config as { name?: string }).name)
        .filter((v): v is string => !!v);
      const outputs = s.blocks
        .slice(0, Math.max(0, index))
        .map((b) => b.outputVariable)
        .filter((v): v is string => !!v);
      return [...new Set([...constants, ...outputs])];
    }),
  );

  const meta = TYPE_META[block.type];
  const Icon = meta.icon;
  const isRunnable = isRunnableType(block.type);
  // Condition groups and recipe cells run too, but have no codegen or
  // simulate affordances of their own.
  const isExecutable = isExecutableType(block.type);
  const variableInvalid =
    !!block.outputVariable && !isValidVariableName(block.outputVariable);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      id={`block-${block.id}`}
      className={cn(
        "group relative flex scroll-mt-24 rounded-lg border py-2 pr-3 transition-colors",
        // Jupyter-style: code cells sit on a card background, text blends into the page
        isRunnable
          ? selected
            ? "border-border bg-card"
            : "border-border/40 bg-card/40 hover:border-border/70 hover:bg-card/60"
          : block.type === "sender"
            ? selected
              ? "border-teal-400/40 bg-teal-400/5"
              : "border-teal-400/20 bg-teal-400/3 hover:border-teal-400/40"
            : block.type === "if"
              ? selected
                ? "border-fuchsia-400/40 bg-fuchsia-400/5"
                : "border-fuchsia-400/20 bg-fuchsia-400/3 hover:border-fuchsia-400/40"
              : block.type === "recipe"
                ? selected
                  ? "border-cyan-400/40 bg-cyan-400/5"
                  : "border-cyan-400/20 bg-cyan-400/3 hover:border-cyan-400/40"
                : selected
                  ? "border-border/60 bg-muted/20"
                  : "border-transparent hover:border-border/30 hover:bg-muted/10",
        isDragging && "z-50 border-border bg-card opacity-80",
      )}
      onClick={onSelect}
    >
      {/* type accent bar (visible when selected) */}
      <div
        className={cn(
          "absolute inset-y-2 left-0 w-0.5 rounded-full transition-opacity",
          meta.accent,
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-40",
        )}
      />

      <ExecGutter block={block} />

      <div className="min-w-0 flex-1 py-1">
        {editing && (
          <div className="mb-3 grid gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn("gap-1 font-mono text-xs", meta.badge)}>
                <Icon className="size-3" />
                {meta.label}
              </Badge>
              {isRunnable && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">save as</span>
                  <Input
                    className={cn(
                      "h-6 w-36 border-dashed px-1.5 font-mono text-xs",
                      variableInvalid && "border-destructive",
                    )}
                    placeholder="variableName"
                    value={block.outputVariable ?? ""}
                    onChange={(e) => setOutputVariable(block.id, e.target.value || null)}
                  />
                </div>
              )}
              {isRunnable && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">run when</span>
                  <Input
                    className="h-6 w-44 border-dashed px-1.5 font-mono text-xs"
                    placeholder="always"
                    title='Skip this block in batch runs unless the condition holds, e.g. "{{allowance}} < {{amount}}"'
                    value={block.runWhen ?? ""}
                    onChange={(e) => setRunWhen(block.id, e.target.value || null)}
                  />
                </div>
              )}
            </div>
            {availableVariables.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-muted-foreground/70">
                  click to copy, paste into any field:
                </span>
                {availableVariables.map((name) => (
                  <button
                    key={name}
                    className="rounded border border-dashed border-primary/30 bg-primary/5 px-1.5 py-0.5 font-mono text-xs text-primary transition-colors hover:bg-primary/15"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(`{{${name}}}`);
                      toast.success(`Copied {{${name}}}`);
                    }}
                    title={`Copy {{${name}}}`}
                  >
                    {`{{${name}}}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div
          onDoubleClick={() => {
            if (!editing && !readOnly) setEditing(true);
          }}
          title={editing || readOnly ? undefined : "Double-click to edit"}
        >
          {children(editing)}
        </div>

        {variableInvalid && (
          <p className="mt-2 text-xs text-destructive">
            Variable names must be valid identifiers (letters, digits, _, $).
          </p>
        )}
        {isExecutable && result && (
          <ResultPanel blockId={block.id} result={result} project={project} />
        )}
        {isRunnable && showCode && (
          <CodePanel
            generate={(flavor: CodeFlavor) =>
              generateBlockCode(block, contracts, project, flavor)
            }
          />
        )}
        {groupChildren && (
          <div
            className={cn(
              "mt-3 border-l-2 pl-3",
              block.type === "if" ? "border-fuchsia-400/30" : "border-teal-400/30",
            )}
          >
            {groupChildren}
          </div>
        )}
      </div>

      {/* floating cell toolbar (Observable/Deepnote style) */}
      <div
        className={cn(
          "absolute -top-3.5 right-3 z-10 flex items-center gap-0.5 rounded-lg border bg-popover p-0.5 shadow-sm transition-opacity",
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {isExecutable && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onRun}
            disabled={result?.status === "running"}
            aria-label="Run block"
            title={
              block.type === "if"
                ? "Evaluate the condition and run the blocks inside"
                : block.type === "recipe"
                  ? "Run every step of this recipe in order"
                  : "Run block (Shift+Enter)"
            }
          >
            <Play className="text-emerald-500" />
          </Button>
        )}
        {isRunnable && onSimulate && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onSimulate}
            disabled={result?.status === "running"}
            aria-label="Simulate block"
            title="Simulate this block (writes are eth_call'd, nothing sent)"
          >
            <FlaskConical className="text-teal-400" />
          </Button>
        )}
        {!readOnly &&
          (editing ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setEditing(false)}
              aria-label="Done editing"
              title="Done editing"
            >
              <Check className="text-emerald-500" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setEditing(true)}
              aria-label="Edit block"
              title="Edit block"
            >
              <Pencil />
            </Button>
          ))}
        {isRunnable && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setShowCode((v) => !v)}
            aria-label="Toggle source code"
            title="Show integration code"
            className={cn(showCode && "bg-muted text-foreground")}
          >
            <Code2 />
          </Button>
        )}
        {!readOnly && (
          <>
            <div className="mx-0.5 h-4 w-px bg-border" />
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => duplicateBlock(block.id)}
              aria-label="Duplicate block"
              title={
                isGroupType(block.type)
                  ? "Duplicate group and its blocks"
                  : "Duplicate block"
              }
            >
              <Copy className="text-muted-foreground" />
            </Button>
            {onSaveAsRecipe && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onSaveAsRecipe}
                aria-label="Save as recipe"
                title="Save as a reusable recipe (opens the picker with this block checked)"
              >
                <BookmarkPlus className="text-muted-foreground" />
              </Button>
            )}
            <button
              className="flex size-6 cursor-grab items-center justify-center rounded-md text-muted-foreground/60 hover:bg-muted hover:text-foreground active:cursor-grabbing"
              {...attributes}
              {...listeners}
              aria-label="Drag to reorder"
              title="Drag to reorder"
            >
              <GripVertical className="size-3.5" />
            </button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => removeBlock(block.id)}
              aria-label="Delete block"
              title="Delete block"
            >
              <Trash2 className="text-muted-foreground" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
