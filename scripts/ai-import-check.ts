/**
 * Offline check for the AI-import layer: stubs fetch with canned Gemini
 * responses (including one broken → repaired sequence) and asserts the
 * deterministic validation/mapping, artifact handling, test discovery and
 * the pre-flight classifier. No network, no key.
 */
import {
  convertTestToBlocks,
  findTestFunctions,
  preflightCheck,
  type SuppliedAbi,
} from "../src/lib/ai-import";
import type { CallConfig, ContractEntry, RpcConfig } from "../src/lib/types";

let failures = 0;
function ok(cond: boolean, label: string) {
  console.log(`${cond ? "ok" : "FAIL"}: ${label}`);
  if (!cond) failures++;
}

const contracts: ContractEntry[] = [
  {
    id: "usdc-id",
    projectId: "p",
    name: "USDC",
    address: "0x1111111111111111111111111111111111111111",
    abi: [
      {
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [{ type: "bool" }],
      },
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "owner", type: "address" }],
        outputs: [{ type: "uint256" }],
      },
    ],
    createdAt: 0,
  },
];

/** Vault ABI arrives via a "dropped artifact", not the address book. */
const extraAbis: SuppliedAbi[] = [
  {
    name: "Vault",
    abi: [
      {
        type: "function",
        name: "deposit",
        stateMutability: "nonpayable",
        inputs: [
          { name: "amount", type: "uint256" },
          { name: "to", type: "address" },
        ],
        outputs: [],
      },
    ],
  },
];

const modelOutput = {
  blocks: [
    { id: "b1", type: "markdown", config: { text: "# Vault deposit flow" } },
    {
      id: "b2",
      type: "variable",
      config: { name: "alice", value: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
    },
    {
      id: "b3",
      type: "rpc",
      config: {
        method: "custom",
        params: ["anvil_setBalance", '["{{alice}}", "0x8ac7230489e80000"]'],
      },
    },
    {
      id: "b4",
      type: "sender",
      config: { address: "{{alice}}", simulateOnly: false },
    },
    {
      id: "b5",
      type: "write",
      contract: "USDC",
      config: { functionName: "approve", args: ["0x2222222222222222222222222222222222222222", 1000000] },
      parentId: "b4",
    },
    {
      id: "b6",
      type: "write",
      contract: "Vault",
      config: { functionName: "deposit", args: ["1000000", "{{alice}}"] },
      parentId: "b4",
    },
    { id: "b7", type: "rpc", config: { method: "evm_increaseTime", params: [604800] } },
    {
      id: "b8",
      type: "read",
      contract: "USDC",
      config: { functionName: "balanceOf", args: ["{{alice}}"] },
      outputVariable: "bal",
    },
    { id: "b9", type: "if", config: { condition: "{{bal}} == 1000000" } },
    { id: "b10", type: "recipe", config: { recipeId: "nope" } },
    { id: "b11", type: "markdown", config: { text: "note about {{bob}}" }, parentId: "b1" },
    {
      id: "b12",
      type: "read",
      contract: "Vault",
      config: { functionName: "withdraw", args: [] },
    },
    {
      id: "b13",
      type: "write",
      contract: "Router",
      config: { functionName: "swap", args: ["1"] },
    },
  ],
  warnings: ["Vault is deployed in setUp() — the notebook assumes it exists"],
};

const preflightOutput = {
  summary: "Mostly ready — one contract has no interface.",
  contracts: [
    { name: "USDC", why: "usdc.approve in setUp" },
    { name: "Vault", why: "vault.deposit in test_Deposit" },
    { name: "Router", why: "router.swap in test_Swap" },
  ],
  unresolved: ["BaseTest — inherited; paste BaseTest.sol"],
};

// fetch stub: a queue of canned responses. The first convert response is
// broken JSON to exercise the repair retry.
const queue = [
  "not json at all {",
  JSON.stringify(modelOutput),
  JSON.stringify(preflightOutput),
];
let calls = 0;
globalThis.fetch = (async () => {
  const text = queue[calls] ?? "{}";
  calls++;
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  };
}) as unknown as typeof fetch;

