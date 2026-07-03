/**
 * End-to-end smoke test for the execution engine against a local anvil node.
 * Run: npx tsx scripts/smoke.ts   (requires `anvil` running on 127.0.0.1:8545)
 */
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  http,
  publicActions,
  type Abi,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { runBlock } from "../src/lib/engine";
import { interpolate } from "../src/lib/variables";
import { coerceArg } from "../src/lib/abi";
import { generateBlockCode } from "../src/lib/codegen";
import type { ContractEntry, NotebookBlock, Project } from "../src/lib/types";

const SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract Counter {
    uint256 public number;
    string public name = "SmokeCounter";
    function setNumber(uint256 newNumber) public { number = newNumber; }
    function increment() public { number++; }
}`;

function assert(condition: unknown, label: string) {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`ok: ${label}`);
}

async function main() {
  const input = {
    language: "Solidity",
    sources: { "Counter.sol": { content: SOURCE } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const artifact = output.contracts["Counter.sol"]["Counter"];
  const abi = artifact.abi as Abi;
  const bytecode = `0x${artifact.evm.bytecode.object}` as `0x${string}`;

  const account = privateKeyToAccount(
    // anvil default account #0
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  );
  const wallet = createWalletClient({
    account,
    chain: foundry,
    transport: http("http://127.0.0.1:8545"),
  }).extend(publicActions);
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http("http://127.0.0.1:8545"),
  }) as PublicClient;

  const deployHash = await wallet.deployContract({ abi, bytecode });
  const receipt = await wallet.waitForTransactionReceipt({ hash: deployHash });
  const address = receipt.contractAddress!;
  console.log(`deployed Counter at ${address}`);

  // Set the counter to 42 so reads have something to find
  const setHash = await wallet.writeContract({
    address,
    abi,
    functionName: "setNumber",
    args: [42n],
  });
  await wallet.waitForTransactionReceipt({ hash: setHash });

  const project: Project = {
    id: "p1",
    name: "Smoke",
    description: null,
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
    explorerUrl: null,
    createdAt: Date.now(),
  };
  const contract: ContractEntry = {
    id: "c1",
    projectId: "p1",
    name: "Counter",
    address,
    abi,
    createdAt: Date.now(),
  };

  const scope: Record<string, unknown> = {};

  // 1. read block: number() -> variable `current`
  const readBlock: NotebookBlock = {
    id: "b1",
    type: "read",
    config: { contractId: "c1", functionName: "number", args: [] },
    outputVariable: "current",
  };
  const readOutcome = await runBlock(readBlock, {
    publicClient,
    contracts: [contract],
    scope,
  });
  assert(readOutcome.value === 42n, `read number() === 42n (got ${readOutcome.value})`);
  scope.current = readOutcome.value;

  // 2. read block using a {{variable}} arg is interpolated + coerced
  const interpolated = interpolate("{{current}}", scope);
  assert(interpolated === 42n, "sole {{current}} resolves to raw bigint");
  const coerced = coerceArg(interpolate("{{current}}", scope), "uint256");
  assert(coerced === 42n, "coerceArg passes through resolved bigint");

  // 3. string reads
  const nameBlock: NotebookBlock = {
    id: "b2",
    type: "read",
    config: { contractId: "c1", functionName: "name", args: [] },
    outputVariable: "tokenName",
  };
  const nameOutcome = await runBlock(nameBlock, {
    publicClient,
    contracts: [contract],
    scope,
  });
  assert(nameOutcome.value === "SmokeCounter", `name() reads string`);

  // 4. rpc blocks
  const blockNumber = await runBlock(
    { id: "b3", type: "rpc", config: { method: "getBlockNumber", params: [] }, outputVariable: null },
    { publicClient, contracts: [], scope },
  );
  assert(typeof blockNumber.value === "bigint", "rpc getBlockNumber returns bigint");

  const balance = await runBlock(
    {
      id: "b4",
      type: "rpc",
      config: { method: "getBalance", params: [account.address] },
      outputVariable: null,
    },
    { publicClient, contracts: [], scope },
  );
  assert(typeof balance.value === "bigint" && balance.value > 0n, "rpc getBalance works");

  const custom = await runBlock(
    {
      id: "b5",
      type: "rpc",
      config: { method: "custom", params: ["eth_chainId", "[]"] },
      outputVariable: null,
    },
    { publicClient, contracts: [], scope },
  );
  assert(custom.value === "0x7a69", `custom rpc eth_chainId (got ${custom.value})`);

  // 5. failed variable reference gives friendly error
  try {
    await runBlock(
      {
        id: "b6",
        type: "read",
        config: { contractId: "c1", functionName: "setNumber", args: ["{{missing}}"] },
        outputVariable: null,
      },
      { publicClient, contracts: [contract], scope },
    );
    assert(false, "unresolved variable should throw");
  } catch (e) {
    assert(
      e instanceof Error && e.message.includes('"missing" is not set'),
      "unresolved variable error is friendly",
    );
  }

  // 5b. simulate mode: write is eth_call'd as an arbitrary sender, nothing sent
  const simOutcome = await runBlock(
    {
      id: "b6b",
      type: "write",
      config: { contractId: "c1", functionName: "setNumber", args: ["123"] },
      outputVariable: null,
    },
    {
      publicClient,
      contracts: [contract],
      scope,
      mode: "simulate",
      sender: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    },
  );
  assert(simOutcome.simulated === true, "simulate mode flags outcome as simulated");
  assert(
    simOutcome.sender === "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "simulate outcome carries the sender",
  );
  assert(
    typeof simOutcome.blockNumber === "bigint",
    "simulate outcome carries the head block number",
  );
  const afterSim = await publicClient.readContract({
    address,
    abi,
    functionName: "number",
  });
  assert(afterSim === 42n, "simulated write did not change on-chain state");

  // 5c. impersonated execution: real tx sent as another account via anvil
  const impersonateOutcome = await runBlock(
    {
      id: "b6c",
      type: "write",
      config: { contractId: "c1", functionName: "setNumber", args: ["777"] },
      outputVariable: null,
    },
    {
      publicClient,
      contracts: [contract],
      scope,
      mode: "execute",
      impersonate: true,
      sender: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    },
  );
  assert(!!impersonateOutcome.txHash, "impersonated write returns a tx hash");
  const afterImpersonate = await publicClient.readContract({
    address,
    abi,
    functionName: "number",
  });
  assert(afterImpersonate === 777n, "impersonated write changed on-chain state");
  // restore to 42 for later assertions
  const restoreHash = await wallet.writeContract({
    address,
    abi,
    functionName: "setNumber",
    args: [42n],
  });
  await wallet.waitForTransactionReceipt({ hash: restoreHash });

  // 6. codegen
  const writeBlock: NotebookBlock = {
    id: "b7",
    type: "write",
    config: { contractId: "c1", functionName: "setNumber", args: ["{{current}}"] },
    outputVariable: "receipt",
  };
  const viemCode = generateBlockCode(writeBlock, [contract], project, "viem");
  assert(viemCode.includes("simulateContract"), "viem write codegen simulates first");
  assert(viemCode.includes("args: [current]"), "codegen chains {{current}} as identifier");
  const wagmiCode = generateBlockCode(writeBlock, [contract], project, "wagmi");
  assert(wagmiCode.includes("useWriteContract"), "wagmi write codegen uses hook");
  const readCode = generateBlockCode(readBlock, [contract], project, "wagmi");
  assert(readCode.includes("useReadContract"), "wagmi read codegen uses hook");

  console.log("\nAll smoke tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
