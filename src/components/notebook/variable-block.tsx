"use client";

import { Variable } from "lucide-react";
import { isValidVariableName } from "@/lib/variables";
import type { VariableConfig } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function VariableBlock({
  config,
  editing,
  onChange,
}: {
  config: VariableConfig;
  editing: boolean;
  onChange: (config: Partial<VariableConfig>) => void;
}) {
  const nameInvalid = !!config.name && !isValidVariableName(config.name);

  if (editing) {
    return (
      <div className="grid gap-3">
        <div className="grid grid-cols-[12rem_1fr] items-end gap-2">
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input
              autoFocus
              className="h-8 font-mono text-xs"
              placeholder="OWNER"
              value={config.name}
              aria-invalid={nameInvalid}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Value</Label>
            <Input
              className="h-8 font-mono text-xs"
              placeholder="ADDRESS"
              value={config.value}
              onChange={(e) => onChange({ value: e.target.value })}
            />
          </div>
        </div>
        {nameInvalid ? (
          <p className="text-xs text-destructive">
            Names must be valid identifiers (letters, digits, _, $).
          </p>
        ) : (
          <p className="text-xs text-muted-foreground/70">
            Reuse anywhere as{" "}
            <code className="rounded bg-muted px-1 font-mono">
              {`{{${config.name || "NAME"}}}`}
            </code>{" "}
            — addresses, numbers, or strings.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 font-mono text-sm">
      <Variable className="size-3.5 shrink-0 text-amber-300" />
      <span className="text-amber-300">{config.name || "unnamed"}</span>
      <span className="text-muted-foreground/60">=</span>
      <span className="min-w-0 truncate text-foreground/90">
        {config.value || "—"}
      </span>
    </div>
  );
}
