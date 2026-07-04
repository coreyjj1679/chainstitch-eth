"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Instance mode + current user + workspace role. Stable per session. */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    staleTime: 60_000,
  });
}

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: api.projects.list });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => api.projects.get(id),
    enabled: !!id,
  });
}

export function useContracts(projectId: string) {
  return useQuery({
    queryKey: ["contracts", projectId],
    queryFn: () => api.contracts.list(projectId),
    enabled: !!projectId,
  });
}

export function useNotebooks(projectId: string) {
  return useQuery({
    queryKey: ["notebooks", projectId],
    queryFn: () => api.notebooks.list(projectId),
    enabled: !!projectId,
  });
}

export function useRecipes(projectId: string) {
  return useQuery({
    queryKey: ["recipes", projectId],
    queryFn: () => api.recipes.list(projectId),
    enabled: !!projectId,
  });
}

export function useStateViews(projectId: string) {
  return useQuery({
    queryKey: ["stateViews", projectId],
    queryFn: () => api.stateViews.list(projectId),
    enabled: !!projectId,
  });
}
