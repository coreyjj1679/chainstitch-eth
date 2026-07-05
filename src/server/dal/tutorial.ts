import "server-only";
import { db, schema, DEFAULT_WORKSPACE_ID } from "@/db";

/**
 * Seeds the "Welcome to Chainstitch" tutorial into a fresh project: a small
 * chain-agnostic recipe plus a notebook that tours every feature. Everything
 * runnable is plain JSON-RPC, so it works against any endpoint with no
 * contracts, no wallet and no setup.
 *
 * Called from `createProject` after authorization — not an API entry point.
 */

interface SeedBlock {
  id?: string;
  type: string;
  config: unknown;
  outputVariable?: string | null;
  parentId?: string | null;
}

const lines = (...text: string[]) => text.join("\n");

const INTRO = lines(
  "# Welcome to Chainstitch",
  "",
  "This notebook is a hands-on tour. Every runnable cell below talks to this",
  "project's RPC endpoint — no contracts, no wallet, nothing to configure.",
  "",
  "Select a cell and press **Shift+Enter** to run it, or hit **Run all** in the",
  "toolbar and read along. Everything here is editable, and the whole notebook",
  "can be deleted from the sidebar once you're done with it.",
);

const VARIABLES = lines(
  "## 1 · Blocks & variables",
  "",
  "Cells run top to bottom, Jupyter-style. A **Variable** block declares a",
  "constant you can reuse anywhere as a `{{chip}}` — the two below feed the",
  "rest of the tour (swap `account` for your own address if you like).",
  "",
  "Runnable cells can also **save their output as** a variable — expand any of",
  "them and look for the dashed *save as* field. Downstream cells can drill",
  "into saved results with paths, e.g. `receipt.blockNumber` between double",
  "braces.",
);

const RPC = lines(
  "## 2 · RPC cells",
  "",
  "**RPC** blocks call the node directly, no ABI needed: block numbers,",
  "balances, logs, storage slots — plus a raw *custom method* escape hatch for",
  "anvil cheatcodes (`anvil_setBalance`, `anvil_impersonateAccount`,",
  "`evm_snapshot`, …).",
  "",
  "Run the two cells below: the first saves the chain head as `head`, the",
  "second saves the native balance of `account` as `balance`.",
);

const LIVE_TEXT = lines(
  "## 3 · Text reads your variables too",
  "",
  "Text blocks interpolate variables once they exist — before that, the",
  "reference renders as-is so you can see what a document expects. After",
  "running section 2, this line fills itself in:",
  "",
  "> Chain head **{{head}}** — `{{account}}` holds **{{balance}}** wei.",
);

const CONDITIONS = lines(
  "## 4 · Conditions",
  "",
  "A **Condition** group runs its children only when its check holds. Compare",
  "variables and literals with `==` `!=` `<` `<=` `>` `>=` — the classic flow",
  "is *read the allowance, approve only if it's too low*.",
  "",
  "Below: **if** the account's balance is under `minBalance` (1 ETH), the",
  "group checks the current gas price; otherwise the child shows as",
  "**skipped**. Run it twice with different `account` values and watch the",
  "resolved condition in the result. Single cells get the same guard from the",
  "*run when* field next to *save as*.",
);

const CONTRACTS = lines(
  "## 5 · Contracts: reads, writes & events",
  "",
  "Open the **Contracts** tab and paste a deployed address — the verified ABI",
  "is fetched for you (Sourcify/Blockscout out of the box, Etherscan with a",
  "server key), and proxies resolve to their implementation automatically.",
  "Prefer files? Drop ABI JSON (raw arrays or Foundry/Hardhat artifacts) and",
  "fill in addresses by hand.",
  "",
  "**Read** and **Write** cells then give you typed forms generated from the",
  "ABI. Writes always **simulate first**, so revert reasons surface *before*",
  "the wallet prompt. **Events** cells query a contract's logs and decode",
  "them — the result is a variable like any other. Wrap cells in a",
  "**Simulation** group to run them as any caller via `eth_call` — and on",
  "anvil forks the group can *impersonate* that caller for real writes, no",
  "private key needed.",
  "",
  "The read cell below is waiting for its contract — add one in the Contracts",
  "tab, then pick it here.",
);

const RECIPES = lines(
  "## 6 · Recipes",
  "",
  "Save any selection of cells as a **recipe** and reuse it across notebooks:",
  "the bookmark icon in the toolbar (or on any cell) saves one, and the",
  "add-block menu inserts one — either **linked**, like the Recipe cell below",
  "that reruns every step in one click, or pasted as editable blocks. Linked",
  "cells follow recipe edits automatically and can be *detached* into blocks",
  "later. Recipes live in the sidebar below your notebooks — open one and it",
  "edits like a notebook: tweak the cells, test-run them, then hit **Save**",
  "to publish the changes to every linked cell.",
  "",
  "Run the cell below and open its result — the **Steps** tab reports every",
  "step, including any that were skipped by a condition.",
);

