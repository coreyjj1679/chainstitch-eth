/**
 * End-to-end smoke test for the execution engine against a local anvil node.
 * Run: npx tsx scripts/smoke.ts   (requires `anvil` running on 127.0.0.1:8545)
 */
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  encodeErrorResult,
  http,
  publicActions,
  type Abi,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { runBlock } from "../src/lib/engine";
import { decodeRevertReason, findRevertCause, type CallFrame } from "../src/lib/trace";
import { importTransaction } from "../src/lib/tx-import";
import { evaluateCondition } from "../src/lib/condition";
import { interpolate } from "../src/lib/variables";
import { coerceArg } from "../src/lib/abi";
import { generateBlockCode } from "../src/lib/codegen";
import type { CallConfig, ContractEntry, NotebookBlock, Project } from "../src/lib/types";

const SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract Counter {
    uint256 public number;
    string public name = "SmokeCounter";
    error TooBig(uint256 provided, uint256 max);
    event NumberSet(address indexed setter, uint256 newNumber);
    function setNumber(uint256 newNumber) public {
        number = newNumber;
        emit NumberSet(msg.sender, newNumber);
    }
    function increment() public { number++; }
    // Reverts with a standard Error(string).
    function setChecked(uint256 newNumber) public {
        require(newNumber < 1000, "too large");
        number = newNumber;
    }
    // Reverts with a custom error.
    function setStrict(uint256 newNumber) public {
        if (newNumber > 500) revert TooBig(newNumber, 500);
        number = newNumber;
    }
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
    role: "owner",
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

  // 7. condition evaluator (drives `if` groups and "run when" guards)
  scope.tokenName = nameOutcome.value;
  const below = evaluateCondition("{{current}} < 100", scope);
  assert(below.result === true, `condition 42 < 100 is true (${below.resolved})`);
  assert(
    evaluateCondition('{{tokenName}} == "SmokeCounter"', scope).result === true,
    "condition compares strings",
  );
  assert(
    evaluateCondition("!{{current}}", scope).result === false,
    "condition negates truthiness",
  );
  try {
    evaluateCondition("{{nope}} > 1", scope);
    assert(false, "condition with unresolved variable should throw");
  } catch (e) {
    assert(
      e instanceof Error && e.message.includes('"nope" is not set'),
      "condition unresolved-variable error is friendly",
    );
  }

  // 8. if-group scenario (allowance-style): write only while number < 100.
  // Pass 1 runs the guarded write; pass 2 finds the condition false and skips.
  // This composes the pieces exactly like the editor does for an `if` group.
  const guardedWrite: NotebookBlock = {
    id: "b8",
    type: "write",
    config: { contractId: "c1", functionName: "setNumber", args: ["100"] },
    outputVariable: null,
  };
  const verdicts: boolean[] = [];
  for (let pass = 1; pass <= 2; pass++) {
    const currentOutcome = await runBlock(readBlock, {
      publicClient,
      contracts: [contract],
      scope,
    });
    scope.current = currentOutcome.value;
    const verdict = evaluateCondition("{{current}} < 100", scope);
    verdicts.push(verdict.result);
    if (verdict.result) {
      await runBlock(guardedWrite, {
        publicClient,
        contracts: [contract],
        scope,
        mode: "execute",
        impersonate: true,
        sender: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      });
    }
  }
  assert(verdicts[0] === true, "if-group pass 1: condition true, write ran");
  assert(verdicts[1] === false, "if-group pass 2: condition false, write skipped");
  const guarded = await publicClient.readContract({
    address,
    abi,
    functionName: "number",
  });
  assert(guarded === 100n, "guarded write ran exactly once (number == 100)");

  // 9. write receipts decode their logs against the address book
  const decodedEvents = impersonateOutcome.events;
  assert(
    Array.isArray(decodedEvents) && decodedEvents.length === 1,
    "write outcome carries decoded receipt events",
  );
  assert(
    decodedEvents![0].event === "NumberSet" && decodedEvents![0].contract === "Counter",
    "receipt log decoded to Counter.NumberSet",
  );
  assert(
    decodedEvents![0].args?.newNumber === 777n,
    `decoded event arg newNumber === 777n (got ${decodedEvents![0].args?.newNumber})`,
  );
  assert(
    String(decodedEvents![0].args?.setter).toLowerCase() ===
      "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    "decoded indexed arg carries the impersonated setter",
  );

  // 10. event block: query + decode logs (empty range = recent-window default).
  // Emissions so far: 42 (deploy setup), 777 (impersonated), 42 (restore),
  // 100 (guarded pass 1) — all within the default lookback on a fresh chain.
  const eventBlock: NotebookBlock = {
    id: "b9",
    type: "event",
    config: {
      contractId: "c1",
      eventName: "NumberSet",
      filters: [],
      fromBlock: "",
      toBlock: "",
    },
    outputVariable: "numberSets",
  };
  const eventsOutcome = await runBlock(eventBlock, {
    publicClient,
    contracts: [contract],
    scope,
  });
  const matches = eventsOutcome.value as Array<{
    event: string;
    blockNumber: bigint;
    txHash: string;
    args: Record<string, unknown>;
  }>;
  assert(matches.length === 4, `event block finds all 4 logs (got ${matches.length})`);
  assert(matches[0].args.newNumber === 42n, "oldest log decodes newNumber 42n");
  assert(matches[3].args.newNumber === 100n, "newest log decodes newNumber 100n");
  scope.numberSets = matches;
  assert(
    interpolate("{{numberSets[3].args.newNumber}}", scope) === 100n,
    "event output drills in via {{variable.paths}}",
  );

  // 10b. indexed-topic filter narrows to one setter
  const filtered = await runBlock(
    {
      id: "b10",
      type: "event",
      config: {
        contractId: "c1",
        eventName: "NumberSet",
        filters: ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"],
        fromBlock: "earliest",
        toBlock: "latest",
      },
      outputVariable: null,
    },
    { publicClient, contracts: [contract], scope },
  );
  assert(
    (filtered.value as unknown[]).length === 2,
    "indexed filter narrows to the impersonated sender's 2 logs",
  );

  // 11. event codegen
  const viemEvents = generateBlockCode(eventBlock, [contract], project, "viem");
  assert(viemEvents.includes("getContractEvents"), "viem event codegen queries logs");
  assert(viemEvents.includes('eventName: "NumberSet"'), "viem event codegen names the event");
  const wagmiEvents = generateBlockCode(eventBlock, [contract], project, "wagmi");
  assert(
    wagmiEvents.includes("useWatchContractEvent"),
    "wagmi event codegen subscribes via hook",
  );
  const pyEvents = generateBlockCode(eventBlock, [contract], project, "python");
  assert(pyEvents.includes("get_logs"), "python event codegen uses get_logs");

  // 12. revert-reason decoding (unit): custom errors + standard Error(string)
  const customData = encodeErrorResult({ abi, errorName: "TooBig", args: [999n, 500n] });
  assert(
    decodeRevertReason(customData, [contract]) === "TooBig(999, 500)",
    "decodeRevertReason decodes a custom error against the address book",
  );
  const errorAbi = [
    { type: "error", name: "Error", inputs: [{ name: "", type: "string" }] },
  ] as const satisfies Abi;
  const stringData = encodeErrorResult({
    abi: errorAbi,
    errorName: "Error",
    args: ["too large"],
  });
  assert(
    decodeRevertReason(stringData, []) === "too large",
    "decodeRevertReason decodes a standard Error(string) with no ABI",
  );

  // 13. decoded revert trace attaches to a failed simulate (Tenderly-bar UX)
  const anvilSender = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
  try {
    await runBlock(
      {
        id: "b11",
        type: "write",
        config: { contractId: "c1", functionName: "setChecked", args: ["2000"] },
        outputVariable: null,
      },
      { publicClient, contracts: [contract], scope, mode: "simulate", sender: anvilSender },
    );
    assert(false, "reverting simulate should throw");
  } catch (e) {
    const trace = (e as { trace?: CallFrame }).trace;
    assert(!!trace, "failed simulate attaches a decoded call trace");
    const cause = findRevertCause(trace!);
    assert(cause?.reverted === true, "trace flags the reverting frame");
    assert(
      cause?.functionName === "setChecked" && cause?.contract === "Counter",
      "trace decodes the reverting call against the address book",
    );
    assert(
      !!cause?.revertReason && cause.revertReason.length > 0,
      `reverting frame carries a reason (got ${cause?.revertReason})`,
    );
  }

  // 14. local key signer: write is signed & sent with a private key, no wallet
  const signerAccount = privateKeyToAccount(
    // anvil default account #1
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  );
  const signerWallet = createWalletClient({
    account: signerAccount,
    chain: foundry,
    transport: http("http://127.0.0.1:8545"),
  });
  const keyOutcome = await runBlock(
    {
      id: "b12",
      type: "write",
      config: { contractId: "c1", functionName: "setNumber", args: ["314"] },
      outputVariable: null,
    },
    {
      publicClient,
      contracts: [contract],
      scope,
      mode: "execute",
      localSigner: { account: signerAccount, walletClient: signerWallet },
    },
  );
  assert(!!keyOutcome.txHash, "local-signer write returns a tx hash");
  assert(
    String(keyOutcome.sender).toLowerCase() === signerAccount.address.toLowerCase(),
    "local-signer write is sent from the key's address",
  );
  const afterKey = await publicClient.readContract({ address, abi, functionName: "number" });
  assert(afterKey === 314n, "local-signer write changed on-chain state");

  // 15. tx-hash import: decode the key-signed tx back into notebook blocks
  const imported = await importTransaction({
    txHash: keyOutcome.txHash!,
    publicClient,
    contracts: [contract],
    // Counter is already in the book; the resolver is only for unknowns.
    resolveAbi: async () => null,
  });
  assert(imported.summary.traced === true, "tx import used debug_traceTransaction");
  assert(imported.summary.status === "success", "tx import reads the receipt status");
  assert(
    String(imported.summary.from).toLowerCase() === signerAccount.address.toLowerCase(),
    "tx import records the sender",
  );
  const importedWrites = imported.blocks.filter((b) => b.type === "write");
  assert(importedWrites.length === 1, "tx import produced one write block");
  const importedCall = importedWrites[0].config as CallConfig;
  assert(
    importedCall.functionName === "setNumber" && importedCall.args[0] === "314",
    "tx import decoded setNumber(314) with its argument",
  );
  assert(
    importedCall.contractId === "c1",
    "tx import wired the block to the address-book contract",
  );
  assert(
    imported.blocks.some((b) => b.type === "sender"),
    "tx import wraps calls in a sender group for the original sender",
  );

  // 16. expect blocks via runNotebook
  const { runNotebook } = await import("../src/lib/run-notebook");
  const expectPass = await runNotebook(
    [
      {
        id: "r",
        type: "read",
        config: { contractId: "c1", functionName: "number", args: [] },
        outputVariable: "n",
      },
      {
        id: "e",
        type: "expect",
        config: { kind: "condition", condition: "{{n}} == 314" },
        outputVariable: null,
      },
    ],
    { publicClient, contracts: [contract] },
  );
  assert(expectPass.ok, "expect condition passes against on-chain state");

  const expectFail = await runNotebook(
    [
      {
        id: "e",
        type: "expect",
        config: {
          kind: "revert",
          contractId: "c1",
          functionName: "setChecked",
          args: ["1"],
        },
        outputVariable: null,
      },
    ],
    { publicClient, contracts: [contract] },
  );
  assert(!expectFail.ok, "expect revert fails when the call succeeds");

  console.log("\nAll smoke tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
