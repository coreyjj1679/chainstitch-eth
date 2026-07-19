"use client";

import { useEffect, useMemo } from "react";
import type { PublicClient } from "viem";
import {
  functionSignature,
  getFunctions,
  getReadFunctions,
  getWriteFunctions,
  returnsSignature,
} from "@/lib/abi";
import type { CallConfig, ContractEntry } from "@/lib/types";
import { useTokenDecimals } from "@/hooks/use-token-decimals";
import {
  AbiArgInput,
  PayableValueInput,
} from "@/components/notebook/abi-arg-input";
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
  publicClient,
  onChange,
}: {
  type: "read" | "write";
  config: CallConfig;
  contracts: ContractEntry[];
  publicClient?: PublicClient;
  onChange: (config: Partial<CallConfig>) => void;
}) {
  const contract = contracts.find((c) => c.id === config.contractId);
  const { data: decimals } = useTokenDecimals(publicClient, contract);
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
              <AbiArgInput
                name={input.name}
                type={input.type}
                value={config.args[i] ?? ""}
                contracts={contracts}
                decimals={decimals}
                unitLabel={contract?.name}
                publicClient={publicClient}
                onChange={(next) => {
                  const args = [...config.args];
                  args[i] = next;
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
            value <span className="text-muted-foreground/60">ETH</span>
          </Label>
          <PayableValueInput
            value={config.value ?? ""}
            onChange={(next) => onChange({ value: next })}
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
