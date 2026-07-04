"use client";

import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPublicClient, http, type PublicClient } from "viem";
import {
  DndContext,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Heading2, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useContracts, useProject, useStateViews } from "@/lib/hooks";
import { getReadFunctions } from "@/lib/abi";
import { displayValue } from "@/lib/serialize";
import { shortError } from "@/lib/engine";
import { chainForProject } from "@/components/wallet/project-web3-provider";
import type {
  ContractEntry,
  StateLayout,
  StateTitleEntry,
  StateViewEntry,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const MAX_SPAN = 4;

interface StateCall {
  contract: ContractEntry;
  functionName: string;
}

const callKey = (contractId: string, functionName: string) =>
  `${contractId}.${functionName}`;

type CallResult = { ok: true; value: unknown } | { ok: false; error: string };

async function fetchState(client: PublicClient, calls: StateCall[]) {
  const contractCalls = calls.map((c) => ({
    address: c.contract.address as `0x${string}`,
    abi: c.contract.abi,
    functionName: c.functionName,
  }));
  try {
    const results = await client.multicall({ contracts: contractCalls, allowFailure: true });
    return results.map((r) =>
      r.status === "success"
        ? { ok: true as const, value: r.result }
        : { ok: false as const, error: shortError(r.error) },
    );
  } catch {
    // Chain without a Multicall3 deployment (e.g. plain anvil): read individually.
    return Promise.all(
      contractCalls.map(async (call) => {
        try {
          return { ok: true as const, value: await client.readContract(call) };
        } catch (e) {
          return { ok: false as const, error: shortError(e) };
        }
      }),
    );
  }
}

/** One ordered sequence of dashboard items: contract cards and section titles. */
type LayoutItem =
  | { kind: "card"; id: string; view: StateViewEntry }
  | { kind: "title"; id: string; title: StateTitleEntry };

function itemsFromLayout(layout: StateLayout): LayoutItem[] {
  return [
    ...layout.views.map((view): LayoutItem => ({ kind: "card", id: view.id, view })),
    ...layout.titles.map((title): LayoutItem => ({ kind: "title", id: title.id, title })),
  ].sort((a, b) => {
    const pa = a.kind === "card" ? a.view.position : a.title.position;
    const pb = b.kind === "card" ? b.view.position : b.title.position;
    return pa - pb;
  });
}

function layoutFromItems(items: LayoutItem[]): StateLayout {
  const views: StateViewEntry[] = [];
  const titles: StateTitleEntry[] = [];
  items.forEach((item, position) => {
    if (item.kind === "card") views.push({ ...item.view, position });
    else titles.push({ ...item.title, position });
  });
  return { views, titles };
}

/** Map a stored span (1–4) to the number of columns currently available. */
function visualSpan(span: number, cols: number): number {
  if (cols >= MAX_SPAN) return Math.min(span, MAX_SPAN);
  if (cols === 1) return 1;
  // 2-column screens: spans 1–2 → half width, 3–4 → full width.
  return span > 2 ? 2 : 1;
}

function SectionTitleRow({
  title,
  canEdit,
  onCommit,
  onRemove,
}: {
  title: StateTitleEntry;
  canEdit: boolean;
  onCommit: (text: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: title.id, disabled: !canEdit });
  // A freshly added title has empty text and starts in edit mode.
  const [editing, setEditing] = useState(title.text === "");
  const [value, setValue] = useState(title.text);

  const commit = () => {
    setEditing(false);
    const text = value.trim();
    if (text === "") onRemove();
    else if (text !== title.text) onCommit(text);
    else setValue(title.text);
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        gridColumn: "1 / -1",
      }}
      className={cn(
        "group/title mt-2 flex items-center gap-1 first:mt-0",
        isDragging && "z-50 opacity-70",
      )}
    >
      {canEdit && (
        <button
          className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-opacity group-hover/title:opacity-100 hover:bg-muted hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
          aria-label="Drag to move section"
          title="Drag to move section"
        >
          <GripVertical className="size-3.5" />
        </button>
      )}
      {editing ? (
        <Input
          autoFocus
          className="h-8 max-w-md font-heading text-base font-semibold"
          placeholder="Section title…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setValue(title.text);
              setEditing(false);
              if (title.text === "") onRemove();
            }
          }}
        />
      ) : (
        <h3
          className={cn(
            "font-heading text-base font-semibold",
            canEdit && "cursor-text rounded-md px-1 -mx-1 hover:bg-muted/50",
          )}
          title={canEdit ? "Click to rename" : undefined}
          onClick={canEdit ? () => setEditing(true) : undefined}
        >
          {title.text}
        </h3>
      )}
      <div className="ml-2 h-px flex-1 bg-border" />
      {canEdit && !editing && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 transition-opacity group-hover/title:opacity-100"
          onClick={onRemove}
          aria-label="Remove section title"
          title="Remove section title"
        >
          <Trash2 className="text-muted-foreground" />
        </Button>
      )}
    </div>
  );
}

