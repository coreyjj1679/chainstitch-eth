"use client";

import { useEffect, useMemo } from "react";
import {
  functionSignature,
  getFunctions,
  getReadFunctions,
  getWriteFunctions,
  returnsSignature,
} from "@/lib/abi";
import type { CallConfig, ContractEntry } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function CallBlock({
  type,
  config,
  contracts,
  onChange,
}: {
  type: "read" | "write";
  config: CallConfig;
  contracts: ContractEntry[];
  onChange: (config: Partial<CallConfig>) => void;
}) {
  const contract = contracts.find((c) => c.id === config.contractId);
  const functions = useMemo(() => {
    if (!contract) return [];
    return type === "read"
      ? getReadFunctions(contract.abi)
      : getWriteFunctions(contract.abi);
  }, [contract, type]);

  const selectedFn = contract
    ? getFunctions(contract.abi).find((f) => f.name === config.functionName)
    : undefined;

  // Skip pointless dropdown interaction when there is only one choice.
  useEffect(() => {
    if (!config.contractId && contracts.length === 1) {
      onChange({ contractId: contracts[0].id, functionName: "", args: [] });
    }
  }, [config.contractId, contracts, onChange]);

  useEffect(() => {
    if (contract && !config.functionName && functions.length === 1) {
      onChange({ functionName: functions[0].name, args: [] });
    }
  }, [contract, config.functionName, functions, onChange]);

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Contract</Label>
          <Select
            value={config.contractId || null}
            // Maps the stored contract id to its display name in the trigger
            items={contracts.map((c) => ({ value: c.id, label: c.name }))}
            onValueChange={(value) =>
              onChange({ contractId: (value as string) ?? "", functionName: "", args: [] })
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
            items={functions.map((f) => ({ value: f.name, label: functionSignature(f) }))}
            onValueChange={(value) =>
              onChange({ functionName: (value as string) ?? "", args: [] })
            }
          >
            <SelectTrigger className="w-full font-mono" disabled={!contract}>
              <SelectValue placeholder="Select function…" />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {functions.map((f) => (
                <SelectItem key={functionSignature(f)} value={f.name} className="font-mono">
                  {functionSignature(f)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedFn && selectedFn.inputs.length > 0 && (
        <div className="grid gap-2">
          {selectedFn.inputs.map((input, i) => (
            <div key={i} className="grid grid-cols-[10rem_1fr] items-center gap-2">
              <Label className="justify-end truncate text-right font-mono text-xs text-muted-foreground">
                {input.name || `arg${i}`}
                <span className="text-muted-foreground/60"> {input.type}</span>
              </Label>
              <Input
                className="h-8 font-mono text-xs"
                placeholder={
                  input.type.endsWith("]") || input.type.startsWith("tuple")
                    ? 'JSON, e.g. ["0x…", "123n"]'
                    : input.type.startsWith("uint") || input.type.startsWith("int")
                      ? "0 — or {{variable}}"
                      : `${input.type} — or {{variable}}`
                }
                value={config.args[i] ?? ""}
                onChange={(e) => {
                  const args = [...config.args];
                  args[i] = e.target.value;
                  onChange({ args });
                }}
              />
            </div>
          ))}
        </div>
      )}

      {type === "write" && selectedFn?.stateMutability === "payable" && (
        <div className="grid grid-cols-[10rem_1fr] items-center gap-2">
          <Label className="justify-end text-right font-mono text-xs text-muted-foreground">
            value <span className="text-muted-foreground/60">wei</span>
          </Label>
          <Input
            className="h-8 font-mono text-xs"
            placeholder="ETH value in wei — or {{variable}}"
            value={config.value ?? ""}
            onChange={(e) => onChange({ value: e.target.value })}
          />
        </div>
      )}

      {selectedFn && returnsSignature(selectedFn) && (
        <p className="font-mono text-xs text-muted-foreground/70">
          returns ({returnsSignature(selectedFn)})
        </p>
      )}
    </div>
  );
}
