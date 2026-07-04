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
