import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import fs from "fs";
import * as schema from "./schema";

/** The single shared workspace of this instance (v1: one workspace). */
export const DEFAULT_WORKSPACE_ID = "default";
/** Implicit owner in local (no-auth) mode. */
export const LOCAL_USER_ID = "local";

// CHAINSTITCH_DB_PATH lets tests (and unusual deployments) point at another file.
const dbPath =
  process.env.CHAINSTITCH_DB_PATH ?? path.join(process.cwd(), "data", "chainstitch.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
// Parallel Next.js workers open the same file; wait instead of failing with SQLITE_BUSY.
sqlite.pragma("busy_timeout = 10000");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Zero-setup bootstrap: create tables on first run instead of requiring migrations.
sqlite.exec(`
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON session(user_id);
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON account(user_id);
CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);
CREATE TABLE IF NOT EXISTS wallet_address (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  is_primary INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wallet_address_user_id_idx ON wallet_address(user_id);
CREATE INDEX IF NOT EXISTS wallet_address_address_idx ON wallet_address(address);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_ws_user_uq
  ON workspace_members(workspace_id, user_id);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  role TEXT NOT NULL,
  invited_by TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS invites_wallet_idx ON invites(wallet);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}',
  name TEXT NOT NULL,
  description TEXT,
  chain_id INTEGER NOT NULL,
  rpc_url TEXT NOT NULL,
  explorer_url TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  abi TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notebooks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  type TEXT NOT NULL,
  config TEXT NOT NULL,
  output_variable TEXT,
  parent_id TEXT,
  run_when TEXT
);
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  blocks TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notebook_run_state (
  notebook_id TEXT PRIMARY KEY REFERENCES notebooks(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS state_views (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  functions TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  span INTEGER NOT NULL DEFAULT 2
);
CREATE TABLE IF NOT EXISTS state_titles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
`);

// Lightweight migrations for databases created before these columns existed.
function addColumn(sql: string) {
  try {
    sqlite.exec(sql);
  } catch {
    // column already exists
  }
}
addColumn("ALTER TABLE projects ADD COLUMN description TEXT");
addColumn("ALTER TABLE blocks ADD COLUMN parent_id TEXT");
addColumn("ALTER TABLE blocks ADD COLUMN run_when TEXT");
addColumn(
  `ALTER TABLE projects ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}'`,
);
addColumn("ALTER TABLE state_views ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
addColumn("ALTER TABLE state_views ADD COLUMN span INTEGER NOT NULL DEFAULT 2");

// Seed the instance workspace and the implicit local-mode owner. Idempotent;
// pre-workspace databases are adopted automatically (their projects carry the
// 'default' workspace id via the column default above).
const now = Date.now();
sqlite
  .prepare(
    "INSERT OR IGNORE INTO workspaces (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
  )
  .run(DEFAULT_WORKSPACE_ID, "Workspace", LOCAL_USER_ID, now);
sqlite
  .prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
  )
  .run(LOCAL_USER_ID, "Local", "local@chainstitch.invalid", now, now);
sqlite
  .prepare(
    "INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
  )
  .run("local-membership", DEFAULT_WORKSPACE_ID, LOCAL_USER_ID, now);

export const db = drizzle(sqlite, { schema });
export { schema };
