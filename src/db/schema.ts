import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Auth tables (Better Auth + SIWE plugin).
// Property names must match Better Auth's camelCase field names — the Drizzle
// adapter resolves fields by property name on these table objects.
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** SIWE plugin: wallets linked to a user (address is checksummed). */
export const walletAddress = sqliteTable(
  "wallet_address",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    chainId: integer("chain_id").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" }).default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("wallet_address_user_id_idx").on(t.userId),
    index("wallet_address_address_idx").on(t.address),
  ],
);

/**
 * Personal API tokens for headless agents (MCP) in team mode. The plaintext
 * token is shown once at creation; only a SHA-256 hash is stored. A token
 * inherits its owner's workspace + project roles — no separate scopes.
 */
export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Short label chosen by the user ("Cursor laptop", …). */
    name: text("name").notNull(),
    /** Leading chars of the token for list display (`cst_a1b2c3d4`). */
    tokenPrefix: text("token_prefix").notNull(),
    /** SHA-256 hex digest of the full `cst_…` token. */
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("api_tokens_hash_uq").on(t.tokenHash),
    index("api_tokens_user_id_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Workspaces & sharing.
// v1 runs a single shared workspace per instance (id "default"); the schema
// supports many so per-user/personal workspaces can land later without a
// migration.
// ---------------------------------------------------------------------------

export type WorkspaceRole = "viewer" | "editor" | "owner";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<WorkspaceRole>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("workspace_members_ws_user_uq").on(t.workspaceId, t.userId)],
);

/**
 * Wallet-address invites. No email delivery involved: a pending invite is
 * claimed automatically when that address completes a SIWE login (or
 * immediately, when a user with that wallet already exists).
 */
export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Wallet address, stored lowercase */
    wallet: text("wallet").notNull(),
    role: text("role").$type<WorkspaceRole>().notNull(),
    /**
     * null: workspace-wide membership (every project, the classic invite).
     * set: access to that single project only (claimed into project_members).
     */
    projectId: text("project_id"),
    invitedBy: text("invited_by"),
    status: text("status").$type<"pending" | "accepted" | "revoked">().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("invites_wallet_idx").on(t.wallet)],
);

/**
 * Per-project access grants, overlaying workspace membership: a user's
 * effective role on a project is the higher of their workspace role and
 * their grant here. Lets owners share one project without opening the
 * whole workspace (project-scoped invites land in this table).
 */
export const projectMembers = sqliteTable(
  "project_members",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<WorkspaceRole>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("project_members_proj_user_uq").on(t.projectId, t.userId)],
);

/**
 * "Anyone with the link" sharing: one secret token per project. Whoever
 * presents the token (via the share cookie) gets the stored role on that
 * project — viewer or editor, never owner. Deleting the row (or rotating
 * the token) kills every link that was handed out.
 */
export const projectShareLinks = sqliteTable(
  "project_share_links",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    role: text("role").$type<WorkspaceRole>().notNull(),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("project_share_links_project_uq").on(t.projectId),
    uniqueIndex("project_share_links_token_uq").on(t.token),
  ],
);

// ---------------------------------------------------------------------------
// Core content tables.
// ---------------------------------------------------------------------------

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  chainId: integer("chain_id").notNull(),
  rpcUrl: text("rpc_url").notNull(),
  explorerUrl: text("explorer_url"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const contracts = sqliteTable("contracts", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  address: text("address").notNull(),
  abi: text("abi").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const notebooks = sqliteTable("notebooks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  /** Sidebar list order within the project (drag-to-reorder). */
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const blocks = sqliteTable("blocks", {
  id: text("id").primaryKey(),
  notebookId: text("notebook_id")
    .notNull()
    .references(() => notebooks.id, { onDelete: "cascade" }),
  order: integer("order").notNull(),
  type: text("type").notNull(),
  config: text("config").notNull(),
  outputVariable: text("output_variable"),
  parentId: text("parent_id"),
  /** Optional "run when" guard condition (see lib/condition.ts). */
  runWhen: text("run_when"),
});

/**
 * Reusable named block groups ("recipes"), scoped to a project (block configs
 * reference the project's address book). Stored as one JSON array of block
 * definitions — recipes are atomic payloads, inserted as editable copies.
 */
export const recipes = sqliteTable("recipes", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  blocks: text("blocks").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Jupyter-style persisted run output per notebook: one JSON blob with
 * results, per-block history and the execution counter (BigInt-safe encoding).
 */
export const notebookRunState = sqliteTable("notebook_run_state", {
  notebookId: text("notebook_id")
    .primaryKey()
    .references(() => notebooks.id, { onDelete: "cascade" }),
  state: text("state").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Google-Docs-style edit history: full content snapshots (title, description,
 * block list as one JSON array) recorded on every save. Consecutive saves by
 * the same editor within a short window coalesce into one version (an
 * "editing session"); restores append a new version instead of rewinding.
 */
export const notebookVersions = sqliteTable(
  "notebook_versions",
  {
    id: text("id").primaryKey(),
    notebookId: text("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    /** Who made the edits; null for the pre-history baseline snapshot. */
    editorId: text("editor_id"),
    title: text("title").notNull(),
    description: text("description"),
    blocks: text("blocks").notNull(),
    /** Set when this version was created by restoring an older one. */
    restoredFrom: text("restored_from"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    /** Last coalesced save in this editing session (display timestamp). */
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("notebook_versions_notebook_idx").on(t.notebookId)],
);

/**
 * Saved "Run all" outputs: one immutable record per completed run-all pass,
 * with per-block entries (label + result) as one BigInt-safe JSON blob the
 * server never parses. Summary counters are split out for cheap listing.
 */
export const notebookRuns = sqliteTable(
  "notebook_runs",
  {
    id: text("id").primaryKey(),
    notebookId: text("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    ranBy: text("ran_by"),
    /** True for "Simulate all" passes (writes eth_call'd, nothing sent). */
    simulated: integer("simulated", { mode: "boolean" }).notNull().default(false),
    succeeded: integer("succeeded").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    state: text("state").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("notebook_runs_notebook_idx").on(t.notebookId)],
);

export const stateViews = sqliteTable("state_views", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  contractId: text("contract_id")
    .notNull()
    .references(() => contracts.id, { onDelete: "cascade" }),
  functions: text("functions").notNull(),
  /** Order on the state dashboard (shared sequence with state_titles). */
  position: integer("position").notNull().default(0),
  /** Card width in grid columns (1–4) on the state dashboard. */
  span: integer("span").notNull().default(2),
});

/** Section headings interleaved between cards on the state dashboard. */
export const stateTitles = sqliteTable("state_titles", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  position: integer("position").notNull().default(0),
});
