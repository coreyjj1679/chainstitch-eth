"use client";

import { use } from "react";
import { NotebookEditor } from "@/components/notebook/notebook-editor";
import { useContracts, useProject } from "@/lib/hooks";
import { Skeleton } from "@/components/ui/skeleton";

export default function NotebookPage({
  params,
}: {
  params: Promise<{ id: string; nid: string }>;
}) {
  const { id, nid } = use(params);
  const { data: project } = useProject(id);
  const { data: contracts } = useContracts(id);

  if (!project || !contracts) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return <NotebookEditor notebookId={nid} project={project} contracts={contracts} />;
}
