"use client";

import { GitBranch } from "lucide-react";
import { evaluateCondition } from "@/lib/condition";
import { useNotebookStore } from "@/stores/notebook-store";
import type { IfConfig } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function IfBlock({
  config,
  editing,
  onChange,
}: {
  config: IfConfig;
  editing: boolean;
  onChange: (config: Partial<IfConfig>) => void;
}) {
  const scope = useNotebookStore((s) => s.scope);

  // Best-effort live preview; unresolved variables are normal before a run.
  let preview: string | null = null;
  if (config.condition.trim()) {
    try {
      preview = evaluateCondition(config.condition, scope).resolved;
    } catch {
      preview = null;
    }
  }

  if (editing) {
    return (
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Condition</Label>
          <Input
            autoFocus
            className="max-w-md font-mono text-xs"
            placeholder="{{allowance}} < {{amount}}"
            value={config.condition}
            onChange={(e) => onChange({ condition: e.target.value })}
          />
        </div>
        {preview ? (
          <p className="font-mono text-xs text-muted-foreground">{preview}</p>
        ) : (
          <p className="text-xs text-muted-foreground/70">
            Compare {"{{variables}}"} and literals with{" "}
            <code className="rounded bg-muted px-1 font-mono">
              == != &lt; &lt;= &gt; &gt;=
            </code>
            , or use a bare value for truthiness (<code className="rounded bg-muted px-1 font-mono">!</code>{" "}
            negates). Blocks inside this group run only when the condition is
            true — otherwise they are skipped.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 font-mono text-sm">
      <GitBranch className="size-3.5 shrink-0 text-fuchsia-400" />
      <span className="text-muted-foreground">if</span>
      <span className="min-w-0 truncate text-fuchsia-400">
        {config.condition || "— set a condition"}
      </span>
    </div>
  );
}
