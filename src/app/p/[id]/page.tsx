"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileJson, NotebookPen, Plus } from "lucide-react";
import { useContracts, useNotebooks } from "@/lib/hooks";
import { CreateNotebookDialog } from "@/components/layout/create-notebook-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProjectIndexPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: notebooks, isLoading } = useNotebooks(id);
  const { data: contracts } = useContracts(id);

  // Jupyter-style: land on the most recent notebook when one exists.
  useEffect(() => {
    if (notebooks && notebooks.length > 0) {
      router.replace(`/p/${id}/n/${notebooks[0].id}`);
    }
  }, [notebooks, id, router]);

  if (isLoading || (notebooks && notebooks.length > 0)) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const hasContracts = (contracts?.length ?? 0) > 0;

  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed px-8 py-16 text-center">
      <NotebookPen className="mb-3 size-8 text-muted-foreground" />
      <p className="mb-1 font-medium">No notebooks in this project yet</p>
      <p className="mb-6 max-w-sm text-sm text-muted-foreground">
        {hasContracts
          ? "Create a notebook to start composing contract calls."
          : "Start by adding your contract ABIs, then create a notebook to compose calls."}
      </p>
      <div className="flex items-center gap-2">
        {!hasContracts && (
          <Button variant="outline" render={<Link href={`/p/${id}/contracts`} />}>
            <FileJson data-icon="inline-start" />
            Add contracts
          </Button>
        )}
        <CreateNotebookDialog projectId={id} trigger={<Button />}>
          <Plus data-icon="inline-start" />
          New notebook
        </CreateNotebookDialog>
      </div>
    </div>
  );
}
