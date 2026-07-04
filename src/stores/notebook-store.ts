"use client";

import { create } from "zustand";
import { constantScope, isBlockConfigured, isGroupType } from "@/lib/block-label";
import type {
  BlockConfig,
  BlockResult,
  BlockType,
  NotebookBlock,
  NotebookRunState,
} from "@/lib/types";

/** Cap on stored past runs per block (Jupyter-style output history). */
export const MAX_HISTORY = 20;

function defaultConfig(type: BlockType): BlockConfig {
  switch (type) {
    case "read":
    case "write":
      return { contractId: "", functionName: "", args: [] };
    case "rpc":
      return { method: "getBlockNumber", params: [] };
    case "markdown":
      return { text: "" };
    case "sender":
      return { address: "", simulateOnly: true };
    case "variable":
      return { name: "", value: "" };
    case "if":
      return { condition: "" };
    case "recipe":
      return { recipeId: "" };
  }
}

interface NotebookState {
  notebookId: string | null;
  blocks: NotebookBlock[];
  results: Record<string, BlockResult>;
  /** Newest-first past results per block (bounded by MAX_HISTORY) */
  history: Record<string, BlockResult[]>;
  /** Variable scope shared across the notebook run (Jupyter-style kernel state). */
  scope: Record<string, unknown>;
  /** Jupyter-style execution counter (In [n]) */
  execCounter: number;
  /** Per-block edit mode (expanded form vs collapsed summary) */
  editing: Record<string, boolean>;
  /** Global "show tx details on every result" toggle */
  showDetails: boolean;
  dirty: boolean;
  /** Results/history changed since the last run-state save. */
  runDirty: boolean;
  /** Bumped on every run-state change; guards autosave against races. */
  runRevision: number;
  /** Viewer role: block edits are disabled, running is still allowed. */
  readOnly: boolean;

  initialize: (notebookId: string, blocks: NotebookBlock[]) => void;
  /** Restore persisted results/history/counter (Jupyter-style saved outputs). */
  hydrateRunState: (notebookId: string, runState: NotebookRunState) => void;
  setReadOnly: (readOnly: boolean) => void;
  addBlock: (type: BlockType, afterId?: string) => string;
  insertBlockAt: (type: BlockType, index: number) => string;
  /**
   * Insert deep copies of `blocks` (e.g. a recipe payload) at `index`,
   * re-minting ids and remapping parent links. Returns the new ids.
   */
  insertBlocksAt: (
    blocks: NotebookBlock[],
    index: number,
    parentId?: string | null,
  ) => string[];
  /** Append a block inside a sender group */
  addBlockToGroup: (type: BlockType, parentId: string) => string;
  /** Duplicate a block (and, for sender groups, its children) right below it */
  duplicateBlock: (id: string) => string | null;
  setEditing: (id: string, editing: boolean) => void;
  /** Expand/collapse every non-markdown block at once */
  setAllEditing: (editing: boolean) => void;
  toggleShowDetails: () => void;
  updateBlockConfig: (id: string, config: Partial<BlockConfig>) => void;
  setOutputVariable: (id: string, name: string | null) => void;
  /** Set/clear a block's "run when" guard condition. */
  setRunWhen: (id: string, condition: string | null) => void;
  removeBlock: (id: string) => void;
  /** Move a block before `overId` (or to the end) and into `parentId` (null = top level) */
  moveBlockTo: (activeId: string, parentId: string | null, overId: string | null) => void;
  setResult: (id: string, result: BlockResult) => void;
  setScopeVariable: (name: string, value: unknown) => void;
  /** Fresh results/scope for a run-all pass; history and counter continue. */
  beginRunAll: () => void;
  resetRun: () => void;
  markSaved: () => void;
  /** Clear runDirty only if nothing changed since `revision` was captured. */
  markRunSaved: (revision: number) => void;
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  notebookId: null,
  blocks: [],
  results: {},
  history: {},
  scope: {},
  execCounter: 0,
  editing: {},
  showDetails: false,
  dirty: false,
  runDirty: false,
  runRevision: 0,
  readOnly: false,

