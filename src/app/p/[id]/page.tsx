"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BookMarked,
  ChevronRight,
  Copy,
  Database,
  FileJson,
  NotebookPen,
  Pencil,
  Plus,
  Settings2,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  useContracts,
  useNotebooks,
  useProject,
  useRecipes,
  useStateViews,
} from "@/lib/hooks";
import { duplicateNotebook } from "@/lib/duplicate-notebook";
import { confirmLosingRecipeEdits } from "@/stores/notebook-store";
import { CreateNotebookDialog } from "@/components/layout/create-notebook-dialog";
import { ProjectSettingsDialog } from "@/components/layout/project-settings-dialog";
import { ShareProjectDialog } from "@/components/workspace/share-dialog";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { NotebookMeta } from "@/lib/types";

/** Compact "last touched" stamp for document cards. */
function formatUpdated(ts: number): string {
  const minutes = Math.floor((Date.now() - ts) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const date = new Date(ts);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function SectionHeader({
  label,
  count,
  action,
}: {
  label: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
        {label}
        {count !== undefined && count > 0 && (
          <span className="ml-2 font-mono text-xs text-muted-foreground/50">
            {count}
          </span>
        )}
      </h2>
      {action}
    </div>
  );
}

/** Pencil-triggered dialog to rename a notebook / edit its description. */
function EditNotebookDialog({ notebook }: { notebook: NotebookMeta }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(notebook.title);
  const [description, setDescription] = useState(notebook.description ?? "");

  const save = useMutation({
    mutationFn: () =>
      api.notebooks.update(notebook.id, { title, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notebooks", notebook.projectId] });
      queryClient.invalidateQueries({ queryKey: ["notebook", notebook.id] });
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
          setTitle(notebook.title);
          setDescription(notebook.description ?? "");
        }
      }}
    >
      <DialogTrigger
        render={
          <button
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Rename ${notebook.title}`}
            title="Rename / edit description"
          />
        }
      >
        <Pencil className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit notebook</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="en-title">Title</Label>
            <Input
              id="en-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && title) save.mutate();
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="en-desc">Description (optional)</Label>
            <Textarea
              id="en-desc"
              placeholder="What flow does this notebook document?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!title || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The project explorer: the landing page between the workspace home and the
 * documents. Lists and manages the project's notebooks and recipes, with
 * quick links to the address book and the state dashboard. (Replaces the old
 * behavior of bouncing straight into the most recent notebook — the sidebar
 * and document tabs keep that one click away.)
 */
export default function ProjectExplorerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: project } = useProject(id);
  const { data: notebooks, isLoading: notebooksLoading } = useNotebooks(id);
  const { data: recipes, isLoading: recipesLoading } = useRecipes(id);
  const { data: contracts } = useContracts(id);
  const { data: stateViews } = useStateViews(id);
  const canEdit = project?.role === "editor" || project?.role === "owner";
  const base = `/p/${id}`;

  const removeNotebook = useMutation({
    mutationFn: (notebookId: string) => api.notebooks.remove(notebookId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["notebooks", id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicate = useMutation({
    mutationFn: (notebookId: string) => duplicateNotebook(id, notebookId),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["notebooks", id] });
      toast.success(`Duplicated as "${created.title}"`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createRecipe = useMutation({
    mutationFn: () =>
      api.recipes.create(id, { name: "Untitled recipe", blocks: [] }),
    onSuccess: (recipe) => {
      queryClient.invalidateQueries({ queryKey: ["recipes", id] });
      router.push(`${base}/r/${recipe.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRecipe = useMutation({
    mutationFn: (recipeId: string) => api.recipes.remove(recipeId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["recipes", id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const contractCount = contracts?.length ?? 0;
  const pinnedCount = stateViews?.views.length ?? 0;

  return (
    <div className="grid gap-10">
      {/* Orientation: full description (the header truncates it) */}
      {project?.description && (
        <p className="-mb-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {project.description}
        </p>
      )}

      <section>
        <SectionHeader
          label="Notebooks"
          count={notebooks?.length}
          action={
            canEdit && (
              <CreateNotebookDialog
                projectId={id}
                trigger={<Button size="sm" variant="outline" />}
              >
                <Plus data-icon="inline-start" />
                New notebook
              </CreateNotebookDialog>
            )
          }
        />
        {notebooksLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : notebooks && notebooks.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {notebooks.map((n) => (
              <div
                key={n.id}
                className="group relative flex flex-col rounded-xl border bg-card/40 p-4 transition-colors hover:border-border hover:bg-card/70"
              >
                <Link
                  href={`${base}/n/${n.id}`}
                  className="absolute inset-0"
                  aria-label={n.title}
                  onClick={(e) => {
                    if (!confirmLosingRecipeEdits(n.id)) e.preventDefault();
                  }}
                />
                <div className="mb-1.5 flex items-center gap-2">
                  <NotebookPen className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {n.title}
                  </span>
                </div>
                <p className="line-clamp-2 min-h-8 text-xs leading-4 text-muted-foreground">
                  {n.description || "No description"}
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground/60">
                    Updated {formatUpdated(n.updatedAt)}
                  </span>
                  {canEdit && (
                    <span className="relative z-10 flex items-center opacity-0 transition-opacity group-hover:opacity-100">
                      <EditNotebookDialog notebook={n} />
                      <button
                        className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={`Duplicate ${n.title}`}
                        title="Duplicate notebook"
                        disabled={duplicate.isPending}
                        onClick={() => duplicate.mutate(n.id)}
                      >
                        <Copy className="size-3.5" />
                      </button>
                      <button
                        className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={`Delete ${n.title}`}
                        title="Delete notebook"
                        onClick={() => {
                          if (confirm(`Delete notebook "${n.title}"?`)) {
                            removeNotebook.mutate(n.id);
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center rounded-xl border border-dashed px-8 py-12 text-center">
            <NotebookPen className="mb-3 size-8 text-muted-foreground" />
            <p className="mb-1 font-medium">No notebooks in this project yet</p>
            <p className="mb-6 max-w-sm text-sm text-muted-foreground">
              {contractCount > 0
                ? "Create a notebook to start composing contract calls."
                : "Start by adding your contract ABIs, then create a notebook to compose calls."}
            </p>
            {canEdit && (
              <div className="flex items-center gap-2">
                {contractCount === 0 && (
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={`${base}/contracts`} />}
                  >
                    <FileJson data-icon="inline-start" />
                    Add contracts
                  </Button>
                )}
                <CreateNotebookDialog projectId={id} trigger={<Button />}>
                  <Plus data-icon="inline-start" />
                  New notebook
                </CreateNotebookDialog>
              </div>
            )}
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          label="Recipes"
          count={recipes?.length}
          action={
            canEdit && (
              <Button
                size="sm"
                variant="outline"
                disabled={createRecipe.isPending}
                title="New recipe — build it like a notebook, then Save"
                onClick={() => {
                  if (confirmLosingRecipeEdits()) createRecipe.mutate();
                }}
              >
                <Plus data-icon="inline-start" />
                New recipe
              </Button>
            )
          }
        />
        {recipesLoading ? (
          <Skeleton className="h-14" />
        ) : recipes && recipes.length > 0 ? (
          <div className="overflow-hidden rounded-xl border">
            {recipes.map((r, i) => {
              const usedIn = r.usedIn ?? 0;
              return (
                <div
                  key={r.id}
                  className={
                    "group relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-card/60 " +
                    (i > 0 ? "border-t" : "")
                  }
                >
                  <Link
                    href={`${base}/r/${r.id}`}
                    className="absolute inset-0"
                    aria-label={r.name}
                    onClick={(e) => {
                      if (!confirmLosingRecipeEdits(r.id)) e.preventDefault();
                    }}
                  />
                  <BookMarked className="size-3.5 shrink-0 text-cyan-400/80" />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {r.name}
                    </span>
                    {r.description && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.description}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground/60">
                    {usedIn > 0
                      ? `linked in ${usedIn} ${usedIn === 1 ? "notebook" : "notebooks"}`
                      : formatUpdated(r.updatedAt)}
                  </span>
                  {canEdit && (
                    <button
                      className="relative z-10 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground"
                      aria-label={`Delete ${r.name}`}
                      title="Delete recipe"
                      onClick={() => {
                        const warning =
                          usedIn > 0
                            ? `Delete recipe "${r.name}"? ${usedIn} ${usedIn === 1 ? "notebook links" : "notebooks link"} to it — their recipe cells will show it as deleted.`
                            : `Delete recipe "${r.name}"?`;
                        if (confirm(warning)) removeRecipe.mutate(r.id);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {canEdit
              ? "No recipes yet. Bookmark a block selection in any notebook to save a reusable flow."
              : "No recipes yet."}
          </p>
        )}
      </section>

      <section>
        <SectionHeader label="Project resources" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href={`${base}/contracts`}
            className="group flex items-center gap-3 rounded-xl border bg-card/40 p-4 transition-colors hover:border-border hover:bg-card/70"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-sky-400/10 text-sky-400">
              <FileJson className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Contracts</p>
              <p className="truncate text-xs text-muted-foreground">
                {contractCount > 0
                  ? `${contractCount} ${contractCount === 1 ? "entry" : "entries"} in the address book`
                  : "Drop in ABIs and deployed addresses"}
              </p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href={`${base}/state`}
            className="group flex items-center gap-3 rounded-xl border bg-card/40 p-4 transition-colors hover:border-border hover:bg-card/70"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-emerald-400/10 text-emerald-400">
              <Database className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">State</p>
              <p className="truncate text-xs text-muted-foreground">
                {pinnedCount > 0
                  ? `${pinnedCount} pinned ${pinnedCount === 1 ? "card" : "cards"}, refreshed in one multicall`
                  : "Pin view functions into a live dashboard"}
              </p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
          </Link>
          {project?.role === "owner" && (
            <>
              {/* Self-gates on team mode: renders nothing in local mode. */}
              <ShareProjectDialog
                project={project}
                trigger={
                  <button className="group flex items-center gap-3 rounded-xl border bg-card/40 p-4 text-left transition-colors hover:border-border hover:bg-card/70" />
                }
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-violet-400/10 text-violet-400">
                  <Share2 className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Sharing &amp; access</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Invite a wallet, or turn on an anyone-with-the-link URL
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
              </ShareProjectDialog>
              <ProjectSettingsDialog
                project={project}
                trigger={
                  <button className="group flex items-center gap-3 rounded-xl border bg-card/40 p-4 text-left transition-colors hover:border-border hover:bg-card/70" />
                }
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-amber-400/10 text-amber-400">
                  <Settings2 className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Project settings</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Name, description, chain id, RPC and explorer URLs
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
              </ProjectSettingsDialog>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
