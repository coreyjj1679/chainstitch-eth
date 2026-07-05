"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { confirmLosingRecipeEdits } from "@/stores/notebook-store";
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

export function CreateNotebookDialog({
  projectId,
  trigger,
  children,
}: {
  projectId: string;
  /** Element rendered as the dialog trigger (Base UI render prop) */
  trigger: ReactNode & React.ReactElement;
  children?: ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const create = useMutation({
    mutationFn: () => api.notebooks.create(projectId, { title, description }),
    onSuccess: (notebook) => {
      queryClient.invalidateQueries({ queryKey: ["notebooks", projectId] });
      setOpen(false);
      setTitle("");
      setDescription("");
      // Opening the new notebook would discard unsaved recipe edits — the
      // notebook is created either way, so skipping navigation is safe.
      if (confirmLosingRecipeEdits(notebook.id)) {
        router.push(`/p/${projectId}/n/${notebook.id}`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger}>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New notebook</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Title</Label>
            <Input
              autoFocus
              placeholder="Deposit into AAVE vault"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && title) create.mutate();
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label>Description (optional)</Label>
            <Textarea
              placeholder="What flow does this notebook document?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!title || create.isPending} onClick={() => create.mutate()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