  initialize: (notebookId, blocks) =>
    set((state) => ({
      notebookId,
      blocks,
      results: {},
      history: {},
      // Constants are always available in scope, before anything runs.
      scope: constantScope(blocks),
      execCounter: 0,
      // Unconfigured (new/incomplete) blocks open in edit mode
      editing: state.readOnly
        ? {}
        : Object.fromEntries(blocks.map((b) => [b.id, !isBlockConfigured(b)])),
      dirty: false,
      runDirty: false,
    })),

  hydrateRunState: (notebookId, runState) =>
    set((state) => {
      if (state.notebookId !== notebookId) return state;
      const blockIds = new Set(state.blocks.map((b) => b.id));
      const results: Record<string, BlockResult> = {};
      for (const [id, result] of Object.entries(runState.results ?? {})) {
        // Drop results of deleted blocks and never restore a stuck "running".
        if (blockIds.has(id) && result.status !== "running") results[id] = result;
      }
      const history: Record<string, BlockResult[]> = {};
      for (const [id, list] of Object.entries(runState.history ?? {})) {
        if (blockIds.has(id) && Array.isArray(list) && list.length > 0) {
          history[id] = list.slice(0, MAX_HISTORY);
        }
      }
      // Anything already run in this session wins over the saved snapshot.
      for (const [id, result] of Object.entries(state.results)) {
        results[id] = result;
      }
      for (const [id, list] of Object.entries(state.history)) {
        history[id] = [...list, ...(history[id] ?? [])].slice(0, MAX_HISTORY);
      }
      // Saved outputs feed their variables back into scope (constants win).
      const scope: Record<string, unknown> = {};
      for (const block of state.blocks) {
        const result = results[block.id];
        if (block.outputVariable && result?.status === "success") {
          scope[block.outputVariable] = result.value;
        }
      }
      return {
        results,
        history,
        scope: { ...scope, ...state.scope },
        execCounter: Math.max(
          state.execCounter,
          Math.trunc(runState.execCounter ?? 0) || 0,
        ),
        // Re-arm the autosave effect; runDirty stays true if a pre-hydration
        // run is still waiting to be persisted.
        runRevision: state.runRevision + 1,
      };
    }),

  setReadOnly: (readOnly) =>
    set((state) => ({
      readOnly,
      // Entering read-only collapses any open editors; nothing may stay editable.
      editing: readOnly ? {} : state.editing,
      dirty: readOnly ? false : state.dirty,
    })),

  addBlock: (type, afterId) => {
    if (get().readOnly) return "";
    const id = crypto.randomUUID();
    const blocks = [...get().blocks];
    const after = afterId ? blocks.find((b) => b.id === afterId) : undefined;
    const block: NotebookBlock = {
      id,
      type,
      config: defaultConfig(type),
      outputVariable: null,
      // Stay in the same group as the anchor block (groups are top-level only)
      parentId: isGroupType(type) ? null : (after?.parentId ?? null),
    };
    const index = after ? blocks.indexOf(after) : -1;
    if (index >= 0) blocks.splice(index + 1, 0, block);
    else blocks.push(block);
    set((state) => ({
      blocks,
      editing: { ...state.editing, [id]: true },
      dirty: true,
    }));
    return id;
  },

  insertBlockAt: (type, index) => {
    if (get().readOnly) return "";
    const id = crypto.randomUUID();
    const block: NotebookBlock = {
      id,
      type,
      config: defaultConfig(type),
      outputVariable: null,
      parentId: null,
    };
    const blocks = [...get().blocks];
    blocks.splice(Math.max(0, Math.min(index, blocks.length)), 0, block);
    set((state) => ({
      blocks,
      editing: { ...state.editing, [id]: true },
      dirty: true,
    }));
    return id;
  },

