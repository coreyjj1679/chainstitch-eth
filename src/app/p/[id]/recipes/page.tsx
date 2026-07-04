"use client";

import { use, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookMarked, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useContracts, useMe, useRecipes } from "@/lib/hooks";
import { blockLabel, executionOrder } from "@/lib/block-label";
import type { ContractEntry, Recipe } from "@/lib/types";
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

function EditRecipeDialog({
  recipe,
  open,
  onOpenChange,
}: {
  recipe: Recipe;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(recipe.name);
  const [description, setDescription] = useState(recipe.description ?? "");

  const save = useMutation({
    mutationFn: () =>
      api.recipes.update(recipe.id, { name: name.trim(), description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipes", recipe.projectId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
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
        </div>
        <DialogFooter>
          <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
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
              title="Rename / edit description"
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
        <EditRecipeDialog recipe={recipe} open={editing} onOpenChange={setEditing} />
      )}
    </Card>
  );
}

export default function RecipesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: recipes, isLoading } = useRecipes(id);
  const { data: contracts } = useContracts(id);
  const { data: me } = useMe();
  const canEdit = me?.role === "editor" || me?.role === "owner";

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
