"use client";

import { use, useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { FileJson, ListChecks, Pencil, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useContracts, useProject } from "@/lib/hooks";
import { getReadFunctions, getWriteFunctions, validateAbi } from "@/lib/abi";
import type { ContractEntry } from "@/lib/types";
import {
  AbiConflictDialog,
  type AbiConflict,
  type IncomingAbiFile,
} from "@/components/contracts/abi-conflict-dialog";
import { MassAddressDialog } from "@/components/contracts/mass-address-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function EditContractDialog({
  contract,
  open,
  onOpenChange,
}: {
  contract: ContractEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(contract.name);
  const [address, setAddress] = useState(contract.address);

  const save = useMutation({
    mutationFn: () => api.contracts.update(contract.id, { name, address }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contracts", contract.projectId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit contract</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Address</Label>
            <Input
              className="font-mono"
              placeholder="0x…"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              For proxies: enter the proxy address here and upload the
              implementation ABI. Calls go to this address with the uploaded ABI.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!name || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContractRow({ contract }: { contract: ContractEntry }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const reads = getReadFunctions(contract.abi).length;
  const writes = getWriteFunctions(contract.abi).length;

  const remove = useMutation({
    mutationFn: () => api.contracts.remove(contract.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["contracts", contract.projectId] }),
  });

  return (
    <div className="flex items-center gap-3 px-4 py-1.5">
      <FileJson className="size-4 shrink-0 text-muted-foreground" />
      <span
        className="w-48 shrink-0 truncate text-sm font-medium md:w-64"
        title={contract.name}
      >
        {contract.name}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-mono text-xs",
          contract.address ? "text-muted-foreground" : "text-amber-500",
        )}
        title={contract.address || undefined}
      >
        {contract.address || "no address set"}
      </span>
      <Badge variant="outline" className="hidden text-xs md:inline-flex">
        {reads} reads
      </Badge>
      <Badge variant="outline" className="hidden text-xs md:inline-flex">
        {writes} writes
      </Badge>
      <Button variant="ghost" size="icon-sm" onClick={() => setEditing(true)}>
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          if (confirm(`Remove "${contract.name}" from the address book?`))
            remove.mutate();
        }}
      >
        <Trash2 className="text-muted-foreground" />
      </Button>
      {editing && (
        <EditContractDialog
          contract={contract}
          open={editing}
          onOpenChange={setEditing}
        />
      )}
    </div>
  );
}

export default function ContractsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const { data: project } = useProject(id);
  const { data: contracts, isLoading } = useContracts(id);
  const [massFillOpen, setMassFillOpen] = useState(false);
  const [conflicts, setConflicts] = useState<AbiConflict[] | null>(null);

  const missingCount = contracts?.filter((c) => !c.address).length ?? 0;

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      // Parse and validate everything up front so one bad file doesn't
      // leave a half-imported batch behind.
      const incoming: IncomingAbiFile[] = [];
      for (const file of files) {
        const text = await file.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error(`${file.name} is not valid JSON`);
        }
        const validation = validateAbi(parsed);
        if (!validation.ok) throw new Error(`${file.name}: ${validation.error}`);
        incoming.push({
          name: file.name.replace(/\.json$/i, ""),
          abi: validation.abi,
        });
      }

      // Files whose name matches an existing contract go to the conflict
      // dialog instead of silently creating a duplicate entry.
      const byName = new Map(
        (contracts ?? []).map((c) => [c.name.toLowerCase(), c]),
      );
      const fresh = incoming.filter((f) => !byName.has(f.name.toLowerCase()));
      const clashes: AbiConflict[] = incoming
        .filter((f) => byName.has(f.name.toLowerCase()))
        .map((f) => ({ incoming: f, existing: byName.get(f.name.toLowerCase())! }));

      for (const f of fresh) {
        await api.contracts.create(id, { name: f.name, address: "", abi: f.abi });
      }
      return { created: fresh.length, clashes };
    },
    onSuccess: ({ created, clashes }) => {
      if (created > 0) {
        queryClient.invalidateQueries({ queryKey: ["contracts", id] });
        toast.success(
          `Added ${created} ${created === 1 ? "contract" : "contracts"}. Now fill in the addresses.`,
        );
      }
      if (clashes.length > 0) setConflicts(clashes);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) upload.mutate(accepted);
    },
    [upload],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/json": [".json"] },
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Address book</h2>
          <p className="text-sm text-muted-foreground">
            Drop ABI JSON files (raw ABI arrays or Foundry/Hardhat artifacts),
            then fill in the deployed addresses for chain {project?.chainId}.
          </p>
        </div>
        {missingCount > 0 && (
          <Button variant="outline" onClick={() => setMassFillOpen(true)}>
            <ListChecks data-icon="inline-start" />
            Fill {missingCount} missing {missingCount === 1 ? "address" : "addresses"}
          </Button>
        )}
      </div>

      <div
        {...getRootProps()}
        className={cn(
          "mb-6 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
          isDragActive ? "border-primary bg-primary/5" : "hover:border-ring/60",
        )}
      >
        <input {...getInputProps()} />
        <Upload className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">
          {isDragActive ? "Drop the ABI files here" : "Drag & drop ABI JSON files"}
        </p>
        <p className="text-xs text-muted-foreground">
          or click to browse — re-dropping a file named like an existing
          contract lets you update it
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : contracts && contracts.length > 0 ? (
        <Card className="gap-0 py-1">
          <div className="divide-y">
            {contracts.map((c) => (
              <ContractRow key={c.id} contract={c} />
            ))}
          </div>
        </Card>
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          No contracts yet. Drop your ABI files above.
        </p>
      )}

      <MassAddressDialog
        projectId={id}
        contracts={contracts ?? []}
        open={massFillOpen}
        onOpenChange={setMassFillOpen}
      />
      {conflicts && (
        <AbiConflictDialog
          projectId={id}
          conflicts={conflicts}
          onClose={() => setConflicts(null)}
        />
      )}
    </div>
  );
}
