"use client";

import { useMemo, useState } from "react";
import { privateKeyToAccount } from "viem/accounts";
import { KeyRound, ShieldAlert, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useSignerStore } from "@/stores/signer";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Normalize user input to a 0x-prefixed key and derive its address, if valid. */
function deriveAddress(input: string): `0x${string}` | null {
  const trimmed = input.trim();
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return null;
  try {
    return privateKeyToAccount(hex as `0x${string}`).address;
  } catch {
    return null;
  }
}

/**
 * Manage the session-only local key signer for a project (beta). Pasting a key
 * lets "Run all" broadcast every write back-to-back with no wallet prompt. The
 * key lives in memory for this browser tab only — never stored, never sent to
 * the server. Deliberately blunt about the risk.
 */
export function SignerDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
}) {
  const signer = useSignerStore((s) => s.signers[project.id]);
  const setSigner = useSignerStore((s) => s.setSigner);
  const clearSigner = useSignerStore((s) => s.clearSigner);

  const [value, setValue] = useState("");

  // Never leave a pasted key sitting in the field once the dialog is dismissed.
  function handleOpenChange(next: boolean) {
    if (!next) setValue("");
    onOpenChange(next);
  }

  const derived = useMemo(() => deriveAddress(value), [value]);
  const invalid = value.trim() !== "" && !derived;
  const isMainnet = project.chainId === 1;

  function activate() {
    const trimmed = value.trim();
    const hex = (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
    if (!derived) {
      toast.error("Enter a valid 32-byte private key (0x + 64 hex chars)");
      return;
    }
    setSigner(project.id, { privateKey: hex, address: derived });
    toast.success(`Signing writes as ${derived.slice(0, 6)}…${derived.slice(-4)} (this tab only)`);
    setValue("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-amber-400" />
            Private-key signer
            <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] font-normal text-amber-400">
              beta
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <p className="flex items-start gap-1.5 text-xs text-amber-500">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <strong>Beta — DYOR.</strong> With a key loaded, &ldquo;Run all&rdquo;
                signs and broadcasts every write transaction automatically, with no
                wallet confirmation. Use a throwaway / burner key that holds only what
                you can afford to lose.
              </span>
            </p>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              The key stays in this browser tab&apos;s memory only — it is never saved,
              never sent to the server, and is cleared on reload.
            </p>
            {isMainnet && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                This project is on Ethereum <strong>mainnet</strong> — transactions are
                real and irreversible. Prefer a fork or testnet.
              </p>
            )}
          </div>

          {signer ? (
            <div className="grid gap-2">
              <Label className="text-xs text-muted-foreground">Active signer</Label>
              <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2">
                <KeyRound className="size-3.5 shrink-0 text-amber-400" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {signer.address}
                </span>
              </div>
              <p className="text-xs text-muted-foreground/70">
                Loaded for this session. Paste a different key below to replace it, or
                remove it to go back to wallet prompts.
              </p>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="signer-key">
              {signer ? "Replace with another key" : "Private key"}
            </Label>
            <Input
              id="signer-key"
              type="password"
              className="font-mono"
              placeholder="0x… (32-byte private key)"
              value={value}
              aria-invalid={invalid}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && derived) activate();
              }}
            />
            {invalid ? (
              <p className="text-xs text-destructive">
                Not a valid private key — expected 0x followed by 64 hex characters.
              </p>
            ) : derived ? (
              <p className="font-mono text-xs text-emerald-400">
                Address: {derived}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground/70">
                Reads and simulations are unaffected — this only changes how writes are
                signed.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          {signer && (
            <Button
              variant="outline"
              onClick={() => {
                clearSigner(project.id);
                toast.success("Removed the session key — writes use your wallet again");
                handleOpenChange(false);
              }}
            >
              Remove key
            </Button>
          )}
          <Button disabled={!derived} onClick={activate}>
            <KeyRound data-icon="inline-start" />
            {signer ? "Replace key" : "Use this key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
