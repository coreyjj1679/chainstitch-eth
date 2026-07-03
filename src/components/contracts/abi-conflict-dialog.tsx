"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAddress } from "viem";
import type { Abi } from "viem";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getReadFunctions, getWriteFunctions } from "@/lib/abi";
import type { ContractEntry } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface IncomingAbiFile {
  /** File name without the .json extension */
  name: string;
  abi: Abi;
}

export interface AbiConflict {
  incoming: IncomingAbiFile;
  existing: ContractEntry;
}

type ConflictAction = "ignore" | "abi" | "abi-address";

const ACTIONS: Array<{ value: ConflictAction; label: string }> = [
  { value: "ignore", label: "Ignore" },
  { value: "abi", label: "Update ABI only" },
  { value: "abi-address", label: "Update ABI + address" },
];

interface ConflictRow {
  conflict: AbiConflict;
  action: ConflictAction;
  address: string;
}

function ActionSelect({
  value,
  placeholder,
  onChange,
}: {
  value: ConflictAction | null;
  placeholder?: string;
  onChange: (action: ConflictAction) => void;
}) {
  return (
    <Select
      value={value}
      items={ACTIONS}
      onValueChange={(v) => v && onChange(v as ConflictAction)}
    >
      <SelectTrigger size="sm" className="w-44 shrink-0">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {ACTIONS.map((a) => (
          <SelectItem key={a.value} value={a.value}>
            {a.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Shown when dropped ABI files match existing contracts by name. Each conflict
 * can be ignored, update the ABI in place, or update the ABI plus a new
 * address — individually or all at once.
 */
export function AbiConflictDialog({
  projectId,
  conflicts,
  onClose,
}: {
  projectId: string;
  conflicts: AbiConflict[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<ConflictRow[]>(() =>
    conflicts.map((conflict) => ({ conflict, action: "abi", address: "" })),
  );

  const updateRow = (index: number, patch: Partial<ConflictRow>) =>
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const updates = rows.filter((r) => r.action !== "ignore");
  const needAddress = rows.filter(
    (r) => r.action === "abi-address" && !isAddress(r.address.trim()),
  ).length;

  const apply = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        updates.map((r) =>
          api.contracts.update(
            r.conflict.existing.id,
            r.action === "abi"
              ? { abi: r.conflict.incoming.abi }
              : { abi: r.conflict.incoming.abi, address: r.address.trim() },
          ),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { updated: updates.length - failed, failed };
    },
    onSuccess: ({ updated, failed }) => {
      queryClient.invalidateQueries({ queryKey: ["contracts", projectId] });
      const ignored = rows.length - updates.length;
      const parts = [`${updated} updated`];
      if (ignored > 0) parts.push(`${ignored} ignored`);
      if (failed > 0) parts.push(`${failed} failed`);
      (failed > 0 ? toast.error : toast.success)(`Contracts: ${parts.join(", ")}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Contracts already in the address book</DialogTitle>
          <DialogDescription>
            {conflicts.length === 1
              ? "A dropped file matches an existing contract by name."
              : `${conflicts.length} dropped files match existing contracts by name.`}{" "}
            Choose what to do with each one — nothing changes until you apply.
          </DialogDescription>
        </DialogHeader>

        {rows.length > 1 && (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">Set all to</span>
            <ActionSelect
              value={null}
              placeholder="Choose action…"
              onChange={(action) =>
                setRows((rs) => rs.map((r) => ({ ...r, action })))
              }
            />
          </div>
        )}

        <div className="grid max-h-[55vh] gap-2 overflow-y-auto">
          {rows.map((row, i) => {
            const { existing, incoming } = row.conflict;
            const reads = getReadFunctions(incoming.abi).length;
            const writes = getWriteFunctions(incoming.abi).length;
            const badAddress =
              row.action === "abi-address" &&
              row.address.trim() !== "" &&
              !isAddress(row.address.trim());
            return (
              <div
                key={`${existing.id}-${i}`}
                className="grid gap-2 rounded-lg border p-3"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{existing.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {existing.address || "no address set"}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    new ABI: {reads} reads · {writes} writes
                  </span>
                  <ActionSelect
                    value={row.action}
                    onChange={(action) => updateRow(i, { action })}
                  />
                </div>
                {row.action === "abi-address" && (
                  <Input
                    className="font-mono"
                    placeholder="New address 0x…"
                    value={row.address}
                    aria-invalid={badAddress || undefined}
                    onChange={(e) => updateRow(i, { address: e.target.value })}
                  />
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <span className="text-xs text-muted-foreground sm:mr-auto sm:self-center">
            {updates.length} to update · {rows.length - updates.length} to ignore
            {needAddress > 0 && (
              <span className="text-destructive">
                {" "}
                · {needAddress} need{needAddress === 1 ? "s" : ""} a valid address
              </span>
            )}
          </span>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={needAddress > 0 || apply.isPending}
            onClick={() => apply.mutate()}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
