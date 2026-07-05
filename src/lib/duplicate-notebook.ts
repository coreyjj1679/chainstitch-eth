import { api } from "@/lib/api";
import type { NotebookMeta } from "@/lib/types";

/**
 * Clone a notebook server-side: create "<title> (copy)" and re-save the
 * source blocks under fresh ids, with intra-notebook parent links remapped
 * so the copy is fully independent of the original.
 */
export async function duplicateNotebook(
  projectId: string,
  notebookId: string,
): Promise<NotebookMeta> {
  const source = await api.notebooks.get(notebookId);
  const created = await api.notebooks.create(projectId, {
    title: `${source.title} (copy)`,
    description: source.description ?? undefined,
  });
  const idMap = new Map<string, string>();
  for (const b of source.blocks) idMap.set(b.id, crypto.randomUUID());
  const clonedBlocks = source.blocks.map((b) => ({
    ...b,
    id: idMap.get(b.id)!,
    parentId: b.parentId ? (idMap.get(b.parentId) ?? null) : null,
  }));
  await api.notebooks.saveBlocks(created.id, clonedBlocks);
  return created;
}
