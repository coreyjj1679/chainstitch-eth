import type { ContractEntry, NotebookBlock } from "@/lib/types";

/**
 * Block-level diff between two version snapshots, for the history dialog.
 * Blocks match by id (ids are stable across edits and restores); changed
 * blocks get a field-by-field before/after list.
 */

export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

export interface BlockChange {
  /** The block as it looks in the newer version. */
  block: NotebookBlock;
  changes: FieldChange[];
}

export interface VersionDiff {
  titleChange: { from: string; to: string } | null;
  descriptionChange: { from: string; to: string } | null;
  added: NotebookBlock[];
  removed: NotebookBlock[];
  changed: BlockChange[];
  /** True when only the order of otherwise-identical blocks differs. */
  reordered: boolean;
  isEmpty: boolean;
}

interface VersionContent {
  title: string;
  description: string | null;
  blocks: NotebookBlock[];
}

/** Long values (markdown bodies, arg blobs) stay readable in the dialog. */
const MAX_FIELD_CHARS = 220;

/** Human-ish rendering of one config value for the before/after rows. */
function displayField(value: unknown): string {
  let text: string;
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string") text = value;
  else if (Array.isArray(value)) {
    const items = value.map((v) => (v === "" ? "—" : String(v)));
    text = items.length > 0 ? items.join(", ") : "—";
  } else text = JSON.stringify(value);
  return text.length > MAX_FIELD_CHARS ? `${text.slice(0, MAX_FIELD_CHARS)}…` : text;
}

/** contractId fields display as the address-book name when resolvable. */
function contractName(id: unknown, contracts: ContractEntry[]): string {
  if (typeof id !== "string" || !id) return "—";
  return contracts.find((c) => c.id === id)?.name ?? id;
}

function fieldChanges(
  before: NotebookBlock,
  after: NotebookBlock,
  contracts: ContractEntry[],
): FieldChange[] {
  const changes: FieldChange[] = [];
  const beforeConfig = (before.config ?? {}) as unknown as Record<string, unknown>;
  const afterConfig = (after.config ?? {}) as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(beforeConfig), ...Object.keys(afterConfig)]);
  for (const key of keys) {
    const from = beforeConfig[key];
    const to = afterConfig[key];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    if (key === "contractId") {
      changes.push({
        field: "contract",
        from: contractName(from, contracts),
        to: contractName(to, contracts),
      });
    } else {
      changes.push({ field: key, from: displayField(from), to: displayField(to) });
    }
  }
  if ((before.outputVariable ?? null) !== (after.outputVariable ?? null)) {
    changes.push({
      field: "saves as",
      from: displayField(before.outputVariable),
      to: displayField(after.outputVariable),
    });
  }
  if ((before.runWhen ?? null) !== (after.runWhen ?? null)) {
    changes.push({
      field: "run when",
      from: displayField(before.runWhen),
      to: displayField(after.runWhen),
    });
  }
  if ((before.parentId ?? null) !== (after.parentId ?? null)) {
    // Group membership changes read as "moved into/out of a group"; the
    // dialog resolves the parent's label separately if it needs more.
    changes.push({
      field: "group",
      from: before.parentId ? "in a group" : "top level",
      to: after.parentId ? "in a group" : "top level",
    });
  }
  return changes;
}

export function diffVersions(
  prev: VersionContent,
  next: VersionContent,
  contracts: ContractEntry[],
): VersionDiff {
  const prevById = new Map(prev.blocks.map((b) => [b.id, b]));
  const nextById = new Map(next.blocks.map((b) => [b.id, b]));

  const added = next.blocks.filter((b) => !prevById.has(b.id));
  const removed = prev.blocks.filter((b) => !nextById.has(b.id));
  const changed: BlockChange[] = [];
  for (const block of next.blocks) {
    const before = prevById.get(block.id);
    if (!before) continue;
    const changes = fieldChanges(before, block, contracts);
    if (changes.length > 0) changed.push({ block, changes });
  }

  const commonPrev = prev.blocks.filter((b) => nextById.has(b.id)).map((b) => b.id);
  const commonNext = next.blocks.filter((b) => prevById.has(b.id)).map((b) => b.id);
  const reordered = commonPrev.join("\n") !== commonNext.join("\n");

  const titleChange =
    prev.title !== next.title ? { from: prev.title, to: next.title } : null;
  const prevDescription = prev.description ?? "";
  const nextDescription = next.description ?? "";
  const descriptionChange =
    prevDescription !== nextDescription
      ? { from: prevDescription || "—", to: nextDescription || "—" }
      : null;

  return {
    titleChange,
    descriptionChange,
    added,
    removed,
    changed,
    reordered,
    isEmpty:
      !titleChange &&
      !descriptionChange &&
      added.length === 0 &&
      removed.length === 0 &&
      changed.length === 0 &&
      !reordered,
  };
}
