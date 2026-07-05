import type { Abi } from "viem";

export type BlockType =
  | "read"
  | "write"
  | "rpc"
  | "markdown"
  | "sender"
  | "variable"
  | "if"
  | "recipe";

export interface CallConfig {
  contractId: string;
  functionName: string;
  args: string[];
  /** ETH value for payable writes, in wei (supports {{var}}) */
  value?: string;
}

export interface RpcConfig {
  method: string;
  params: string[];
}

export interface MarkdownConfig {
  text: string;
}

/** Group cell: child blocks run with this caller override. */
export interface SenderConfig {
  address: string;
  /**
   * true (default): the override only applies in Simulate mode.
   * false: real runs also use it, via anvil impersonation (local forks).
   */
  simulateOnly?: boolean;
}

/** A named constant (address, number, string) reusable via {{name}}. */
export interface VariableConfig {
  name: string;
  value: string;
}

/**
 * Group cell: child blocks run only when the condition holds, e.g.
 * `{{allowance}} < {{amount}}` (see lib/condition.ts for the grammar).
 */
export interface IfConfig {
  condition: string;
}

/**
 * A cell that references a saved recipe and reruns all of its steps in
 * sequence — the linked counterpart to pasting a recipe as editable blocks.
 */
export interface RecipeBlockConfig {
  recipeId: string;
}

export type BlockConfig =
  | CallConfig
  | RpcConfig
  | MarkdownConfig
  | SenderConfig
  | VariableConfig
  | IfConfig
  | RecipeBlockConfig;

export interface NotebookBlock {
  id: string;
  type: BlockType;
  config: BlockConfig;
  outputVariable: string | null;
  /** id of the group this block lives in (one level deep), or null */
  parentId?: string | null;
  /**
   * Optional guard for read/write/rpc blocks: during batch runs the block is
   * skipped unless this condition holds (same grammar as condition groups).
   */
  runWhen?: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string | null;
  createdAt: number;
  /** The caller's effective role on this project (workspace role or grant). */
  role: WorkspaceRole;
}

export interface ContractEntry {
  id: string;
  projectId: string;
  name: string;
  address: string;
  abi: Abi;
  createdAt: number;
}

export interface NotebookMeta {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

/** A named, reusable group of block definitions, scoped to a project. */
export interface Recipe {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  blocks: NotebookBlock[];
  createdAt: number;
  updatedAt: number;
  /** Distinct notebooks with a linked cell for this recipe (list/get only). */
  usedIn?: number;
}

/** Server ABI lookup result (verified-source explorers, per project chain). */
export interface AbiLookupResult {
  found: boolean;
  /** Which explorer produced the hit. */
  source?: "etherscan" | "sourcify" | "blockscout";
  name?: string;
  abi?: Abi;
  /**
   * Proxy hint: the implementation behind `address`, resolved one level when
   * the explorer reports it (Etherscan/Blockscout). `abi` is then the
   * implementation ABI when it could be fetched.
   */
  implementation?: { address: string; name?: string; abiResolved: boolean } | null;
  /** Sources that were actually queried, in order. */
  tried: string[];
  /** False when ETHERSCAN_API_KEY is unset — the UI can hint about coverage. */
  etherscanConfigured: boolean;
}

export interface StateViewEntry {
  id: string;
  projectId: string;
  contractId: string;
  functions: string[];
  /** Order on the state dashboard (shared sequence with titles). */
  position: number;
  /** Card width in grid columns (1–4). */
  span: number;
}

/** Section heading interleaved between cards on the state dashboard. */
export interface StateTitleEntry {
  id: string;
  projectId: string;
  text: string;
  position: number;
}

export interface StateLayout {
  views: StateViewEntry[];
  titles: StateTitleEntry[];
}

export type AppMode = "local" | "team";
export type WorkspaceRole = "viewer" | "editor" | "owner";

export interface Me {
  mode: AppMode;
  user: { id: string; name: string; wallets: string[] };
  /** Workspace-wide role; null for project-only members. */
  role: WorkspaceRole | null;
  /** Per-project grants (projectId → role) overlaying the workspace role. */
  projectRoles: Record<string, WorkspaceRole>;
  workspace: { id: string; name: string };
}

/** One per-project access grant, as listed in the members dialog. */
export interface ProjectGrantInfo {
  id: string;
  projectId: string;
  projectName: string;
  role: WorkspaceRole;
}

export interface MemberInfo {
  /** workspace membership id; null for users who only hold project grants. */
  id: string | null;
  userId: string;
  name: string;
  /** Workspace-wide role; null for project-only members. */
  role: WorkspaceRole | null;
  wallets: string[];
  joinedAt: number;
  grants: ProjectGrantInfo[];
}

export interface InviteInfo {
  id: string;
  wallet: string;
  role: WorkspaceRole;
  /** Set when the invite grants a single project instead of the workspace. */
  projectId: string | null;
  projectName: string | null;
  status: "pending" | "accepted";
  createdAt: number;
}

/** "Anyone with the link" state for one project (owners only). */
export interface ShareLink {
  token: string;
  role: WorkspaceRole;
  createdAt: number;
}

/** Share dialog: everyone with access to one project, plus pending invites. */
export interface ProjectAccess {
  members: Array<{
    /** project grant id — null for workspace members (managed in Members). */
    grantId: string | null;
    userId: string;
    name: string;
    wallets: string[];
    role: WorkspaceRole;
    via: "workspace" | "grant";
  }>;
  invites: InviteInfo[];
}

export type BlockRunStatus = "idle" | "running" | "success" | "error" | "skipped";

export interface BlockResult {
  status: BlockRunStatus;
  value?: unknown;
  error?: string;
  txHash?: string;
  durationMs?: number;
  ranAt?: number;
  /** Jupyter-style execution counter, assigned when a run finishes */
  execIndex?: number;
  /** True when a write block was simulated (eth_call) instead of sent */
  simulated?: boolean;
  /** What ran, e.g. "Read call (eth_call)" — shown on the Run tab */
  kind?: string;
  /** Caller (wallet / simulated sender / impersonated account) */
  sender?: string;
  /** Chain head at execution time (receipt block for real writes) */
  blockNumber?: bigint;
  /** Call details (contract, function, inputs, output) for the Call tab */
  details?: Record<string, unknown>;
  /** Transaction details (hash, status, gas, logs) for the Transaction tab */
  txDetails?: Record<string, unknown>;
}

/** Per-notebook run state persisted Jupyter-style (outputs survive reloads). */
export interface NotebookRunState {
  execCounter: number;
  results: Record<string, BlockResult>;
  /** Newest-first past results per block */
  history: Record<string, BlockResult[]>;
}
