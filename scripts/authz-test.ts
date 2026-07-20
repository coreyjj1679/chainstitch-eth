/**
 * Cross-tenant / role authorization test for the data access layer.
 * Run: npm run test:authz   (tsx --conditions=react-server, temp database)
 *
 * Verifies, without a server, that every DAL entry point enforces:
 *  - role gates (viewer < editor < owner, non-member rejected)
 *  - workspace scoping (content in another workspace 404s)
 *  - per-project grants (grant-only users see just their project; the
 *    effective role is max(workspace role, grant); invites claim correctly)
 */
import fs from "fs";
import os from "os";
import path from "path";

process.env.CHAINSTITCH_DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "chainstitch-authz-")),
  "test.db",
);
process.env.APP_MODE = "team";
process.env.BETTER_AUTH_SECRET = "authz-test-secret";
// Assertions below count projects — keep the first-boot example out.
process.env.CHAINSTITCH_SKIP_EXAMPLE_SEED = "1";

let passed = 0;
let failed = 0;

function ok(condition: unknown, label: string) {
  if (condition) {
    passed++;
    console.log(`ok: ${label}`);
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

async function expectStatus(promise: Promise<unknown>, status: number, label: string) {
  try {
    await promise;
    ok(false, `${label} (expected ${status}, got success)`);
  } catch (e) {
    const actual = (e as { status?: number }).status;
    ok(actual === status, `${label} (${actual ?? e})`);
  }
}

async function main() {
  const { eq } = await import("drizzle-orm");
  const { db, schema, DEFAULT_WORKSPACE_ID } = await import("../src/db");
  const dal = {
    projects: await import("../src/server/dal/projects"),
    contracts: await import("../src/server/dal/contracts"),
    notebooks: await import("../src/server/dal/notebooks"),
    notebookFiles: await import("../src/server/dal/notebook-files"),
    recipes: await import("../src/server/dal/recipes"),
    runs: await import("../src/server/dal/runs"),
    stateViews: await import("../src/server/dal/state-views"),
    workspace: await import("../src/server/dal/workspace"),
  };
  const abiLookup = await import("../src/server/abi-lookup");
  type Ctx = import("../src/server/auth-context").AuthContext;

  // --- Fixtures ------------------------------------------------------------
  const now = new Date();
  const mkUser = (id: string) => ({
    id,
    name: id,
    email: `${id}@test.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.user).values(["alice", "bob", "carol", "dave"].map(mkUser));
  await db.insert(schema.workspaceMembers).values([
    { id: "m-alice", workspaceId: DEFAULT_WORKSPACE_ID, userId: "alice", role: "owner", createdAt: now },
    { id: "m-bob", workspaceId: DEFAULT_WORKSPACE_ID, userId: "bob", role: "editor", createdAt: now },
    { id: "m-carol", workspaceId: DEFAULT_WORKSPACE_ID, userId: "carol", role: "viewer", createdAt: now },
  ]);
  // A second workspace with content that must stay invisible to the default one.
  await db.insert(schema.workspaces).values({
    id: "other-ws",
    name: "Other",
    createdBy: "dave",
    createdAt: now,
  });
  await db.insert(schema.projects).values({
    id: "other-project",
    workspaceId: "other-ws",
    name: "Foreign",
    description: null,
    chainId: 1,
    rpcUrl: "http://example.invalid",
    explorerUrl: null,
    createdAt: now,
  });
  await db.insert(schema.contracts).values({
    id: "other-contract",
    projectId: "other-project",
    name: "Foreign",
    address: "",
    abi: "[]",
    createdAt: now,
  });
  await db.insert(schema.notebooks).values({
    id: "other-notebook",
    projectId: "other-project",
    title: "Foreign",
    description: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.recipes).values({
    id: "other-recipe",
    projectId: "other-project",
    name: "Foreign",
    description: null,
    blocks: "[]",
    createdAt: now,
    updatedAt: now,
  });

  const owner: Ctx = {
    userId: "alice",
    workspaceId: DEFAULT_WORKSPACE_ID,
    role: "owner",
    projectRoles: {},
  };
  const editor: Ctx = {
    userId: "bob",
    workspaceId: DEFAULT_WORKSPACE_ID,
    role: "editor",
    projectRoles: {},
  };
  const viewer: Ctx = {
    userId: "carol",
    workspaceId: DEFAULT_WORKSPACE_ID,
    role: "viewer",
    projectRoles: {},
  };
  const nonMember: Ctx = {
    userId: "dave",
    workspaceId: DEFAULT_WORKSPACE_ID,
    role: null,
    projectRoles: {},
  };

  // --- Owner path ------------------------------------------------------------
  const project = await dal.projects.createProject(owner, {
    name: "Main",
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
  });
  ok(!!project.id, "owner creates a project");
  const contract = await dal.contracts.createContract(owner, project.id, {
    name: "Token",
    address: "",
    abi: [{ type: "function", name: "n", inputs: [], outputs: [], stateMutability: "view" }],
  });
  const notebook = await dal.notebooks.createNotebook(owner, project.id, { title: "NB" });
  await dal.notebooks.saveBlocks(owner, notebook.id, [
    { type: "markdown", config: { text: "hi" } },
  ]);
  ok(true, "owner creates contract/notebook/blocks");
  const recipe = await dal.recipes.createRecipe(owner, project.id, {
    name: "Approve flow",
    blocks: [{ id: "rb1", type: "read", config: { contractId: "c", functionName: "f", args: [] } }],
  });
  ok(!!recipe.id, "owner creates a recipe");

  // --- Viewer: read yes, mutate no -------------------------------------------
  ok((await dal.projects.listProjects(viewer)).length === 1, "viewer lists projects");
  ok(
    (await dal.notebooks.getNotebookWithBlocks(viewer, notebook.id)).blocks.length === 1,
    "viewer reads notebook blocks",
  );
  await expectStatus(
    dal.projects.createProject(viewer, { name: "x", chainId: 1, rpcUrl: "y" }),
    403,
    "viewer cannot create project",
  );
  await expectStatus(
    dal.contracts.createContract(viewer, project.id, { name: "x", abi: [] }),
    403,
    "viewer cannot create contract",
  );
  // ABI lookup is editor-gated like contract creation. The editor case uses
  // an invalid address on purpose: the 400 proves the role gate passed while
  // keeping the test offline (no explorer API is ever contacted).
  await expectStatus(
    abiLookup.lookupAbiForProject(
      viewer,
      project.id,
      "0x0000000000000000000000000000000000000001",
    ),
    403,
    "viewer cannot use ABI lookup",
  );
  await expectStatus(
    abiLookup.lookupAbiForProject(editor, project.id, "not-an-address"),
    400,
    "editor passes the ABI lookup gate (bad address rejected offline)",
  );
  await expectStatus(
    dal.notebooks.saveBlocks(viewer, notebook.id, []),
    403,
    "viewer cannot save blocks",
  );
  ok(
    // The project also carries the seeded tutorial recipe; check ours is there.
    (await dal.recipes.listRecipes(viewer, project.id)).some((r) => r.id === recipe.id),
    "viewer lists recipes",
  );
  await expectStatus(
    dal.recipes.createRecipe(viewer, project.id, {
      name: "x",
      blocks: [{ type: "markdown", config: { text: "hi" } }],
    }),
    403,
    "viewer cannot create recipe",
  );
  await expectStatus(
    dal.recipes.updateRecipe(viewer, recipe.id, { name: "x" }),
    403,
    "viewer cannot update recipe",
  );
  await expectStatus(
    dal.recipes.deleteRecipe(viewer, recipe.id),
    403,
    "viewer cannot delete recipe",
  );
  await expectStatus(
    dal.notebooks.saveRunState(viewer, notebook.id, "{}"),
    403,
    "viewer cannot save run state",
  );
  await expectStatus(
    dal.notebooks.clearRunState(viewer, notebook.id),
    403,
    "viewer cannot clear run state",
  );
  ok(
    (await dal.notebooks.getRunState(viewer, notebook.id)) === null,
    "viewer reads (empty) run state",
  );
  await expectStatus(
    dal.stateViews.saveStateViews(viewer, project.id, []),
    403,
    "viewer cannot save state views",
  );
  await expectStatus(
    dal.workspace.createInvite(viewer, "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", "viewer"),
    403,
    "viewer cannot invite",
  );
  await expectStatus(dal.workspace.listInvites(viewer), 403, "viewer cannot list invites");

  // --- Editor: content yes, settings/members no ------------------------------
  const editorNotebook = await dal.notebooks.createNotebook(editor, project.id, {
    title: "Editor NB",
  });
  ok(!!editorNotebook.id, "editor creates notebook");
  await dal.contracts.updateContract(editor, contract.id, { name: "Token2" });
  ok(true, "editor edits contract");
  await dal.notebooks.saveRunState(editor, notebook.id, '{"execCounter":1}');
  ok(
    (await dal.notebooks.getRunState(editor, notebook.id)) === '{"execCounter":1}',
    "editor saves and reads run state",
  );
  await dal.notebooks.clearRunState(editor, notebook.id);
  ok(
    (await dal.notebooks.getRunState(editor, notebook.id)) === null,
    "editor clears run state",
  );

  // --- Edit history (versions) -----------------------------------------------
  await dal.notebooks.saveBlocks(editor, notebook.id, [
    { type: "markdown", config: { text: "hi v2" } },
  ]);
  const versions = await dal.notebooks.listVersions(viewer, notebook.id);
  // Owner's first save records a baseline (pre-save state, no editor) plus
  // their version; the editor's save above appends a third.
  ok(versions.length >= 3, "viewer lists notebook versions");
  const baseline = versions.find((v) => v.editorId === null);
  ok(!!baseline, "first tracked edit captured a baseline version");
  ok(
    Array.isArray(
      (await dal.notebooks.getVersion(viewer, notebook.id, baseline!.id)).blocks,
    ),
    "viewer reads a version snapshot",
  );
  await expectStatus(
    dal.notebooks.restoreVersion(viewer, notebook.id, baseline!.id),
    403,
    "viewer cannot restore a version",
  );
  const restoredNotebook = await dal.notebooks.restoreVersion(
    editor,
    notebook.id,
    baseline!.id,
  );
  ok(
    restoredNotebook.blocks.length === 0,
    "editor restores a version (baseline was empty)",
  );
  ok(
    (await dal.notebooks.listVersions(editor, notebook.id)).some(
      (v) => v.restoredFrom === baseline!.id,
    ),
    "restoring appends a new version instead of rewinding history",
  );

  // --- Saved Run-all outputs ---------------------------------------------------
  const savedRun = await dal.runs.saveRun(editor, notebook.id, {
    state: '{"entries":[]}',
    simulated: false,
    succeeded: 1,
    failed: 0,
    skipped: 0,
  });
  ok(!!savedRun.id, "editor saves a run output");
  await expectStatus(
    dal.runs.saveRun(viewer, notebook.id, { state: '{"entries":[]}' }),
    403,
    "viewer cannot save a run output",
  );
  ok(
    (await dal.runs.listRuns(viewer, project.id)).some((r) => r.id === savedRun.id),
    "viewer lists saved runs",
  );
  ok(
    (await dal.runs.getRun(viewer, savedRun.id)).state === '{"entries":[]}',
    "viewer reads a saved run",
  );
  await expectStatus(
    dal.runs.deleteRun(viewer, savedRun.id),
    403,
    "viewer cannot delete a saved run",
  );
  await dal.runs.deleteRun(editor, savedRun.id);
  ok(
    !(await dal.runs.listRuns(editor, project.id)).some((r) => r.id === savedRun.id),
    "editor deletes a saved run",
  );

  // --- Portable notebook files (export / import / codegen) --------------------
  const manifest = {
    format: "chainstitch-notebook",
    version: 1,
    title: "Imported",
    description: null,
    chain: { id: 31337 },
    contracts: [
      {
        name: "Vault",
        address: "0x2222222222222222222222222222222222222222",
        abi: [
          { type: "function", name: "total", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
        ],
      },
    ],
    blocks: [
      { type: "variable", config: { name: "amt", value: "1" } },
      { id: "g1", type: "if", config: { condition: "{{amt}} > 0" } },
      {
        type: "read",
        parentId: "g1",
        config: { contract: "Vault", functionName: "total", args: [] },
        outputVariable: "total",
      },
      // Fallback path: references an address-book contract not in the file.
      { type: "read", config: { contract: "Token2", functionName: "n", args: [] } },
    ],
  };
  await expectStatus(
    dal.notebookFiles.importNotebookFile(viewer, project.id, manifest),
    403,
    "viewer cannot import a notebook file",
  );
  const imported = await dal.notebookFiles.importNotebookFile(editor, project.id, manifest);
  ok(
    imported.blockCount === 4 && imported.createdContracts.includes("Vault"),
    "editor imports a notebook file (missing contract created)",
  );
  const roundTrip = await dal.notebookFiles.getNotebookFile(viewer, imported.notebook.id);
  const rtIf = roundTrip.blocks.find((b) => b.type === "if");
  const rtRead = roundTrip.blocks.find((b) => b.type === "read");
  ok(
    roundTrip.format === "chainstitch-notebook" &&
      roundTrip.contracts.some((c) => c.name === "Vault") &&
      rtRead?.config.contract === "Vault" &&
      rtRead?.config.contractId === undefined &&
      !!rtIf?.id &&
      rtRead?.parentId === rtIf.id,
    "viewer exports the file (contracts by name, group membership kept)",
  );
  const reimported = await dal.notebookFiles.importNotebookFile(
    editor,
    project.id,
    roundTrip,
  );
  ok(
    reimported.blockCount === 4 && reimported.createdContracts.length === 0,
    "re-importing the export reuses address-book contracts by address",
  );
  await expectStatus(
    dal.notebookFiles.importNotebookFile(editor, project.id, {
      title: "bad",
      blocks: [{ type: "banana", config: {} }],
    }),
    400,
    "unknown block type is rejected",
  );
  await expectStatus(
    dal.notebookFiles.importNotebookFile(editor, project.id, {
      title: "bad",
      blocks: [{ type: "read", config: { contract: "Ghost", functionName: "f", args: [] } }],
    }),
    400,
    "unresolvable contract reference is rejected",
  );
  const wagmiCode = await dal.notebookFiles.getNotebookCode(
    viewer,
    imported.notebook.id,
    "wagmi",
  );
  ok(
    wagmiCode.code.includes("total") && wagmiCode.flavor === "wagmi",
    "viewer reads generated notebook code",
  );
  await expectStatus(
    dal.notebookFiles.getNotebookCode(viewer, imported.notebook.id, "cobol"),
    400,
    "unknown code flavor is rejected",
  );
  const handoff = await dal.notebookFiles.getNotebookHandoff(
    viewer,
    imported.notebook.id,
  );
  ok(
    handoff.notebookId === imported.notebook.id &&
      Array.isArray(handoff.steps) &&
      handoff.steps.length > 0,
    "viewer reads notebook handoff brief",
  );
  await expectStatus(
    dal.notebookFiles.getNotebookHandoff(nonMember, imported.notebook.id),
    403,
    "non-member cannot read notebook handoff",
  );

  // --- In-place update from a manifest ----------------------------------------
  const updatedManifest = {
    ...roundTrip,
    title: "Imported v2",
    blocks: [
      ...roundTrip.blocks,
      { type: "markdown", config: { text: "appended by update" } },
    ],
  };
  await expectStatus(
    dal.notebookFiles.updateNotebookBlocks(viewer, imported.notebook.id, updatedManifest),
    403,
    "viewer cannot update notebook from a file",
  );
  const updatedNb = await dal.notebookFiles.updateNotebookBlocks(
    editor,
    imported.notebook.id,
    updatedManifest,
  );
  ok(
    updatedNb.blockCount === 5 &&
      updatedNb.notebook.title === "Imported v2" &&
      updatedNb.createdContracts.length === 0,
    "editor updates a notebook in place (blocks + title, contracts reused)",
  );
  ok(
    (await dal.notebooks.getNotebookWithBlocks(viewer, imported.notebook.id)).blocks
      .length === 5,
    "the update replaced the stored blocks",
  );
  ok(
    (await dal.notebooks.listVersions(viewer, imported.notebook.id)).length >= 2,
    "the update recorded a restorable version of the previous content",
  );
  await expectStatus(
    dal.notebookFiles.updateNotebookBlocks(editor, imported.notebook.id, {
      title: "bad",
      blocks: [{ type: "banana", config: {} }],
    }),
    400,
    "invalid manifest is rejected on update",
  );
  ok(
    (await dal.recipes.updateRecipe(editor, recipe.id, { name: "Approve v2" })).name ===
      "Approve v2",
    "editor updates a recipe",
  );
  await expectStatus(
    dal.projects.updateProject(editor, project.id, { rpcUrl: "http://x" }),
    403,
    "editor cannot change project settings",
  );
  await expectStatus(
    dal.projects.deleteProject(editor, project.id),
    403,
    "editor cannot delete project",
  );
  await expectStatus(
    dal.workspace.createInvite(editor, "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", "viewer"),
    403,
    "editor cannot invite",
  );
  await expectStatus(
    dal.workspace.removeMember(editor, "m-carol"),
    403,
    "editor cannot remove members",
  );

  // --- Non-member: nothing --------------------------------------------------
  await expectStatus(dal.projects.listProjects(nonMember), 403, "non-member cannot list");
  await expectStatus(
    dal.projects.getProject(nonMember, project.id),
    403,
    "non-member cannot read a project",
  );

  // --- Workspace scoping: foreign content 404s -------------------------------
  await expectStatus(
    dal.projects.getProject(owner, "other-project"),
    404,
    "foreign project is invisible (owner)",
  );
  await expectStatus(
    dal.projects.updateProject(owner, "other-project", { name: "pwn" }),
    404,
    "foreign project cannot be updated",
  );
  await expectStatus(
    dal.contracts.updateContract(owner, "other-contract", { name: "pwn" }),
    404,
    "foreign contract cannot be updated",
  );
  await expectStatus(
    dal.contracts.deleteContract(owner, "other-contract"),
    404,
    "foreign contract cannot be deleted",
  );
  await expectStatus(
    dal.notebooks.getNotebookWithBlocks(owner, "other-notebook"),
    404,
    "foreign notebook is invisible",
  );
  await expectStatus(
    dal.notebooks.saveBlocks(owner, "other-notebook", []),
    404,
    "foreign notebook blocks cannot be written",
  );
  await expectStatus(
    dal.notebooks.saveRunState(owner, "other-notebook", "{}"),
    404,
    "foreign notebook run state cannot be written",
  );
  await expectStatus(
    dal.notebooks.listVersions(owner, "other-notebook"),
    404,
    "foreign notebook versions are invisible",
  );
  await expectStatus(
    dal.runs.saveRun(owner, "other-notebook", { state: '{"entries":[]}' }),
    404,
    "foreign notebook runs cannot be written",
  );
  await expectStatus(
    dal.runs.listRuns(owner, "other-project"),
    404,
    "foreign project runs cannot be listed",
  );
  await expectStatus(
    dal.notebookFiles.getNotebookFile(owner, "other-notebook"),
    404,
    "foreign notebook cannot be exported",
  );
  await expectStatus(
    dal.notebookFiles.getNotebookCode(owner, "other-notebook", "viem"),
    404,
    "foreign notebook code cannot be generated",
  );
  await expectStatus(
    dal.notebookFiles.getNotebookHandoff(owner, "other-notebook"),
    404,
    "foreign notebook handoff cannot be read",
  );
  await expectStatus(
    dal.notebookFiles.importNotebookFile(owner, "other-project", {
      title: "x",
      blocks: [],
    }),
    404,
    "cannot import into a foreign project",
  );
  await expectStatus(
    dal.notebookFiles.updateNotebookBlocks(owner, "other-notebook", {
      title: "x",
      blocks: [],
    }),
    404,
    "foreign notebook cannot be updated from a file",
  );
  await expectStatus(
    dal.recipes.listRecipes(owner, "other-project"),
    404,
    "foreign project recipes cannot be listed",
  );
  await expectStatus(
    dal.recipes.updateRecipe(owner, "other-recipe", { name: "pwn" }),
    404,
    "foreign recipe cannot be updated",
  );
  await expectStatus(
    dal.recipes.deleteRecipe(owner, "other-recipe"),
    404,
    "foreign recipe cannot be deleted",
  );
  await expectStatus(
    dal.contracts.listContracts(owner, "other-project"),
    404,
    "foreign project contracts cannot be listed",
  );
  await expectStatus(
    abiLookup.lookupAbiForProject(
      owner,
      "other-project",
      "0x0000000000000000000000000000000000000001",
    ),
    404,
    "foreign project cannot be used for ABI lookup",
  );
  await expectStatus(
    dal.stateViews.saveStateViews(owner, "other-project", []),
    404,
    "foreign state views cannot be written",
  );

  // --- Member management guards ----------------------------------------------
  await dal.workspace.updateMemberRole(owner, "m-carol", "editor");
  ok(true, "owner promotes viewer to editor");
  await expectStatus(
    dal.workspace.updateMemberRole(owner, "m-alice", "viewer"),
    403,
    "cannot demote the last owner",
  );
  await expectStatus(
    dal.workspace.removeMember(owner, "m-alice"),
    403,
    "cannot remove the last owner",
  );
  const invite = await dal.workspace.createInvite(
    owner,
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "editor",
  );
  ok(invite.status === "pending", "owner invites a new wallet (pending)");
  await expectStatus(
    dal.workspace.createInvite(owner, "not-an-address", "editor"),
    400,
    "invalid wallet is rejected",
  );

  // --- Per-project grants ------------------------------------------------------
  const team = await import("../src/server/team");
  const side = await dal.projects.createProject(owner, {
    name: "Side",
    chainId: 1,
    rpcUrl: "http://side.invalid",
  });

  // dave: no workspace role, editor grant on Side only.
  const grantee: Ctx = {
    userId: "dave",
    workspaceId: DEFAULT_WORKSPACE_ID,
    role: null,
    projectRoles: { [side.id]: "editor" },
  };
  const granteeProjects = await dal.projects.listProjects(grantee);
  ok(
    granteeProjects.length === 1 && granteeProjects[0].id === side.id,
    "grant-only user lists just their project",
  );
  ok(
    granteeProjects[0].role === "editor",
    "project list reports the granted role",
  );
  ok(
    (await dal.notebooks.listNotebooks(grantee, side.id)).length >= 1,
    "grant-only editor reads notebooks in their project",
  );
  const granteeNotebook = await dal.notebooks.createNotebook(grantee, side.id, {
    title: "From grantee",
  });
  ok(!!granteeNotebook.id, "grant-only editor creates a notebook");
  await expectStatus(
    dal.projects.getProject(grantee, project.id),
    404,
    "other projects are invisible to grant-only users",
  );
  await expectStatus(
    dal.notebooks.getNotebookWithBlocks(grantee, notebook.id),
    404,
    "notebooks outside the grant are invisible",
  );
  await expectStatus(
    dal.contracts.createContract(grantee, project.id, { name: "x", abi: [] }),
    404,
    "grant-only user cannot write outside their project",
  );
  await expectStatus(
    abiLookup.lookupAbiForProject(
      grantee,
      project.id,
      "0x0000000000000000000000000000000000000001",
    ),
    404,
    "ABI lookup outside the grant is invisible",
  );
  await expectStatus(
    dal.projects.createProject(grantee, { name: "x", chainId: 1, rpcUrl: "y" }),
    403,
    "grant-only user cannot create projects",
  );
  await expectStatus(
    dal.projects.updateProject(grantee, side.id, { rpcUrl: "http://x" }),
    403,
    "grant-only editor cannot change project settings",
  );
  await expectStatus(
    dal.workspace.listMembers(grantee),
    403,
    "grant-only user cannot list workspace members",
  );

  // Viewer grant caps mutations at read level inside the project.
  const viewerGrantee: Ctx = { ...grantee, projectRoles: { [side.id]: "viewer" } };
  await expectStatus(
    dal.notebooks.createNotebook(viewerGrantee, side.id, { title: "x" }),
    403,
    "viewer grant cannot create notebooks",
  );

  // Effective role = max(workspace role, grant): workspace viewer + owner grant.
  const viewerPlusGrant: Ctx = {
    userId: "carol",
    workspaceId: DEFAULT_WORKSPACE_ID,
    role: "viewer",
    projectRoles: { [side.id]: "owner" },
  };
  ok(
    (await dal.projects.updateProject(viewerPlusGrant, side.id, { name: "Side v2" }))
      .name === "Side v2",
    "owner grant lets a workspace viewer manage that project",
  );
  await expectStatus(
    dal.projects.updateProject(viewerPlusGrant, project.id, { name: "pwn" }),
    403,
    "the grant does not leak into other projects",
  );

  // Project-scoped invite: pending → claimed as a grant on first sign-in.
  const erinWallet = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
  const projectInvite = await dal.workspace.createInvite(
    owner,
    erinWallet,
    "viewer",
    side.id,
  );
  ok(
    projectInvite.status === "pending" && projectInvite.projectId === side.id,
    "owner creates a project-scoped invite",
  );
  await expectStatus(
    dal.workspace.createInvite(owner, erinWallet, "viewer", "no-such-project"),
    404,
    "project invite validates the project",
  );
  ok(
    await team.isWalletAllowedToSignIn(erinWallet),
    "pending project invite allows sign-in",
  );
  await db.insert(schema.user).values({
    id: "erin",
    name: "erin",
    email: "erin@test.invalid",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.walletAddress).values({
    id: "wa-erin",
    userId: "erin",
    address: erinWallet,
    chainId: 1,
    isPrimary: true,
    createdAt: now,
  });
  await team.onUserSignedIn("erin");
  const [erinGrant] = await db
    .select()
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.userId, "erin"));
  ok(
    erinGrant?.projectId === side.id && erinGrant?.role === "viewer",
    "project invite is claimed as a grant on sign-in",
  );
  const [erinMembership] = await db
    .select()
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, "erin"));
  ok(!erinMembership, "project invite grants no workspace membership");
  ok(
    await team.isWalletAllowedToSignIn(erinWallet),
    "grant holder can keep signing in",
  );

  // Grant-only members appear in the roster; revoking the grant locks out.
  const roster = await dal.workspace.listMembers(owner);
  const erinEntry = roster.find((m) => m.userId === "erin");
  ok(
    !!erinEntry && erinEntry.role === null && erinEntry.grants.length === 1,
    "grant-only member shows in the roster with their grant",
  );
  await expectStatus(
    dal.workspace.removeProjectGrant(viewer, erinGrant.id),
    403,
    "non-owners cannot revoke grants",
  );
  await dal.workspace.removeProjectGrant(owner, erinGrant.id);
  ok(
    (
      await db
        .select()
        .from(schema.projectMembers)
        .where(eq(schema.projectMembers.userId, "erin"))
    ).length === 0,
    "owner revokes a project grant",
  );
  ok(
    !(await team.isWalletAllowedToSignIn(erinWallet)),
    "revoked grant holder cannot sign back in",
  );

  // Removing a workspace member wipes their project grants too (full lockout).
  await team.upsertProjectGrant(side.id, "bob", "owner", false);
  await dal.workspace.removeMember(owner, "m-bob");
  ok(
    (
      await db
        .select()
        .from(schema.projectMembers)
        .where(eq(schema.projectMembers.userId, "bob"))
    ).length === 0,
    "removing a member also revokes their project grants",
  );

  // --- Project owners can share their project (the Share dialog) --------------
  const projectOwner: Ctx = {
    userId: "dave",
    workspaceId: DEFAULT_WORKSPACE_ID,
    role: null,
    projectRoles: { [side.id]: "owner" },
  };
  const frankWallet = "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65";
  const shared = await dal.workspace.createInvite(
    projectOwner,
    frankWallet,
    "viewer",
    side.id,
  );
  ok(
    shared.status === "pending" && shared.projectId === side.id,
    "project owner invites to their own project",
  );
  await expectStatus(
    dal.workspace.createInvite(projectOwner, frankWallet, "viewer"),
    403,
    "project owner cannot invite workspace-wide",
  );
  await expectStatus(
    dal.workspace.createInvite(projectOwner, frankWallet, "viewer", project.id),
    404,
    "project owner cannot invite to other projects",
  );
  const sideAccess = await dal.workspace.listProjectAccess(projectOwner, side.id);
  ok(
    sideAccess.invites.some((i) => i.id === shared.id) &&
      sideAccess.members.some((m) => m.via === "workspace" && m.role === "owner"),
    "project owner sees the project's access list",
  );
  await expectStatus(
    dal.workspace.listProjectAccess(viewer, side.id),
    403,
    "non-owners cannot view the access list",
  );
  await dal.workspace.revokeInvite(projectOwner, shared.id);
  ok(
    (await dal.workspace.listProjectAccess(projectOwner, side.id)).invites.length === 0,
    "project owner revokes a pending invite",
  );
  await team.upsertProjectGrant(side.id, "erin", "viewer", false);
  const [erinGrant2] = await db
    .select()
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.userId, "erin"));
  await dal.workspace.removeProjectGrant(projectOwner, erinGrant2.id);
  ok(
    (
      await db
        .select()
        .from(schema.projectMembers)
        .where(eq(schema.projectMembers.userId, "erin"))
    ).length === 0,
    "project owner revokes a grant on their project",
  );

  // --- "Anyone with the link" ------------------------------------------------
  const shareLinks = await import("../src/server/dal/share-links");
  const link = await shareLinks.upsertShareLink(owner, side.id, "viewer");
  ok(link.token.length >= 32, "owner enables link sharing");
  await expectStatus(
    shareLinks.upsertShareLink(editor, side.id, "viewer"),
    403,
    "editors cannot manage the share link",
  );
  await expectStatus(
    shareLinks.upsertShareLink(owner, side.id, "owner"),
    400,
    "a link can never grant owner",
  );
  ok(
    (await shareLinks.resolveShareTokens([link.token]))[side.id] === "viewer",
    "a valid token resolves to its project grant",
  );
  const updated = await shareLinks.upsertShareLink(owner, side.id, "editor");
  ok(
    updated.token === link.token && updated.role === "editor",
    "changing the role keeps the token",
  );
  const rotated = await shareLinks.upsertShareLink(owner, side.id, "editor", true);
  ok(rotated.token !== link.token, "reset rotates the token");
  ok(
    Object.keys(await shareLinks.resolveShareTokens([link.token])).length === 0,
    "the old token stops resolving after reset",
  );
  await shareLinks.deleteShareLink(owner, side.id);
  ok(
    (await shareLinks.getShareLink(owner, side.id)) === null,
    "owner turns link sharing off",
  );
  ok(
    Object.keys(await shareLinks.resolveShareTokens([rotated.token])).length === 0,
    "disabled links stop resolving",
  );

  // --- API tokens (team-mode MCP) --------------------------------------------
  const apiTokens = await import("../src/server/dal/api-tokens");
  const { getAuthContext } = await import("../src/server/auth-context");

  const minted = await apiTokens.createApiToken(owner, "Cursor");
  ok(
    minted.token.startsWith("cst_") && minted.tokenPrefix.startsWith("cst_"),
    "minted token uses the cst_ prefix",
  );
  ok(
    (await apiTokens.listApiTokens(owner)).some((t) => t.id === minted.id),
    "owner lists their own token (prefix only)",
  );
  ok(
    !(await apiTokens.listApiTokens(owner)).some((t) => "token" in t && (t as { token?: string }).token),
    "list never includes the plaintext secret",
  );
  await expectStatus(
    apiTokens.createApiToken(nonMember, "nope"),
    403,
    "non-members cannot mint tokens",
  );
  // carol is viewer: can mint (has access)
  const carolToken = await apiTokens.createApiToken(viewer, "Viewer agent");
  ok(carolToken.token.startsWith("cst_"), "viewers with access can mint tokens");

  const resolved = await apiTokens.resolveApiTokenUserId(minted.token);
  ok(resolved === "alice", "plaintext token resolves to its owner");
  ok(
    (await apiTokens.resolveApiTokenUserId("cst_deadbeef")) === null,
    "unknown token does not resolve",
  );

  const bearerHeaders = new Headers({
    Authorization: `Bearer ${minted.token}`,
  });
  const bearerCtx = await getAuthContext(bearerHeaders);
  ok(
    bearerCtx.userId === "alice" && bearerCtx.role === "owner",
    "Bearer auth yields the owner's AuthContext",
  );
  const badBearer = new Headers({ Authorization: "Bearer cst_not_real_token_zzzz" });
  await expectStatus(getAuthContext(badBearer), 401, "bad Bearer token is 401");

  await expectStatus(
    apiTokens.revokeApiToken(editor, minted.id),
    404,
    "cannot revoke another user's token",
  );
  await apiTokens.revokeApiToken(owner, minted.id);
  ok(
    (await apiTokens.resolveApiTokenUserId(minted.token)) === null,
    "revoked token stops resolving",
  );
  await apiTokens.revokeApiToken(viewer, carolToken.id);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
