"use client";

import { useEffect, useMemo } from "react";
import { CircleCheck } from "lucide-react";
import {
  functionSignature,
  getFunctions,
  getWriteFunctions,
} from "@/lib/abi";
import { evaluateCondition } from "@/lib/condition";
import { useNotebookStore } from "@/stores/notebook-store";
import type { ContractEntry, ExpectConfig, ExpectKind } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const KINDS: Array<{ value: ExpectKind; label: string; hint: string }> = [
  {
    value: "condition",
    label: "Condition",
    hint: "Fail the run when a comparison is false",
  },
  {
    value: "event",
    label: "Event",
    hint: "Require a decoded event on the last write (or a variable)",
  },
  {
    value: "revert",
    label: "Revert",
    hint: "Simulate a call and require it to revert",
  },
];

export function ExpectBlock({
  config,
  editing,
  contracts,
  onChange,
}: {
  config: ExpectConfig;
  editing: boolean;
  contracts: ContractEntry[];
  onChange: (config: Partial<ExpectConfig>) => void;
}) {
  const scope = useNotebookStore((s) => s.scope);
  const kind = config.kind ?? "condition";

  const contract = contracts.find((c) => c.id === config.contractId);
  const functions = useMemo(
    () => (contract ? getWriteFunctions(contract.abi) : []),
    [contract],
  );
  const selectedFn = contract
    ? getFunctions(contract.abi).find((f) => f.name === config.functionName)
    : undefined;

  useEffect(() => {
    if (kind !== "revert") return;
    if (!config.contractId && contracts.length === 1) {
      onChange({ contractId: contracts[0].id, functionName: "", args: [] });
    }
  }, [kind, config.contractId, contracts, onChange]);

  useEffect(() => {
    if (kind !== "revert" || !contract || config.functionName) return;
    if (functions.length === 1) {
      onChange({ functionName: functions[0].name, args: [] });
    }
  }, [kind, contract, config.functionName, functions, onChange]);

  let conditionPreview: string | null = null;
  if (kind === "condition" && (config.condition ?? "").trim()) {
    try {
      conditionPreview = evaluateCondition(config.condition!, scope).resolved;
    } catch {
      conditionPreview = null;
    }
  }

  if (editing) {
    return (
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Kind</Label>
          <Select
            value={kind}
            items={KINDS.map((k) => ({ value: k.value, label: k.label }))}
            onValueChange={(value) => {
              const next = (value as ExpectKind) ?? "condition";
              if (next === "condition") {
                onChange({
                  kind: "condition",
                  condition: config.condition ?? "",
                  eventName: undefined,
                  contract: undefined,
                  fromVariable: undefined,
                  contractId: undefined,
                  functionName: undefined,
                  args: undefined,
                  reason: undefined,
                  value: undefined,
                });
              } else if (next === "event") {
                onChange({
                  kind: "event",
                  eventName: config.eventName ?? "",
                  contract: config.contract,
                  fromVariable: config.fromVariable,
                  condition: undefined,
                  contractId: undefined,
                  functionName: undefined,
                  args: undefined,
                  reason: undefined,
                  value: undefined,
                });
              } else {
                onChange({
                  kind: "revert",
                  contractId: config.contractId ?? "",
                  functionName: config.functionName ?? "",
                  args: config.args ?? [],
                  reason: config.reason,
                  value: config.value,
                  condition: undefined,
                  eventName: undefined,
                  contract: undefined,
                  fromVariable: undefined,
                });
              }
            }}
          >
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground/70">
            {KINDS.find((k) => k.value === kind)?.hint}. Unlike a Condition
            group, an unmet expect <span className="font-medium">fails the run</span>.
          </p>
        </div>

        {kind === "condition" && (
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Condition</Label>
            <Input
              autoFocus
              className="max-w-md font-mono text-xs"
              placeholder="{{balance}} > 0"
              value={config.condition ?? ""}
              onChange={(e) => onChange({ condition: e.target.value })}
            />
            {conditionPreview ? (
              <p className="font-mono text-xs text-muted-foreground">
                {conditionPreview}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground/70">
                Same grammar as Condition groups:{" "}
                <code className="rounded bg-muted px-1 font-mono">
                  == != &lt; &lt;= &gt; &gt;=
                </code>
                .
              </p>
            )}
          </div>
        )}

        {kind === "event" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Event name</Label>
              <Input
                autoFocus
                className="font-mono text-xs"
                placeholder="Transfer"
                value={config.eventName ?? ""}
                onChange={(e) => onChange({ eventName: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">
                Contract filter (optional)
              </Label>
              <Input
                className="font-mono text-xs"
                placeholder="USDC"
                value={config.contract ?? ""}
                onChange={(e) => onChange({ contract: e.target.value || undefined })}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">
                From variable (optional)
              </Label>
              <Input
                className="max-w-md font-mono text-xs"
                placeholder="leave empty to use the last write&apos;s events"
                value={config.fromVariable ?? ""}
                onChange={(e) =>
                  onChange({
                    fromVariable: e.target.value.replace(/[{}]/g, "") || undefined,
                  })
                }
              />
            </div>
          </div>
        )}

        {kind === "revert" && (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Contract</Label>
                <Select
                  value={config.contractId || null}
                  items={contracts.map((c) => ({ value: c.id, label: c.name }))}
                  onValueChange={(value) =>
                    onChange({
                      contractId: (value as string) ?? "",
                      functionName: "",
                      args: [],
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select contract…" />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {contracts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Function</Label>
                <Select
                  value={config.functionName || null}
                  items={functions.map((f) => ({
                    value: f.name,
                    label: functionSignature(f),
                  }))}
                  onValueChange={(value) =>
                    onChange({
                      functionName: (value as string) ?? "",
                      args: [],
                    })
                  }
                  disabled={!contract}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select function…" />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {functions.map((f) => (
                      <SelectItem key={f.name} value={f.name}>
                        {functionSignature(f)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {selectedFn &&
              selectedFn.inputs.map((input, i) => (
                <div key={i} className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">
                    {input.name || `arg${i}`}{" "}
                    <span className="text-muted-foreground/60">({input.type})</span>
                  </Label>
                  <Input
                    className="font-mono text-xs"
                    value={config.args?.[i] ?? ""}
                    onChange={(e) => {
                      const args = [...(config.args ?? [])];
                      while (args.length < selectedFn.inputs.length) args.push("");
                      args[i] = e.target.value;
                      onChange({ args });
                    }}
                  />
                </div>
              ))}
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">
                Reason substring (optional)
              </Label>
              <Input
                className="max-w-md font-mono text-xs"
                placeholder="InsufficientBalance"
                value={config.reason ?? ""}
                onChange={(e) =>
                  onChange({ reason: e.target.value || undefined })
                }
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Collapsed summary
  let summary = "— configure expect";
  if (kind === "condition") {
    summary = config.condition?.trim()
      ? `expect ${config.condition}`
      : "— set a condition";
  } else if (kind === "event") {
    summary = config.eventName?.trim()
      ? `expect event ${config.eventName}`
      : "— set an event name";
  } else if (kind === "revert") {
    const name = contract?.name ?? "?";
    const fn = config.functionName || "?";
    summary = `expect ${name}.${fn} to revert${
      config.reason ? ` (${config.reason})` : ""
    }`;
  }

  return (
    <div className="flex items-center gap-2 font-mono text-sm">
      <CircleCheck className="size-3.5 shrink-0 text-rose-400" />
      <span className="min-w-0 truncate text-rose-400">{summary}</span>
    </div>
  );
}