  insertBlocksAt: (incoming, index, parentId = null) => {
    if (get().readOnly || incoming.length === 0) return [];
    const idMap = new Map<string, string>();
    for (const b of incoming) idMap.set(b.id, crypto.randomUUID());
    const copies: NotebookBlock[] = incoming.map((b) => ({
      id: idMap.get(b.id)!,
      type: b.type,
      config: JSON.parse(JSON.stringify(b.config)) as BlockConfig,
      outputVariable: b.outputVariable ?? null,
      // Internal parent links follow the copies; loose blocks land in the
      // target group (groups themselves stay top-level, they never nest).
      parentId: b.parentId
        ? (idMap.get(b.parentId) ?? null)
        : isGroupType(b.type)
          ? null
          : parentId,
      runWhen: b.runWhen ?? null,
    }));
    const blocks = [...get().blocks];
    blocks.splice(Math.max(0, Math.min(index, blocks.length)), 0, ...copies);
    set((state) => ({
      blocks,
      scope: { ...state.scope, ...constantScope(blocks) },
      editing: {
        ...state.editing,
        ...Object.fromEntries(copies.map((c) => [c.id, false])),
      },
      dirty: true,
    }));
    return copies.map((c) => c.id);
  },

  addBlockToGroup: (type, parentId) => {
    if (get().readOnly) return "";
    const id = crypto.randomUUID();
    const block: NotebookBlock = {
      id,
      type,
      config: defaultConfig(type),
      outputVariable: null,
      parentId: isGroupType(type) ? null : parentId,
    };
    set((state) => ({
      blocks: [...state.blocks, block],
      editing: { ...state.editing, [id]: true },
      dirty: true,
    }));
    return id;
  },

  duplicateBlock: (id) => {
    const state = get();
    if (state.readOnly) return null;
    const original = state.blocks.find((b) => b.id === id);
    if (!original) return null;
    const blocks = [...state.blocks];
    const newId = crypto.randomUUID();
    const copy: NotebookBlock = {
      ...original,
      id: newId,
      config: JSON.parse(JSON.stringify(original.config)) as BlockConfig,
    };

    if (isGroupType(original.type)) {
      // Duplicate the group and all of its children, inserted contiguously.
      const children = blocks.filter((b) => b.parentId === original.id);
      const clonedChildren = children.map((child) => ({
        ...child,
        id: crypto.randomUUID(),
        parentId: newId,
        config: JSON.parse(JSON.stringify(child.config)) as BlockConfig,
      }));
      const lastIndex = children.length
        ? blocks.indexOf(children[children.length - 1])
        : blocks.indexOf(original);
      blocks.splice(lastIndex + 1, 0, copy, ...clonedChildren);
    } else {
      blocks.splice(blocks.indexOf(original) + 1, 0, copy);
    }

    set((s) => ({ blocks, editing: { ...s.editing, [newId]: false }, dirty: true }));
    return newId;
  },

  setEditing: (id, editing) =>
    set((state) =>
      state.readOnly && editing
        ? state
        : { editing: { ...state.editing, [id]: editing } },
    ),

  setAllEditing: (editing) =>
    set((state) => (state.readOnly && editing ? state : {
      editing: Object.fromEntries(
        state.blocks.map((b) => [
          b.id,
          // Markdown stays rendered on "expand all"; collapse applies to all
          b.type === "markdown" ? (editing ? (state.editing[b.id] ?? false) : false) : editing,
        ]),
      ),
    })),

  updateBlockConfig: (id, config) =>
    set((state) => {
      if (state.readOnly) return state;
      const blocks = state.blocks.map((b) =>
        b.id === id ? { ...b, config: { ...b.config, ...config } as BlockConfig } : b,
      );
      const edited = blocks.find((b) => b.id === id);
      // Keep constants live in scope as they are edited (run outputs are preserved).
      const scope =
        edited?.type === "variable"
          ? { ...state.scope, ...constantScope(blocks) }
          : state.scope;
      return { blocks, scope, dirty: true };
    }),

