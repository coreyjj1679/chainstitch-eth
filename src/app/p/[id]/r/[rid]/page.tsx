"use client";

import { use } from "react";
import { NotebookEditor } from "@/components/notebook/notebook-editor";
import { useContracts, useProject } from "@/lib/hooks";
import { Skeleton } from "@/components/ui/skeleton";

/** A recipe opened in the full notebook editor (explicit save, no autosave). */
export default function RecipePage({
  params,
}: {
  params: Promise<{ id: string; rid: string }>;
}) {
  const { id, rid } = use(params);
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

  return (
    <NotebookEditor docId={rid} docKind="recipe" project={project} contracts={contracts} />
  );
}
