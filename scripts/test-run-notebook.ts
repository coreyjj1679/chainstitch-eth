/**
 * Integration tests for runNotebook (expects + stop-on-fail) against anvil.
 * Run: npm run test:run-notebook   (requires anvil on 127.0.0.1:8545)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
import { runNotebook } from "../src/lib/run-notebook";
import type { ContractEntry, NotebookBlock } from "../src/lib/types";

const SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract Counter {
    uint256 public number;
    event NumberSet(address indexed setter, uint256 newNumber);
    function setNumber(uint256 newNumber) public {
        number = newNumber;
        emit NumberSet(msg.sender, newNumber);
    }
    function setChecked(uint256 newNumber) public {
        require(newNumber < 1000, "too large");
        number = newNumber;
    }
}`;

function compile(): { abi: Abi; bytecode: `0x${string}` } {
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "Counter.sol": { content: SOURCE } },
        settings: {
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      }),
    ),
  );
  const artifact = output.contracts["Counter.sol"]["Counter"];
  return {
    abi: artifact.abi as Abi,
    bytecode: `0x${artifact.evm.bytecode.object}` as `0x${string}`,
  };
}

describe("runNotebook against anvil", async () => {
  const { abi, bytecode } = compile();
  const account = privateKeyToAccount(
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

  const contracts: ContractEntry[] = [
    {
      id: "c1",
      projectId: "p1",
      name: "Counter",
      address,
      abi,
      createdAt: 0,
    },
  ];

  const localSigner = {
    account,
    walletClient: createWalletClient({
      account,
      chain: foundry,
      transport: http("http://127.0.0.1:8545"),
    }),
  };

  it("passes a condition expect after a read", async () => {
    await wallet.writeContract({
      address,
      abi,
      functionName: "setNumber",
      args: [7n],
    });
    const blocks: NotebookBlock[] = [
      {
        id: "r1",
        type: "read",
        config: { contractId: "c1", functionName: "number", args: [] },
        outputVariable: "n",
      },
      {
        id: "e1",
        type: "expect",
        config: { kind: "condition", condition: "{{n}} == 7" },
        outputVariable: null,
      },
    ];
    const summary = await runNotebook(blocks, {
      publicClient,
      contracts,
      localSigner,
    });
    assert.equal(summary.ok, true);
    assert.equal(summary.failed, 0);
  });

  it("stops on a failed expect and does not run later blocks", async () => {
    const blocks: NotebookBlock[] = [
      {
        id: "e1",
        type: "expect",
        config: { kind: "condition", condition: "1 == 2" },
        outputVariable: null,
      },
      {
        id: "r1",
        type: "read",
        config: { contractId: "c1", functionName: "number", args: [] },
        outputVariable: "n",
      },
    ];
    const results: Record<string, string> = {};
    const summary = await runNotebook(blocks, {
      publicClient,
      contracts,
      onBlockResult: (id, r) => {
        results[id] = r.status;
      },
    });
    assert.equal(summary.ok, false);
    assert.equal(summary.failedBlockId, "e1");
    assert.equal(results.e1, "error");
    assert.equal(results.r1, undefined);
  });

  it("passes an event expect after a write", async () => {
    const blocks: NotebookBlock[] = [
      {
        id: "w1",
        type: "write",
        config: { contractId: "c1", functionName: "setNumber", args: ["99"] },
        outputVariable: "receipt",
      },
      {
        id: "e1",
        type: "expect",
        config: { kind: "event", eventName: "NumberSet", contract: "Counter" },
        outputVariable: null,
      },
    ];
    const summary = await runNotebook(blocks, {
      publicClient,
      contracts,
      localSigner,
    });
    assert.equal(summary.ok, true, JSON.stringify(summary.results.e1));
  });

  it("passes a revert expect when the call reverts", async () => {
    const blocks: NotebookBlock[] = [
      {
        id: "e1",
        type: "expect",
        config: {
          kind: "revert",
          contractId: "c1",
          functionName: "setChecked",
          args: ["5000"],
          reason: "too large",
        },
        outputVariable: null,
      },
    ];
    const summary = await runNotebook(blocks, {
      publicClient,
      contracts,
    });
    assert.equal(summary.ok, true, JSON.stringify(summary.results.e1));
  });

  it("fails a revert expect when the call succeeds", async () => {
    const blocks: NotebookBlock[] = [
      {
        id: "e1",
        type: "expect",
        config: {
          kind: "revert",
          contractId: "c1",
          functionName: "setChecked",
          args: ["1"],
        },
        outputVariable: null,
      },
    ];
    const summary = await runNotebook(blocks, {
      publicClient,
      contracts,
    });
    assert.equal(summary.ok, false);
    assert.match(summary.results.e1?.error ?? "", /succeeded|expected revert/i);
  });

  it("soft-skips if children when condition is false", async () => {
    const blocks: NotebookBlock[] = [
      {
        id: "g1",
        type: "if",
        config: { condition: "1 == 2" },
        outputVariable: null,
      },
      {
        id: "r1",
        type: "read",
        parentId: "g1",
        config: { contractId: "c1", functionName: "number", args: [] },
        outputVariable: "n",
      },
      {
        id: "e1",
        type: "expect",
        config: { kind: "condition", condition: "true" },
        outputVariable: null,
      },
    ];
    const summary = await runNotebook(blocks, { publicClient, contracts });
    assert.equal(summary.ok, true);
    assert.equal(summary.results.r1?.status, "skipped");
    assert.equal(summary.results.e1?.status, "success");
  });
});