  setOutputVariable: (id, name) =>
    set((state) =>
      state.readOnly
        ? state
        : {
            blocks: state.blocks.map((b) =>
              b.id === id ? { ...b, outputVariable: name } : b,
            ),
            dirty: true,
          },
    ),

  setRunWhen: (id, condition) =>
    set((state) =>
      state.readOnly
        ? state
        : {
            blocks: state.blocks.map((b) =>
              b.id === id ? { ...b, runWhen: condition } : b,
            ),
            dirty: true,
          },
    ),

  toggleShowDetails: () => set((state) => ({ showDetails: !state.showDetails })),

  removeBlock: (id) =>
    set((state) => {
      if (state.readOnly) return state;
      const results = { ...state.results };
      delete results[id];
      const history = { ...state.history };
      delete history[id];
      const editing = { ...state.editing };
      delete editing[id];
      return {
        blocks: state.blocks
          .filter((b) => b.id !== id)
          // Deleting a sender group promotes its children to the top level
          .map((b) => (b.parentId === id ? { ...b, parentId: null } : b)),
        results,
        history,
        editing,
        dirty: true,
        runDirty: true,
        runRevision: state.runRevision + 1,
      };
    }),

  moveBlockTo: (activeId, parentId, overId) =>
    set((state) => {
      if (state.readOnly) return state;
      const blocks = [...state.blocks];
      const from = blocks.findIndex((b) => b.id === activeId);
      if (from < 0) return state;
      const [moved] = blocks.splice(from, 1);
      const updated: NotebookBlock = {
        ...moved,
        // groups can't nest
        parentId: isGroupType(moved.type) ? null : parentId,
      };
      const to = overId ? blocks.findIndex((b) => b.id === overId) : -1;
      if (to >= 0) blocks.splice(to, 0, updated);
      else blocks.push(updated);
      return { blocks, dirty: true };
    }),

  setResult: (id, result) =>
    set((state) => {
      const finished = result.status === "success" || result.status === "error";
      // Skipped blocks (false condition) persist but never count as executions:
      // no exec index, no history entry.
      const skipped = result.status === "skipped";
      const execCounter = finished ? state.execCounter + 1 : state.execCounter;
      const stored = finished ? { ...result, execIndex: execCounter } : result;
      // Finished runs are prepended to the block's history (newest first).
      const history = finished
        ? {
            ...state.history,
            [id]: [stored, ...(state.history[id] ?? [])].slice(0, MAX_HISTORY),
          }
        : state.history;
      return {
        results: { ...state.results, [id]: stored },
        history,
        execCounter,
        runDirty: finished || skipped ? true : state.runDirty,
        runRevision: finished || skipped ? state.runRevision + 1 : state.runRevision,
      };
    }),

  setScopeVariable: (name, value) =>
    set((state) => ({ scope: { ...state.scope, [name]: value } })),

  // Jupyter "Run all": outputs restart, but In[n] keeps counting and past
  // outputs stay in each block's history.
  beginRunAll: () =>
    set((state) => ({
      results: {},
      scope: constantScope(state.blocks),
      runDirty: true,
      runRevision: state.runRevision + 1,
    })),

  // Full reset (Jupyter "restart kernel & clear output"): results, history
  // and the execution counter all go; declared constants stay available.
  resetRun: () =>
    set((state) => ({
      results: {},
      history: {},
      scope: constantScope(state.blocks),
      execCounter: 0,
      runDirty: true,
      runRevision: state.runRevision + 1,
    })),

  markSaved: () => set({ dirty: false }),
  markRunSaved: (revision) =>
    set((state) => (state.runRevision === revision ? { runDirty: false } : state)),
}));
