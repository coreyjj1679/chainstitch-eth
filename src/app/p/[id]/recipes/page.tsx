"use client";

import { use, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, BookMarked, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useContracts, useProject, useRecipes } from "@/lib/hooks";
import { blockLabel, executionOrder, isGroupType } from "@/lib/block-label";
import type { ContractEntry, NotebookBlock, Recipe } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Re-lay a flat block list canonically: each parent followed by its children. */
function canonicalLayout(blocks: NotebookBlock[]): NotebookBlock[] {
  const out: NotebookBlock[] = [];
  for (const block of blocks.filter((b) => !b.parentId)) {
    out.push(block);
    out.push(...blocks.filter((c) => c.parentId === block.id));
  }
  return out;
}

/** Move a step up/down among its siblings (top level, or within its group). */
function moveStep(blocks: NotebookBlock[], id: string, dir: -1 | 1): NotebookBlock[] {
  const block = blocks.find((b) => b.id === id);
  if (!block) return blocks;
  const parentKey = block.parentId ?? null;
  const siblings = blocks.filter((b) => (b.parentId ?? null) === parentKey);
  const from = siblings.findIndex((b) => b.id === id);
  const to = from + dir;
  if (to < 0 || to >= siblings.length) return blocks;
  const reordered = [...siblings];
  [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
  // Splice the new sibling order back into the flat list, then re-lay out.
  const siblingIds = new Set(reordered.map((b) => b.id));
  let cursor = 0;
  const merged = blocks.map((b) => (siblingIds.has(b.id) ? reordered[cursor++] : b));
  return canonicalLayout(merged);
}

/** Remove a step; a group takes its children with it. */
function removeStep(blocks: NotebookBlock[], id: string): NotebookBlock[] {
  const block = blocks.find((b) => b.id === id);
  if (!block) return blocks;
  const drop = new Set([id]);
  if (isGroupType(block.type)) {
    for (const child of blocks) if (child.parentId === id) drop.add(child.id);
  }
  return blocks.filter((b) => !drop.has(b.id));
}

/** Rename, edit description, reorder and remove steps. */
function EditRecipeDialog({
  recipe,
  contracts,
  open,
  onOpenChange,
}: {
  recipe: Recipe;
  contracts: ContractEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(recipe.name);
  const [description, setDescription] = useState(recipe.description ?? "");
  const [steps, setSteps] = useState<NotebookBlock[]>(() =>
    canonicalLayout(recipe.blocks),
  );

  const save = useMutation({
    mutationFn: () =>
      api.recipes.update(recipe.id, {
        name: name.trim(),
        description,
        blocks: steps,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipes", recipe.projectId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ordered = executionOrder(steps);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit recipe</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Description</Label>
            <Input
              placeholder="What this flow does"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Steps</Label>
            <div className="grid max-h-64 gap-0.5 overflow-y-auto rounded-md border p-1.5">
              {ordered.map((step, index) => {
                const parentKey = step.parentId ?? null;
                const siblings = ordered.filter(
                  (b) => (b.parentId ?? null) === parentKey,
                );
                const position = siblings.findIndex((b) => b.id === step.id);
                return (
                  <div
                    key={step.id}
                    className={cn(
                      "group/step flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/50",
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
                      {blockLabel(step, contracts)}
                    </span>
                    <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/step:opacity-100">
                      <button
                        className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                        aria-label="Move step up"
                        title="Move up"
                        disabled={position === 0}
                        onClick={() => setSteps((s) => moveStep(s, step.id, -1))}
                      >
                        <ArrowUp className="size-3" />
                      </button>
                      <button
                        className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                        aria-label="Move step down"
                        title="Move down"
                        disabled={position === siblings.length - 1}
                        onClick={() => setSteps((s) => moveStep(s, step.id, 1))}
                      >
                        <ArrowDown className="size-3" />
                      </button>
                      <button
                        className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-red-400"
                        aria-label="Remove step"
                        title={
                          isGroupType(step.type)
                            ? "Remove group and its steps"
                            : "Remove step"
                        }
                        onClick={() => setSteps((s) => removeStep(s, step.id))}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  </div>
                );
              })}
              {ordered.length === 0 && (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  All steps removed — a recipe needs at least one.
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground/70">
              To change a step&apos;s inputs, paste the recipe into a notebook,
              edit it there, and save it back over this recipe from the
              bookmark dialog.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!name.trim() || steps.length === 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecipeCard({
  recipe,
  contracts,
  canEdit,
}: {
  recipe: Recipe;
  contracts: ContractEntry[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const steps = executionOrder(recipe.blocks);

  const remove = useMutation({
    mutationFn: () => api.recipes.remove(recipe.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipes", recipe.projectId] });
      toast.success(`Deleted recipe "${recipe.name}"`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="gap-0 p-4">
      <div className="flex items-start gap-3">
        <BookMarked className="mt-0.5 size-4 shrink-0 text-cyan-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium" title={recipe.name}>
              {recipe.name}
            </span>
            <Badge variant="outline" className="shrink-0 text-xs">
              {steps.length} {steps.length === 1 ? "block" : "blocks"}
            </Badge>
          </div>
          {recipe.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {recipe.description}
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setEditing(true)}
              aria-label={`Edit recipe ${recipe.name}`}
              title="Edit name, description & steps"
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                if (confirm(`Delete recipe "${recipe.name}"?`)) remove.mutate();
              }}
              aria-label={`Delete recipe ${recipe.name}`}
              title="Delete recipe"
            >
              <Trash2 className="text-muted-foreground" />
            </Button>
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-px border-t pt-2">
        {steps.map((step, index) => (
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
            <span className="min-w-0 truncate font-mono text-foreground/90">
              {blockLabel(step, contracts)}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground/60">
        Updated {new Date(recipe.updatedAt).toLocaleString()}
      </p>

      {editing && (
        <EditRecipeDialog
          recipe={recipe}
          contracts={contracts}
          open={editing}
          onOpenChange={setEditing}
        />
      )}
    </Card>
  );
}

export default function RecipesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: recipes, isLoading } = useRecipes(id);
  const { data: contracts } = useContracts(id);
  const { data: project } = useProject(id);
  // Effective role on this project (workspace role or per-project grant).
  const canEdit = project?.role === "editor" || project?.role === "owner";

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold">Recipes</h2>
        <p className="text-sm text-muted-foreground">
          Reusable multi-step flows saved from your notebooks. Add one to a
          notebook from the add-block menu — as a linked Recipe cell that reruns
          every step, or pasted as editable blocks.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : recipes && recipes.length > 0 ? (
        <div className="grid gap-3">
          {recipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              contracts={contracts ?? []}
              canEdit={canEdit}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-8 py-14 text-center">
          <BookMarked className="mb-2 size-6 text-muted-foreground" />
          <p className="mb-1 font-medium">No recipes yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Open a notebook, click the bookmark icon in the toolbar (or on any
            block), pick the blocks to include, and save them as a recipe. It
            will show up here and in every notebook&apos;s add-block menu.
          </p>
        </div>
      )}
    </div>
  );
}
