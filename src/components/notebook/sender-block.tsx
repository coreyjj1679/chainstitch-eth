"use client";

import { FlaskConical, UserRound } from "lucide-react";
import type { SenderConfig } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function SenderBlock({
  config,
  editing,
  onChange,
}: {
  config: SenderConfig;
  editing: boolean;
  onChange: (config: Partial<SenderConfig>) => void;
}) {
  const simulateOnly = config.simulateOnly !== false;

  if (editing) {
    return (
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Caller address</Label>
          <Input
            autoFocus
            className="max-w-md font-mono text-xs"
            placeholder="0x… — or {{variable}}"
            value={config.address}
            onChange={(e) => onChange({ address: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={simulateOnly}
            onCheckedChange={(on) => onChange({ simulateOnly: on })}
          />
          <div>
            <p className="text-xs font-medium">Only override in Simulate mode</p>
            <p className="text-xs text-muted-foreground/70">
              {simulateOnly
                ? "Real runs use your connected wallet; the override applies to Simulate all only."
                : "Real runs will impersonate this address via anvil cheatcodes (works on anvil / local forks only)."}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground/70">
          Blocks inside this group run as this caller. Drag blocks in or use the
          group&apos;s add button.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 font-mono text-sm">
      <UserRound className="size-3.5 shrink-0 text-teal-400" />
      <span className="text-muted-foreground">acting as</span>
      <span className="truncate text-teal-400">
        {config.address || "— set a caller address"}
      </span>
      {simulateOnly ? (
        <span className="ml-1 flex shrink-0 items-center gap-1 rounded border border-teal-400/30 bg-teal-400/10 px-1 py-0.5 text-[10px] text-teal-400">
          <FlaskConical className="size-2.5" />
          simulate only
        </span>
      ) : (
        <span className="ml-1 shrink-0 rounded border border-amber-400/30 bg-amber-400/10 px-1 py-0.5 text-[10px] text-amber-400">
          impersonates on real runs
        </span>
      )}
    </div>
  );
}
