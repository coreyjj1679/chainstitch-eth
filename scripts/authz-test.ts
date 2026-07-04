/**
 * Cross-tenant / role authorization test for the data access layer.
 * Run: npm run test:authz   (tsx --conditions=react-server, temp database)
 *
 * Verifies, without a server, that every DAL entry point enforces:
 *  - role gates (viewer < editor < owner, non-member rejected)
 *  - workspace scoping (content in another workspace 404s)
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
  const { db, schema, DEFAULT_WORKSPACE_ID } = await import("../src/db");
  const dal = {
    projects: await import("../src/server/dal/projects"),
    contracts: await import("../src/server/dal/contracts"),
    notebooks: await import("../src/server/dal/notebooks"),
    recipes: await import("../src/server/dal/recipes"),
    stateViews: await import("../src/server/dal/state-views"),
    workspace: await import("../src/server/dal/workspace"),
  };
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

  const owner: Ctx = { userId: "alice", workspaceId: DEFAULT_WORKSPACE_ID, role: "owner" };
  const editor: Ctx = { userId: "bob", workspaceId: DEFAULT_WORKSPACE_ID, role: "editor" };
  const viewer: Ctx = { userId: "carol", workspaceId: DEFAULT_WORKSPACE_ID, role: "viewer" };
  const nonMember: Ctx = { userId: "dave", workspaceId: DEFAULT_WORKSPACE_ID, role: null };

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
  await expectStatus(
    dal.notebooks.saveBlocks(viewer, notebook.id, []),
    403,
    "viewer cannot save blocks",
  );
  ok((await dal.recipes.listRecipes(viewer, project.id)).length === 1, "viewer lists recipes");
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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
