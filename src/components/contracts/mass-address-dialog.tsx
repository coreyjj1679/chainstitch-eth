"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAddress } from "viem";
import { ClipboardPaste } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Extract name→address pairs from pasted text. Accepts a JSON object mapping
 * (`{"Dummy": "0x…"}`) or lines in `Name 0x…` / `Name=0x…` / `Name: 0x…` form.
 */
export function parseAddressMapping(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const put = (name: string, address: string) => {
    if (name && isAddress(address)) out.set(name.toLowerCase(), address);
  };
  try {
    const json: unknown = JSON.parse(text);
    if (json && typeof json === "object" && !Array.isArray(json)) {
      for (const [name, addr] of Object.entries(json)) {
        if (typeof addr === "string") put(name.trim(), addr.trim());
      }
      return out;
    }
  } catch {
    // not JSON — fall through to line parsing
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*"?([^"=:]+?)"?\s*[=:,\s]\s*"?(0x[0-9a-fA-F]{40})"?\s*,?\s*$/);
    if (match) put(match[1].trim(), match[2]);
  }
  return out;
}

/**
 * Bulk-fill addresses for contracts that don't have one yet. Type them in or
 * paste a name→address mapping (e.g. from deployment output) to fill the
 * inputs, then update everything in one go.
 */
export function MassAddressDialog({
  projectId,
  contracts,
  open,
  onOpenChange,
}: {
  projectId: string;
  contracts: ContractEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const missing = useMemo(
    () => contracts.filter((c) => !c.address),
    [contracts],
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const entries = missing.map((c) => ({
    contract: c,
    value: (values[c.id] ?? "").trim(),
  }));
  const filled = entries.filter((e) => e.value !== "");
  const invalid = filled.filter((e) => !isAddress(e.value));

  const fillFromPaste = () => {
    const mapping = parseAddressMapping(pasteText);
    if (mapping.size === 0) {
      toast.error("No name → address pairs recognized in the pasted text");
      return;
    }
    const matches = missing.filter((c) => mapping.has(c.name.toLowerCase()));
    if (matches.length === 0) {
      toast.error("Pasted names don't match any contract missing an address");
      return;
    }
    setValues((prev) => {
      const next = { ...prev };
      for (const c of matches) next[c.id] = mapping.get(c.name.toLowerCase())!;
      return next;
    });
    toast.success(
      `Filled ${matches.length} ${matches.length === 1 ? "address" : "addresses"}`,
    );
  };

  const save = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        filled.map((e) =>
          api.contracts.update(e.contract.id, { address: e.value }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { updated: filled.length - failed, failed };
    },
    onSuccess: ({ updated, failed }) => {
      queryClient.invalidateQueries({ queryKey: ["contracts", projectId] });
      if (failed > 0) {
        toast.error(`Updated ${updated} addresses, ${failed} failed`);
      } else {
        toast.success(`Updated ${updated} ${updated === 1 ? "address" : "addresses"}`);
      }
      setValues({});
      setPasteText("");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Fill in missing addresses</DialogTitle>
          <DialogDescription>
            {missing.length === 0
              ? "Every contract has an address."
              : `${missing.length} ${missing.length === 1 ? "contract is" : "contracts are"} missing an address. Leave a field empty to skip it.`}
          </DialogDescription>
        </DialogHeader>

        {missing.length > 0 && (
          <>
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPaste((s) => !s)}
              >
                <ClipboardPaste data-icon="inline-start" />
                Paste mapping
              </Button>
              {showPaste && (
                <div className="mt-2 grid gap-2">
                  <Textarea
                    className="max-h-40 font-mono text-xs"
                    placeholder={'Dummy 0x1234…\nToken=0xabcd…\nor JSON: {"Dummy": "0x1234…"}'}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="justify-self-start"
                    disabled={!pasteText.trim()}
                    onClick={fillFromPaste}
                  >
                    Fill inputs from pasted text
                  </Button>
                </div>
              )}
            </div>

            <div className="grid max-h-[50vh] gap-3 overflow-y-auto pr-1">
              {entries.map(({ contract, value }) => {
                const bad = value !== "" && !isAddress(value);
                return (
                  <div key={contract.id} className="grid grid-cols-[12rem_1fr] items-center gap-2">
                    <Label
                      className="block min-w-0 truncate text-sm leading-normal"
                      title={contract.name}
                      htmlFor={`addr-${contract.id}`}
                    >
                      {contract.name}
                    </Label>
                    <Input
                      id={`addr-${contract.id}`}
                      className="font-mono"
                      placeholder="0x…"
                      value={values[contract.id] ?? ""}
                      aria-invalid={bad || undefined}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [contract.id]: e.target.value }))
                      }
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}

        <DialogFooter>
          <span className="text-xs text-muted-foreground sm:mr-auto sm:self-center">
            {filled.length} of {missing.length} filled
            {invalid.length > 0 && (
              <span className="text-destructive"> · {invalid.length} invalid</span>
            )}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={filled.length === 0 || invalid.length > 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            {filled.length > 0
              ? `Update ${filled.length} ${filled.length === 1 ? "address" : "addresses"}`
              : "Update addresses"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
