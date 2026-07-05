import type {
  ContractEntry,
  InviteInfo,
  Me,
  MemberInfo,
  NotebookBlock,
  NotebookMeta,
  Project,
  ProjectAccess,
  Recipe,
  ShareLink,
  StateLayout,
  WorkspaceRole,
} from "@/lib/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    // Session expired mid-use (team mode): bounce to the login page.
    if (
      res.status === 401 &&
      typeof window !== "undefined" &&
      window.location.pathname !== "/login"
    ) {
      window.location.href = "/login";
    }
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  me: () => request<Me>("/api/me"),
  workspace: {
    members: () => request<MemberInfo[]>("/api/workspace/members"),
    updateMemberRole: (id: string, role: WorkspaceRole) =>
      request(`/api/workspace/members/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    removeMember: (id: string) =>
      request(`/api/workspace/members/${id}`, { method: "DELETE" }),
    invites: () => request<InviteInfo[]>("/api/workspace/invites"),
    createInvite: (wallet: string, role: WorkspaceRole, projectId?: string | null) =>
      request<InviteInfo>("/api/workspace/invites", {
        method: "POST",
        body: JSON.stringify({ wallet, role, projectId: projectId ?? null }),
      }),
    revokeInvite: (id: string) =>
      request(`/api/workspace/invites/${id}`, { method: "DELETE" }),
    removeGrant: (id: string) =>
      request(`/api/workspace/grants/${id}`, { method: "DELETE" }),
  },
  projects: {
    list: () => request<Project[]>("/api/projects"),
    get: (id: string) => request<Project>(`/api/projects/${id}`),
    access: (id: string) => request<ProjectAccess>(`/api/projects/${id}/access`),
    shareLink: {
      get: (id: string) => request<ShareLink | null>(`/api/projects/${id}/share-link`),
      set: (id: string, role: WorkspaceRole, reset = false) =>
        request<ShareLink>(`/api/projects/${id}/share-link`, {
          method: "PUT",
          body: JSON.stringify({ role, reset }),
        }),
      disable: (id: string) =>
        request(`/api/projects/${id}/share-link`, { method: "DELETE" }),
    },
    create: (data: {
      name: string;
      chainId: number;
      rpcUrl: string;
      explorerUrl?: string;
    }) => request<Project>("/api/projects", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Omit<Project, "id" | "createdAt">>) =>
      request<Project>(`/api/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    remove: (id: string) => request(`/api/projects/${id}`, { method: "DELETE" }),
  },
  contracts: {
    list: (projectId: string) =>
      request<ContractEntry[]>(`/api/projects/${projectId}/contracts`),
    create: (
      projectId: string,
      data: { name: string; address: string; abi: unknown },
    ) =>
      request<ContractEntry>(`/api/projects/${projectId}/contracts`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (
      id: string,
      data: Partial<{ name: string; address: string; abi: unknown }>,
    ) =>
      request<ContractEntry>(`/api/contracts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    remove: (id: string) => request(`/api/contracts/${id}`, { method: "DELETE" }),
  },
  notebooks: {
    list: (projectId: string) =>
      request<NotebookMeta[]>(`/api/projects/${projectId}/notebooks`),
    get: (id: string) =>
      request<NotebookMeta & { blocks: NotebookBlock[] }>(`/api/notebooks/${id}`),
    create: (projectId: string, data: { title: string; description?: string }) =>
      request<NotebookMeta>(`/api/projects/${projectId}/notebooks`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<{ title: string; description: string }>) =>
      request<NotebookMeta>(`/api/notebooks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    remove: (id: string) => request(`/api/notebooks/${id}`, { method: "DELETE" }),
    saveBlocks: (id: string, blocks: NotebookBlock[]) =>
      request(`/api/notebooks/${id}/blocks`, {
        method: "PUT",
        body: JSON.stringify({ blocks }),
      }),
    /** Persisted run output (BigInt-safe JSON string, opaque to the server). */
    getRunState: (id: string) =>
      request<{ state: string | null }>(`/api/notebooks/${id}/run-state`),
    saveRunState: (id: string, state: string) =>
      request(`/api/notebooks/${id}/run-state`, {
        method: "PUT",
        body: JSON.stringify({ state }),
      }),
    clearRunState: (id: string) =>
      request(`/api/notebooks/${id}/run-state`, { method: "DELETE" }),
  },
  recipes: {
    list: (projectId: string) => request<Recipe[]>(`/api/projects/${projectId}/recipes`),
    get: (id: string) => request<Recipe>(`/api/recipes/${id}`),
    create: (
      projectId: string,
      data: { name: string; description?: string; blocks: NotebookBlock[] },
    ) =>
      request<Recipe>(`/api/projects/${projectId}/recipes`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (
      id: string,
      data: Partial<{ name: string; description: string; blocks: NotebookBlock[] }>,
    ) =>
      request<Recipe>(`/api/recipes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    remove: (id: string) => request(`/api/recipes/${id}`, { method: "DELETE" }),
  },
  stateViews: {
    list: (projectId: string) =>
      request<StateLayout>(`/api/projects/${projectId}/state-views`),
    save: (
      projectId: string,
      views: Array<{
        id?: string;
        contractId: string;
        functions: string[];
        position?: number;
        span?: number;
      }>,
      titles: Array<{ id?: string; text: string; position?: number }> = [],
    ) =>
      request(`/api/projects/${projectId}/state-views`, {
        method: "PUT",
        body: JSON.stringify({ views, titles }),
      }),
  },
};