function StateCard({
  view,
  contract,
  cols,
  gridRef,
  results,
  loading,
  canEdit,
  onResize,
}: {
  view: StateViewEntry;
  contract: ContractEntry;
  cols: number;
  gridRef: RefObject<HTMLDivElement | null>;
  results: Record<string, CallResult> | undefined;
  loading: boolean;
  canEdit: boolean;
  onResize: (span: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: view.id, disabled: !canEdit });
  const [previewSpan, setPreviewSpan] = useState<number | null>(null);

  const span = visualSpan(previewSpan ?? view.span, cols);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const grid = gridRef.current;
    if (!grid || cols === 1) return;
    const colWidth = grid.clientWidth / cols;
    const startX = e.clientX;
    const startSpan = visualSpan(view.span, cols);
    let current = view.span;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const onMove = (ev: PointerEvent) => {
      const delta = Math.round((ev.clientX - startX) / colWidth);
      const next = Math.min(cols, Math.max(1, startSpan + delta));
      if (next !== current) {
        current = next;
        setPreviewSpan(next);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      setPreviewSpan(null);
      if (current !== view.span) onResize(current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <Card
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        gridColumn: `span ${span} / span ${span}`,
      }}
      className={cn(
        "group/card relative",
        isDragging && "z-50 opacity-80 ring-2 ring-ring/40",
        previewSpan !== null && "ring-2 ring-ring/40",
      )}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-1 text-base">
          {canEdit && (
            <button
              className="-ml-1.5 flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-opacity group-hover/card:opacity-100 hover:bg-muted hover:text-foreground active:cursor-grabbing"
              {...attributes}
              {...listeners}
              aria-label="Drag to rearrange"
              title="Drag to rearrange"
            >
              <GripVertical className="size-3.5" />
            </button>
          )}
          <span className="truncate">{contract.name}</span>
        </CardTitle>
        <CardDescription className="truncate font-mono text-xs">
          {contract.address}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-2">
          {view.functions.map((functionName) => {
            const result = results?.[callKey(contract.id, functionName)];
            return (
              <div
                key={functionName}
                className="flex items-start justify-between gap-4 border-b border-border/40 pb-2 last:border-0"
              >
                <dt className="shrink-0 font-mono text-xs text-muted-foreground">
                  {functionName}()
                </dt>
                <dd className="min-w-0 break-all text-right font-mono text-xs">
                  {loading ? (
                    <Skeleton className="h-4 w-24" />
                  ) : !result ? (
                    "—"
                  ) : result.ok ? (
                    displayValue(result.value)
                  ) : (
                    <span className="text-destructive">{result.error}</span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </CardContent>
      {canEdit && cols > 1 && (
        <div
          className="absolute inset-y-2 right-0 flex w-3 cursor-col-resize touch-none items-center justify-center opacity-0 transition-opacity group-hover/card:opacity-100"
          onPointerDown={startResize}
          title="Drag to resize"
        >
          <div className="h-10 w-1 rounded-full bg-ring/50" />
        </div>
      )}
    </Card>
  );
}

function ConfigureDialog({
  projectId,
  contracts,
  layout,
}: {
  projectId: string;
  contracts: ContractEntry[];
  layout: StateLayout;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<Record<string, Set<string>>>(() => {
    const initial: Record<string, Set<string>> = {};
    for (const view of layout.views) initial[view.contractId] = new Set(view.functions);
    return initial;
  });

  const save = useMutation({
    mutationFn: () => {
      // Preserve position/span of existing cards; append new ones at the end.
      const byContract = new Map(layout.views.map((v) => [v.contractId, v]));
      let nextPosition =
        1 +
        Math.max(
          -1,
          ...layout.views.map((v) => v.position),
          ...layout.titles.map((t) => t.position),
        );
      const views = Object.entries(selection)
        .filter(([, fns]) => fns.size > 0)
        .map(([contractId, fns]) => {
          const existing = byContract.get(contractId);
          return {
            id: existing?.id,
            contractId,
            functions: [...fns],
            position: existing?.position ?? nextPosition++,
            span: existing?.span ?? 2,
          };
        });
      return api.stateViews.save(projectId, views, layout.titles);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stateViews", projectId] });
      queryClient.invalidateQueries({ queryKey: ["stateData", projectId] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function toggle(contractId: string, fn: string, on: boolean) {
    setSelection((prev) => {
      const next = { ...prev };
      const set = new Set(next[contractId] ?? []);
      if (on) set.add(fn);
      else set.delete(fn);
      next[contractId] = set;
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Settings2 data-icon="inline-start" />
        Configure
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>State dashboard functions</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 py-2">
          {contracts.filter((c) => c.address).map((contract) => {
            const zeroArg = getReadFunctions(contract.abi).filter(
              (f) => f.inputs.length === 0,
            );
            if (zeroArg.length === 0) return null;
            return (
              <div key={contract.id}>
                <p className="mb-2 text-sm font-medium">{contract.name}</p>
                <div className="grid gap-2">
                  {zeroArg.map((fn) => (
                    <div key={fn.name} className="flex items-center justify-between">
                      <Label className="font-mono text-xs">{fn.name}()</Label>
                      <Switch
                        checked={selection[contract.id]?.has(fn.name) ?? false}
                        onCheckedChange={(on) => toggle(contract.id, fn.name, on)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {contracts.filter((c) => c.address).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Add contracts with addresses in the address book first.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function StatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const { data: project } = useProject(id);
  const { data: contracts } = useContracts(id);
  const { data: layout } = useStateViews(id);
  // Effective role on this project (workspace role or per-project grant).
  const canEdit = project?.role === "editor" || project?.role === "owner";

  const gridRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(2);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      setCols(w >= 900 ? 4 : w >= 560 ? 2 : 1);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const items = useMemo(() => (layout ? itemsFromLayout(layout) : []), [layout]);

  const contractById = useMemo(
    () => new Map((contracts ?? []).map((c) => [c.id, c])),
    [contracts],
  );

  const calls = useMemo<StateCall[]>(() => {
    if (!layout) return [];
    const result: StateCall[] = [];
    for (const view of layout.views) {
      const contract = contractById.get(view.contractId);
      if (!contract || !contract.address) continue;
      for (const fn of view.functions) result.push({ contract, functionName: fn });
    }
    return result;
  }, [layout, contractById]);

  const stateQuery = useQuery({
    // Sorted key: reordering/resizing cards must not force an RPC refetch.
    queryKey: [
      "stateData",
      id,
      calls.map((c) => callKey(c.contract.id, c.functionName)).sort(),
    ],
    queryFn: async () => {
      const client = createPublicClient({
        chain: chainForProject(project!),
        transport: http(project!.rpcUrl),
      }) as PublicClient;
      const results = await fetchState(client, calls);
      const byKey: Record<string, CallResult> = {};
      calls.forEach((call, i) => {
        byKey[callKey(call.contract.id, call.functionName)] = results[i];
      });
      return byKey;
    },
    enabled: !!project && calls.length > 0,
    // Deliberately static: refresh only on demand.
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const saveLayout = useMutation({
    mutationFn: (next: StateLayout) =>
      api.stateViews.save(
        id,
        next.views.map((v) => ({
          id: v.id,
          contractId: v.contractId,
          functions: v.functions,
          position: v.position,
          span: v.span,
        })),
        next.titles.map((t) => ({ id: t.id, text: t.text, position: t.position })),
      ),
    onError: (e: Error) => {
      toast.error(e.message);
      queryClient.invalidateQueries({ queryKey: ["stateViews", id] });
    },
  });

  /** Optimistically apply a new item sequence, then persist it. */
  const commitItems = useCallback(
    (nextItems: LayoutItem[]) => {
      const next = layoutFromItems(nextItems);
      queryClient.setQueryData(["stateViews", id], next);
      saveLayout.mutate(next);
    },
    [id, queryClient, saveLayout],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((it) => it.id === active.id);
    const to = items.findIndex((it) => it.id === over.id);
    if (from === -1 || to === -1) return;
    commitItems(arrayMove(items, from, to));
  }

  function addTitle() {
    const titleId = crypto.randomUUID();
    commitItems([
      ...items,
      {
        kind: "title",
        id: titleId,
        // Starts empty: the row opens in edit mode, and the server skips
        // empty titles so an abandoned one disappears on reload.
        title: { id: titleId, projectId: id, text: "", position: items.length },
      },
    ]);
  }

  if (!project || !contracts || !layout) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold">State</h2>
          <p className="text-sm text-muted-foreground">
            A snapshot of contract metadata and state. It only re-reads when you
            hit refresh.
            {canEdit && items.length > 0 && (
              <> Drag cards to rearrange, drag a card&apos;s right edge to resize.</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && items.length > 0 && (
            <Button variant="outline" size="sm" onClick={addTitle}>
              <Heading2 data-icon="inline-start" />
              Add title
            </Button>
          )}
          {canEdit && (
            <ConfigureDialog projectId={id} contracts={contracts} layout={layout} />
          )}
          <Button
            size="sm"
            onClick={() => stateQuery.refetch()}
            disabled={stateQuery.isFetching || calls.length === 0}
          >
            <RefreshCw
              data-icon="inline-start"
              className={stateQuery.isFetching ? "animate-spin" : undefined}
            />
            Refresh
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <p className="mb-1 font-medium">Nothing to display yet</p>
          <p className="text-sm text-muted-foreground">
            {canEdit
              ? "Use Configure to pick view functions (name, symbol, totalSupply, …) from your contracts."
              : "An editor can configure which view functions appear here."}
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={items.map((it) => it.id)} strategy={rectSortingStrategy}>
            <div
              ref={gridRef}
              className="grid gap-4"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {items.map((item) => {
                if (item.kind === "title") {
                  return (
                    <SectionTitleRow
                      key={item.id}
                      title={item.title}
                      canEdit={canEdit}
                      onCommit={(text) =>
                        commitItems(
                          items.map((it) =>
                            it.id === item.id && it.kind === "title"
                              ? { ...it, title: { ...it.title, text } }
                              : it,
                          ),
                        )
                      }
                      onRemove={() =>
                        commitItems(items.filter((it) => it.id !== item.id))
                      }
                    />
                  );
                }
                const contract = contractById.get(item.view.contractId);
                if (!contract || !contract.address) return null;
                return (
                  <StateCard
                    key={item.id}
                    view={item.view}
                    contract={contract}
                    cols={cols}
                    gridRef={gridRef}
                    results={stateQuery.data}
                    loading={stateQuery.isFetching && !stateQuery.data}
                    canEdit={canEdit}
                    onResize={(span) =>
                      commitItems(
                        items.map((it) =>
                          it.id === item.id && it.kind === "card"
                            ? { ...it, view: { ...it.view, span } }
                            : it,
                        ),
                      )
                    }
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