async function main() {
  // --- conversion ------------------------------------------------------------
  const files = [
    { name: "Vault.t.sol", content: "function test_Deposit() public {}\nfunction test_Swap() public {}" },
    { name: "BaseTest.sol", content: "function helper() internal {}\nfunction testFuzz_Amounts(uint256 x) public {}" },
  ];
  const result = await convertTestToBlocks({
    files,
    contracts,
    extraAbis,
    selectedTests: ["test_Deposit"],
    apiKey: "test",
  });

  ok(calls === 2, "invalid first response triggers exactly one repair retry");
  ok(result.blocks.length === 12, `recipe block dropped (12 kept, got ${result.blocks.length})`);

  const types = result.blocks.map((b) => b.type).join(",");
  ok(
    types === "markdown,variable,rpc,sender,write,write,rpc,read,if,markdown,read,write",
    `types in order (${types})`,
  );

  const sender = result.blocks[3];
  const approve = result.blocks[4];
  const deposit = result.blocks[5];
  ok(
    approve.parentId === sender.id && deposit.parentId === sender.id,
    "children remap parentId to the sender group's new id",
  );
  ok(/^[0-9a-f-]{36}$/.test(sender.id), "ids are re-minted as UUIDs");

  ok(
    (approve.config as CallConfig).contractId === "usdc-id",
    "USDC resolves to its address-book id",
  );
  ok(
    (approve.config as CallConfig).args[1] === "1000000",
    "numeric args coerce to form strings",
  );
  ok(
    (deposit.config as CallConfig).contractId === "",
    "artifact-only contract stays unconfigured until inserted",
  );

  const wrapped = result.blocks[6].config as RpcConfig;
  ok(
    wrapped.method === "custom" && wrapped.params[0] === "evm_increaseTime",
    "raw JSON-RPC method names auto-wrap into the custom method",
  );

  ok(result.blocks[9].parentId === null, "parent link to a non-group is dropped to top level");

  const vaultMissing = result.missing.find((m) => m.name === "Vault");
  const routerMissing = result.missing.find((m) => m.name === "Router");
  ok(
    !!vaultMissing && !!vaultMissing.abi && vaultMissing.blockIds.length === 2,
    "missing Vault carries its supplied ABI and both referencing block ids",
  );
  ok(
    vaultMissing?.blockIds.includes(deposit.id) === true,
    "missing blockIds point at the mapped blocks",
  );
  ok(!!routerMissing && !routerMissing.abi, "Router is missing without an ABI");

  const w = result.warnings.join(" | ");
  ok(w.includes("setUp()"), "model warnings pass through");
  ok(/unsupported type "recipe"/.test(w), "recipe drop is warned");
  ok(
    /"Vault" has no function "withdraw"/.test(w),
    "calls are validated against supplied artifact ABIs",
  );
  ok(/\{\{bob\}\} is referenced but never declared/.test(w), "unresolved {{ref}} warned");
  ok(/parent link "b1" is invalid/.test(w), "invalid parent link warned");

  // --- pre-flight ------------------------------------------------------------
  const report = await preflightCheck({ files, contracts, extraAbis, apiKey: "test" });
  ok(calls === 3, "pre-flight is a single request");
  const status = Object.fromEntries(report.contracts.map((c) => [c.name, c.status]));
  ok(status.USDC === "address-book", "pre-flight: USDC classified as address-book");
  ok(status.Vault === "artifact", "pre-flight: Vault classified as supplied artifact");
  ok(status.Router === "missing", "pre-flight: Router classified as missing");
  ok(
    report.unresolved.length === 1 && report.unresolved[0].includes("BaseTest"),
    "pre-flight: unresolved context passes through",
  );

  // --- test discovery ----------------------------------------------------------
  const tests = findTestFunctions(files).join(",");
  ok(
    tests === "test_Deposit,test_Swap,testFuzz_Amounts",
    `findTestFunctions discovers across files (${tests})`,
  );

  console.log(failures === 0 ? "\nAll AI-import checks passed." : `\n${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
