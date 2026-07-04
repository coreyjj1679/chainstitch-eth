"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useRecipes } from "@/lib/hooks";
import { blockLabel, executionOrder, isGroupType } from "@/lib/block-label";
import { useNotebookStore } from "@/stores/notebook-store";
import type { ContractEntry, NotebookBlock } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { cn } from "@/lib/utils";

/** Sentinel for the target select: create a new recipe. */
const NEW_RECIPE = "__new__";

/**
 * "Save as recipe": pick blocks from the current notebook and store them as a
 * named, reusable group on the project.
 */
export function SaveRecipeDialog({
  open,
  onOpenChange,
  projectId,
  contracts,
  initialSelectedId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  contracts: ContractEntry[];
  /** Block to pre-check when the dialog opens (e.g. the selected cell). */
  initialSelectedId?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* The popup unmounts on close, so the form resets on every open. */}
        <SaveRecipeForm
          projectId={projectId}
          contracts={contracts}
          initialSelectedId={initialSelectedId}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function SaveRecipeForm({
  projectId,
  contracts,
  initialSelectedId,
  onSaved,
}: {
  projectId: string;
  contracts: ContractEntry[];
  initialSelectedId?: string | null;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const blocks = useNotebookStore((s) => s.blocks);
  const { data: recipes } = useRecipes(projectId);
  // Recipe blocks can't be nested into a recipe (the server rejects them too).
  const ordered = useMemo(
    () => executionOrder(blocks).filter((b) => b.type !== "recipe"),
    [blocks],
  );

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  /** NEW_RECIPE, or the id of an existing recipe to overwrite. */
  const [target, setTarget] = useState<string>(NEW_RECIPE);
  const updating = target !== NEW_RECIPE;
  const [selected, setSelected] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (!initialSelectedId) return initial;
    const anchor = blocks.find((b) => b.id === initialSelectedId);
    if (!anchor || anchor.type === "recipe") return initial;
    initial.add(anchor.id);
    if (isGroupType(anchor.type)) {
      for (const child of blocks.filter((b) => b.parentId === anchor.id)) {
        initial.add(child.id);
      }
    }
    return initial;
  });

  function toggle(block: NotebookBlock) {
    setSelected((prev) => {
      const next = new Set(prev);
      const ids = [block.id];
      // A group carries its children along, both ways.
      if (isGroupType(block.type)) {
        ids.push(...blocks.filter((b) => b.parentId === block.id).map((b) => b.id));
      }
      const on = !next.has(block.id);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = ordered
        .filter((b) => selected.has(b.id))
        .map((b) => ({
          ...b,
          // Parent links pointing outside the selection are cut: the block
          // joins the recipe at the top level.
          parentId: b.parentId && selected.has(b.parentId) ? b.parentId : null,
        }));
      if (updating) {
        // Overwrite the chosen recipe's steps; its name/description stay.
        return api.recipes.update(target, { blocks: payload });
      }
      return api.recipes.create(projectId, {
        name: name.trim(),
        description: description.trim() || undefined,
        blocks: payload,
      });
    },
    onSuccess: (recipe) => {
      queryClient.invalidateQueries({ queryKey: ["recipes", projectId] });
      toast.success(
        updating ? `Updated recipe "${recipe.name}"` : `Saved recipe "${recipe.name}"`,
      );
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSave =
    (updating || name.trim().length > 0) && selected.size > 0 && !save.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Save as recipe</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3 py-1">
        {recipes && recipes.length > 0 && (
          <div className="grid gap-1.5">
            <Label>Save to</Label>
            <Select value={target} onValueChange={(v) => setTarget(v ?? NEW_RECIPE)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_RECIPE}>New recipe</SelectItem>
                {recipes.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    Update “{r.name}”
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {!updating && (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="recipe-name">Name</Label>
              <Input
                id="recipe-name"
                autoFocus
                placeholder="Approve + deposit"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="recipe-desc">
                Description{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="recipe-desc"
                placeholder="What this flow does"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </>
        )}
        <div className="grid gap-1.5">
          <Label>Blocks to include</Label>
          <div className="grid max-h-64 gap-0.5 overflow-y-auto rounded-md border p-1.5">
            {ordered.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                This notebook has no blocks yet.
              </p>
            )}
            {ordered.map((block) => (
              <label
                key={block.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/50",
                  block.parentId && "ml-5",
                )}
              >
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={selected.has(block.id)}
                  onChange={() => toggle(block)}
                />
                <span className="rounded border border-border/60 bg-muted/40 px-1 font-mono text-[10px] text-muted-foreground">
                  {block.type}
                </span>
                <span className="min-w-0 truncate font-mono">
                  {blockLabel(block, contracts)}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground/70">
            {updating
              ? "Updating replaces the recipe's steps with this selection; linked recipe cells run the new steps from now on."
              : "Inserting a recipe pastes an editable copy of these blocks — recipes reference this project's address book."}
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button disabled={!canSave} onClick={() => save.mutate()}>
          <BookmarkPlus data-icon="inline-start" />
          {save.isPending
            ? "Saving…"
            : updating
              ? `Update recipe (${selected.size})`
              : `Save recipe (${selected.size})`}
        </Button>
      </DialogFooter>
    </>
  );
}

