"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BookMarked, NotebookPen, X } from "lucide-react";
import { useNotebooks, useRecipes } from "@/lib/hooks";
import {
  closeDocTab,
  openDocTab,
  pruneDocTabs,
  reorderDocTabs,
  sameTab,
  useDocTabs,
  type DocTab,
} from "@/stores/doc-tabs";
import { confirmLosingRecipeEdits, useNotebookStore } from "@/stores/notebook-store";
import { cn } from "@/lib/utils";

function tabHref(projectId: string, tab: DocTab): string {
  return `/p/${projectId}/${tab.kind === "notebook" ? "n" : "r"}/${tab.id}`;
}

const tabKey = (tab: DocTab) => `${tab.kind}-${tab.id}`;

function TabItem({
  tab,
  href,
  title,
  isActive,
  dirty,
  onClose,
}: {
  tab: DocTab;
  href: string;
  title: string;
  isActive: boolean;
  dirty: boolean;
  onClose: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tabKey(tab) });
  const Icon = tab.kind === "notebook" ? NotebookPen : BookMarked;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={isActive}
      className={cn(
        "group/tab flex max-w-52 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 py-1.5 text-xs transition-colors",
        isActive
          ? "border-border bg-muted font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        isDragging && "z-10 opacity-70",
      )}
      // Middle-click closes, like a browser.
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <Link
        href={href}
        // Native anchor dragging would fight the sortable's pointer drag.
        draggable={false}
        onClick={(e) => {
          if (isActive) return;
          if (!confirmLosingRecipeEdits(tab.id)) e.preventDefault();
        }}
        title={title}
        className="flex min-w-0 items-center gap-1.5 outline-none"
      >
        <Icon
          className={cn("size-3 shrink-0", tab.kind === "recipe" && "text-cyan-400/80")}
        />
        <span className="min-w-0 truncate">{title}</span>
        {dirty && (
          <span
            className="size-1.5 shrink-0 rounded-full bg-amber-400"
            title="Unsaved recipe changes"
          />
        )}
      </Link>
      <button
        aria-label={`Close ${title}`}
        title="Close tab"
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-opacity hover:bg-muted-foreground/15 hover:text-foreground",
          isActive ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100",
        )}
        onClick={onClose}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

/**
 * Browser-style tabs for the documents opened in this project. Visiting a
 * notebook or recipe opens its tab (VS Code style); tabs persist per project
 * in localStorage and drag to reorder. Switching is plain navigation — the
 * editor still loads one document at a time, so unsaved recipe edits are
 * guarded the same way as sidebar navigation.
 */
export function DocTabStrip({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const tabs = useDocTabs(projectId);
  const { data: notebooks } = useNotebooks(projectId);
  const { data: recipes } = useRecipes(projectId);
  // The one document with meaningful unsaved state: a dirty recipe.
  const dirtyRecipeId = useNotebookStore((s) =>
    s.docKind === "recipe" && s.dirty ? s.notebookId : null,
  );
  // A small drag threshold keeps plain clicks navigating instead of dragging.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const base = `/p/${projectId}`;
  const active: DocTab | null = pathname.startsWith(`${base}/n/`)
    ? { kind: "notebook", id: pathname.slice(`${base}/n/`.length) }
    : pathname.startsWith(`${base}/r/`)
      ? { kind: "recipe", id: pathname.slice(`${base}/r/`.length) }
      : null;

  // Visiting a document opens its tab.
  useEffect(() => {
    if (active) openDocTab(projectId, active);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by route, not object identity
  }, [projectId, active?.kind, active?.id]);

  // Deleted documents lose their tabs (once both lists have loaded).
  useEffect(() => {
    if (!notebooks || !recipes) return;
    pruneDocTabs(projectId, (tab) =>
      tab.kind === "notebook"
        ? notebooks.some((n) => n.id === tab.id)
        : recipes.some((r) => r.id === tab.id),
    );
  }, [projectId, notebooks, recipes]);

  if (tabs.length === 0) return null;

  const label = (tab: DocTab): string =>
    (tab.kind === "notebook"
      ? notebooks?.find((n) => n.id === tab.id)?.title
      : recipes?.find((r) => r.id === tab.id)?.name) ?? "…";

  function close(tab: DocTab) {
    const isActive = !!active && sameTab(tab, active);
    // Closing the active tab navigates away — guard dirty recipe edits first.
    if (isActive && !confirmLosingRecipeEdits()) return;
    const remaining = closeDocTab(projectId, tab);
    if (isActive) {
      const index = tabs.findIndex((t) => sameTab(t, tab));
      const next = remaining[Math.min(index, remaining.length - 1)];
      router.push(next ? tabHref(projectId, next) : base);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;
    const keys = tabs.map(tabKey);
    reorderDocTabs(
      projectId,
      keys.indexOf(String(dragged.id)),
      keys.indexOf(String(over.id)),
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={tabs.map(tabKey)} strategy={horizontalListSortingStrategy}>
        <div
          role="tablist"
          aria-label="Open documents"
          className="flex shrink-0 items-end gap-0.5 overflow-x-auto border-b bg-background/60 px-2 pt-1"
        >
          {tabs.map((tab) => (
            <TabItem
              key={tabKey(tab)}
              tab={tab}
              href={tabHref(projectId, tab)}
              title={label(tab)}
              isActive={!!active && sameTab(tab, active)}
              dirty={tab.kind === "recipe" && dirtyRecipeId === tab.id}
              onClose={() => close(tab)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
