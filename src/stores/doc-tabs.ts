"use client";

import { useSyncExternalStore } from "react";

/**
 * Browser-style document tabs, per project. Purely a navigation layer:
 * a tab is a pointer to a notebook or recipe route — the editor still
 * loads one document at a time. Persisted in localStorage so the open
 * set survives reloads (and syncs across browser tabs via the storage
 * event); the server never knows about it.
 */
export interface DocTab {
  kind: "notebook" | "recipe";
  id: string;
}

export function sameTab(a: DocTab, b: DocTab): boolean {
  return a.kind === b.kind && a.id === b.id;
}

const listeners = new Set<() => void>();
const storageKey = (projectId: string) => `cn-doc-tabs-${projectId}`;

const EMPTY: DocTab[] = [];

// getSnapshot must return a referentially stable value while storage is
// unchanged, or useSyncExternalStore loops — cache per raw JSON string.
let cacheKey = "";
let cacheRaw: string | null = null;
let cacheValue: DocTab[] = EMPTY;

function readTabs(projectId: string): DocTab[] {
  const raw = localStorage.getItem(storageKey(projectId));
  if (raw === null) return EMPTY;
  if (cacheKey === projectId && cacheRaw === raw) return cacheValue;
  let value: DocTab[] = EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      value = parsed.filter(
        (t): t is DocTab =>
          typeof t === "object" &&
          t !== null &&
          ((t as DocTab).kind === "notebook" || (t as DocTab).kind === "recipe") &&
          typeof (t as DocTab).id === "string",
      );
    }
  } catch {
    // Corrupt storage: treat as no tabs.
  }
  cacheKey = projectId;
  cacheRaw = raw;
  cacheValue = value;
  return value;
}

function writeTabs(projectId: string, tabs: DocTab[]) {
  localStorage.setItem(storageKey(projectId), JSON.stringify(tabs));
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  // Keep multiple browser tabs of the same project in sync.
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

/** The project's open tabs, in order. */
export function useDocTabs(projectId: string): DocTab[] {
  return useSyncExternalStore(
    subscribe,
    () => readTabs(projectId),
    () => EMPTY,
  );
}

/** Add a tab at the end (no-op when it's already open). */
export function openDocTab(projectId: string, tab: DocTab) {
  const tabs = readTabs(projectId);
  if (tabs.some((t) => sameTab(t, tab))) return;
  writeTabs(projectId, [...tabs, tab]);
}

/** Remove a tab; returns the remaining list (for pick-a-neighbor logic). */
export function closeDocTab(projectId: string, tab: DocTab): DocTab[] {
  const tabs = readTabs(projectId).filter((t) => !sameTab(t, tab));
  writeTabs(projectId, tabs);
  return tabs;
}

/** Drop tabs whose documents no longer exist (after deletes). */
export function pruneDocTabs(projectId: string, keep: (tab: DocTab) => boolean) {
  const tabs = readTabs(projectId);
  const kept = tabs.filter(keep);
  if (kept.length !== tabs.length) writeTabs(projectId, kept);
}

/** Move a tab to a new position (drag-to-reorder). */
export function reorderDocTabs(projectId: string, from: number, to: number) {
  const tabs = [...readTabs(projectId)];
  if (from === to || from < 0 || to < 0 || from >= tabs.length || to >= tabs.length)
    return;
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved);
  writeTabs(projectId, tabs);
}
