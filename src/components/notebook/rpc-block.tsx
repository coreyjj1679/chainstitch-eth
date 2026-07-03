"use client";

import { getRpcMethod, RPC_METHODS } from "@/lib/rpc-methods";
import type { RpcConfig } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function RpcBlock({
  config,
  onChange,
}: {
  config: RpcConfig;
  onChange: (config: Partial<RpcConfig>) => void;
}) {
  const method = getRpcMethod(config.method);

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label className="text-xs text-muted-foreground">Method</Label>
        <Select
          value={config.method || null}
          items={RPC_METHODS.map((m) => ({ value: m.id, label: m.label }))}
          onValueChange={(value) =>
            onChange({ method: (value as string) ?? "", params: [] })
          }
        >
          <SelectTrigger className="w-full max-w-sm font-mono">
            <SelectValue placeholder="Select method…" />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {RPC_METHODS.map((m) => (
              <SelectItem key={m.id} value={m.id} className="font-mono">
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {method && (
          <p className="text-xs text-muted-foreground/70">{method.description}</p>
        )}
      </div>

      {method && method.params.length > 0 && (
        <div className="grid gap-2">
          {method.params.map((spec, i) => (
            <div key={spec.name} className="grid grid-cols-[10rem_1fr] items-center gap-2">
              <Label className="justify-end truncate text-right font-mono text-xs text-muted-foreground">
                {spec.name}
                {spec.optional && <span className="text-muted-foreground/60"> optional</span>}
              </Label>
              <Input
                className="h-8 font-mono text-xs"
                placeholder={`${spec.placeholder} — or {{variable}}`}
                value={config.params[i] ?? ""}
                onChange={(e) => {
                  const params = [...config.params];
                  params[i] = e.target.value;
                  onChange({ params });
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
