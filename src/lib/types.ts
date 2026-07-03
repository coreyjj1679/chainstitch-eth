import type { Abi } from "viem";

export type BlockType =
  | "read"
  | "write"
  | "rpc"
  | "markdown"
  | "sender"
  | "variable";

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

export type BlockConfig =
  | CallConfig
  | RpcConfig
  | MarkdownConfig
  | SenderConfig
  | VariableConfig;

export interface NotebookBlock {
  id: string;
  type: BlockType;
  config: BlockConfig;
  outputVariable: string | null;
  /** id of the sender group this block lives in (one level deep), or null */
  parentId?: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string | null;
  createdAt: number;
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
  /** Role in the workspace; null when signed in but no longer a member. */
  role: WorkspaceRole | null;
  workspace: { id: string; name: string };
}

export interface MemberInfo {
  id: string;
  userId: string;
  name: string;
  role: WorkspaceRole;
  wallets: string[];
  joinedAt: number;
}

export interface InviteInfo {
  id: string;
  wallet: string;
  role: WorkspaceRole;
  status: "pending" | "accepted";
  createdAt: number;
}

export type BlockRunStatus = "idle" | "running" | "success" | "error";

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