const OUTRO = lines(
  "## 7 · The rest of the tour",
  "",
  "- **Code generation** — the `</>` button on any cell emits wagmi, viem,",
  "  web3.py, alloy or Solidity snippets; the toolbar's code toggle shows the",
  "  whole notebook as runnable source, and the download button exports a JSON",
  "  call manifest.",
  "- **State tab** — pin view functions per contract into a live dashboard,",
  "  fetched in one multicall and refreshed on demand.",
  "- **History & saved runs** — every save is versioned (the clock icon in",
  "  the toolbar diffs and restores), and finished runs can be saved and",
  "  reopened from the sidebar, outputs included.",
  "- **Simulate all** — dry-run the entire notebook as any address via",
  "  `eth_call`; nothing is sent on-chain.",
  "- **Shortcuts** — `B` adds a block, `M` adds text, `Shift+Enter` runs the",
  "  selected cell, `Cmd+Enter` runs while editing; double-click any cell to",
  "  edit it.",
  "",
  "That's the tour. Delete this notebook (or this whole example project) from",
  "the sidebar whenever you're ready. To bring the team in, use the project's",
  "**Share** button or invite wallets from **Settings** — and see **/docs**",
  "for the full guide, self-hosting included.",
);

/**
 * First-boot example: a ready-made project against a public mainnet RPC, so
 * a fresh instance has a runnable tour before anyone creates anything. The
 * tutorial content is chain-agnostic; mainnet just makes every cell return
 * something interesting with zero setup. Owners can delete it like any
 * project. Called once per database from the boot bootstrap (see db/index).
 */
export async function seedExampleProject(): Promise<void> {
  const projectId = crypto.randomUUID();
  await db.insert(schema.projects).values({
    id: projectId,
    workspaceId: DEFAULT_WORKSPACE_ID,
    name: "Example — Ethereum mainnet",
    description:
      "A runnable tour against a public RPC — open the Welcome notebook and hit Run all. Safe to delete.",
    chainId: 1,
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    explorerUrl: "https://etherscan.io",
    createdAt: new Date(),
  });
  await seedTutorialContent(projectId);
}

export async function seedTutorialContent(projectId: string): Promise<void> {
  const now = new Date();

  // A tiny chain-agnostic recipe the tutorial's Recipe cell links to.
  const recipeId = crypto.randomUUID();
  const recipeBlocks: SeedBlock[] = [
    {
      id: crypto.randomUUID(),
      type: "rpc",
      config: { method: "getChainId", params: [] },
      outputVariable: "chainId",
    },
    {
      id: crypto.randomUUID(),
      type: "rpc",
      config: { method: "getBlockNumber", params: [] },
      outputVariable: "latestBlock",
    },
    {
      id: crypto.randomUUID(),
      type: "rpc",
      config: { method: "getGasPrice", params: [] },
      outputVariable: "gasPrice",
    },
  ];
  await db.insert(schema.recipes).values({
    id: recipeId,
    projectId,
    name: "Chain health check",
    description: "Three RPC reads that work on any chain — id, head, gas price",
    blocks: JSON.stringify(
      recipeBlocks.map((b) => ({
        ...b,
        outputVariable: b.outputVariable ?? null,
        parentId: null,
        runWhen: null,
      })),
    ),
    createdAt: now,
    updatedAt: now,
  });

  const notebookId = crypto.randomUUID();
  await db.insert(schema.notebooks).values({
    id: notebookId,
    projectId,
    title: "Welcome to Chainstitch",
    description: "A hands-on tour — run it top to bottom, edit anything, delete when done",
    createdAt: now,
    updatedAt: now,
  });

  const ifBlockId = crypto.randomUUID();
  const blocks: SeedBlock[] = [
    { type: "markdown", config: { text: INTRO } },
    { type: "markdown", config: { text: VARIABLES } },
    {
      type: "variable",
      config: { name: "account", value: "0x0000000000000000000000000000000000000000" },
    },
    {
      type: "variable",
      config: { name: "minBalance", value: "1000000000000000000" },
    },
    { type: "markdown", config: { text: RPC } },
    {
      type: "rpc",
      config: { method: "getBlockNumber", params: [] },
      outputVariable: "head",
    },
    {
      type: "rpc",
      config: { method: "getBalance", params: ["{{account}}"] },
      outputVariable: "balance",
    },
    { type: "markdown", config: { text: LIVE_TEXT } },
    { type: "markdown", config: { text: CONDITIONS } },
    {
      id: ifBlockId,
      type: "if",
      config: { condition: "{{balance}} < {{minBalance}}" },
    },
    {
      type: "rpc",
      config: { method: "getGasPrice", params: [] },
      outputVariable: "gasNow",
      parentId: ifBlockId,
    },
    { type: "markdown", config: { text: CONTRACTS } },
    { type: "read", config: { contractId: "", functionName: "", args: [] } },
    { type: "markdown", config: { text: RECIPES } },
    { type: "recipe", config: { recipeId } },
    { type: "markdown", config: { text: OUTRO } },
  ];
  await db.insert(schema.blocks).values(
    blocks.map((b, index) => ({
      id: b.id ?? crypto.randomUUID(),
      notebookId,
      order: index,
      type: b.type,
      config: JSON.stringify(b.config),
      outputVariable: b.outputVariable ?? null,
      parentId: b.parentId ?? null,
      runWhen: null,
    })),
  );
}
