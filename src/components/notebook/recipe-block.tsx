"use client";

import { BookMarked, TriangleAlert, Ungroup } from "lucide-react";
import { blockLabel, executionOrder } from "@/lib/block-label";
import type { ContractEntry, Recipe, RecipeBlockConfig } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

function StepList({
  recipe,
  contracts,
  className,
}: {
  recipe: Recipe;
  contracts: ContractEntry[];
  className?: string;
}) {
  const steps = executionOrder(recipe.blocks);
  return (
    <div className={cn("grid gap-px", className)}>
      {steps.map((step, index) => (
        <div
          key={step.id}
          className={cn(
            "flex items-center gap-2 text-xs text-muted-foreground",
            step.parentId && "ml-4",
          )}
        >
          <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted-foreground/40">
            {index + 1}
          </span>
          <span className="min-w-0 truncate font-mono">
            {blockLabel(step, contracts)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * A linked recipe cell: references a saved recipe and reruns all of its steps
 * as one block. "Detach" swaps it for an editable copy of the blocks.
 */
export function RecipeBlock({
  config,
  editing,
  recipes,
  contracts,
  onChange,
  onDetach,
}: {
  config: RecipeBlockConfig;
  editing: boolean;
  recipes: Recipe[];
  contracts: ContractEntry[];
  onChange: (config: Partial<RecipeBlockConfig>) => void;
  /** Replace this cell with an editable copy of the recipe's blocks. */
  onDetach?: () => void;
}) {
  const recipe = recipes.find((r) => r.id === config.recipeId);

  if (editing) {
    return (
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Recipe</Label>
          <Select
            value={config.recipeId || null}
            items={recipes.map((r) => ({ value: r.id, label: r.name }))}
            onValueChange={(value) => onChange({ recipeId: (value as string) ?? "" })}
          >
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Select a recipe…" />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {recipes.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {recipes.length === 0 && (
          <p className="text-xs text-muted-foreground/70">
            No recipes in this project yet — bookmark blocks in any notebook,
            or create one under Recipes in the sidebar.
          </p>
        )}
        {config.recipeId && !recipe && (
          <p className="flex items-center gap-1.5 text-xs text-amber-500">
            <TriangleAlert className="size-3.5 shrink-0" />
            This recipe was deleted. Pick another one, or delete this block.
          </p>
        )}
        {recipe && (
          <>
            <StepList recipe={recipe} contracts={contracts} />
            <div className="flex items-center gap-2">
              {onDetach && (
                <Button variant="outline" size="xs" onClick={onDetach}>
                  <Ungroup data-icon="inline-start" />
                  Detach into editable blocks
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground/70">
              Running this cell reruns every step in order with the notebook&apos;s
              variables; step outputs flow back into scope. Changes to the recipe
              apply here automatically — detach to customize the blocks instead.
            </p>
          </>
        )}
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="flex items-center gap-2 font-mono text-sm">
        {config.recipeId ? (
          <>
            <TriangleAlert className="size-3.5 shrink-0 text-amber-500" />
            <span className="text-amber-500">recipe deleted — edit this block</span>
          </>
        ) : (
          <>
            <BookMarked className="size-3.5 shrink-0 text-cyan-400" />
            <span className="text-muted-foreground">— select a recipe</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2 font-mono text-sm">
        <BookMarked className="size-3.5 shrink-0 text-cyan-400" />
        <span className="text-muted-foreground">recipe</span>
        <span className="min-w-0 truncate text-cyan-400">{recipe.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground/60">
          {recipe.blocks.length} {recipe.blocks.length === 1 ? "step" : "steps"}
        </span>
      </div>
      <StepList recipe={recipe} contracts={contracts} className="pl-5" />
    </div>
  );
}
