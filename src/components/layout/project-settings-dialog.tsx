"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ProjectSettingsDialog({
  project,
  trigger,
  children,
}: {
  project: Project;
  /** Custom trigger element (Base UI render prop); defaults to the header name button. */
  trigger?: React.ReactElement;
  /** Content of the custom trigger; ignored without `trigger`. */
  children?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [chainId, setChainId] = useState(String(project.chainId));
  const [rpcUrl, setRpcUrl] = useState(project.rpcUrl);
  const [explorerUrl, setExplorerUrl] = useState(project.explorerUrl ?? "");

  const save = useMutation({
    mutationFn: () =>
      api.projects.update(project.id, {
        name,
        description,
        chainId: Number(chainId),
        rpcUrl,
        explorerUrl,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          // Re-sync form with the latest project data on open
          setName(project.name);
          setDescription(project.description ?? "");
          setChainId(String(project.chainId));
          setRpcUrl(project.rpcUrl);
          setExplorerUrl(project.explorerUrl ?? "");
        }
      }}
    >
      {trigger ? (
        <DialogTrigger render={trigger}>{children}</DialogTrigger>
      ) : (
        <DialogTrigger
          render={
            <button
              className="group/name flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-muted/60"
              title="Project settings"
            />
          }
        >
          <span className="truncate text-sm leading-none font-medium">{project.name}</span>
          <Pencil className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover/name:text-muted-foreground" />
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Project settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="ps-name">Name</Label>
            <Input id="ps-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ps-desc">Description</Label>
            <Textarea
              id="ps-desc"
              placeholder="What is this project about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="ps-chain">Chain ID</Label>
              <Input
                id="ps-chain"
                value={chainId}
                onChange={(e) => setChainId(e.target.value)}
              />
            </div>
            <div className="col-span-2 grid gap-2">
              <Label htmlFor="ps-rpc">RPC URL</Label>
              <Input
                id="ps-rpc"
                className="font-mono"
                value={rpcUrl}
                onChange={(e) => setRpcUrl(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ps-explorer">Block explorer URL</Label>
            <Input
              id="ps-explorer"
              className="font-mono"
              placeholder="https://etherscan.io"
              value={explorerUrl}
              onChange={(e) => setExplorerUrl(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!name || !chainId || !rpcUrl || save.isPending}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
