/**
 * CLI e2e: write a temp notebook, run via chainstitch, assert exit codes.
 * Run: npm run test:cli-runner   (requires anvil on 127.0.0.1:8545)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import solc from "solc";
import {
  createWalletClient,
  http,
  publicActions,
  type Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import {
  NOTEBOOK_FILE_FORMAT,
  NOTEBOOK_FILE_VERSION,
} from "../src/lib/notebook-file";

const ROOT = path.join(__dirname, "..");
const CLI = path.join(ROOT, "bin", "chainstitch.js");

const SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract Counter {
    uint256 public number;
    function setNumber(uint256 newNumber) public { number = newNumber; }
    function setChecked(uint256 newNumber) public {
        require(newNumber < 1000, "too large");
        number = newNumber;
    }
}`;

function compile() {
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

function runCli(args: string[]): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.status,
    stderr: `${result.stderr ?? ""}${result.stdout ?? ""}`,
  };
}

describe("chainstitch run CLI", async () => {
  const { abi, bytecode } = compile();
  const account = privateKeyToAccount(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  );
  const wallet = createWalletClient({
    account,
    chain: foundry,
    transport: http("http://127.0.0.1:8545"),
  }).extend(publicActions);

  const deployHash = await wallet.deployContract({ abi, bytecode });
  const receipt = await wallet.waitForTransactionReceipt({ hash: deployHash });
  const address = receipt.contractAddress!;

  await wallet.writeContract({
    address,
    abi,
    functionName: "setNumber",
    args: [42n],
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-cli-"));

  it("exits 0 when expects pass", () => {
    const file = path.join(dir, "pass.notebook.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        format: NOTEBOOK_FILE_FORMAT,
        version: NOTEBOOK_FILE_VERSION,
        title: "Pass",
        description: null,
        chain: { id: 31337 },
        contracts: [{ name: "Counter", address, abi }],
        blocks: [
          {
            type: "read",
            config: {
              contract: "Counter",
              functionName: "number",
              args: [],
            },
            outputVariable: "n",
          },
          {
            type: "expect",
            config: { kind: "condition", condition: "{{n}} == 42" },
          },
        ],
      }),
    );
    const { status, stderr } = runCli([
      "run",
      file,
      "--rpc-url",
      "http://127.0.0.1:8545",
      "--chain-id",
      "31337",
    ]);
    assert.equal(status, 0, stderr);
  });

  it("exits 1 when an expect fails", () => {
    const file = path.join(dir, "fail.notebook.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        format: NOTEBOOK_FILE_FORMAT,
        version: NOTEBOOK_FILE_VERSION,
        title: "Fail",
        chain: { id: 31337 },
        contracts: [{ name: "Counter", address, abi }],
        blocks: [
          {
            type: "expect",
            config: { kind: "condition", condition: "1 == 2" },
          },
        ],
      }),
    );
    const { status, stderr } = runCli([
      "run",
      file,
      "--rpc-url",
      "http://127.0.0.1:8545",
      "--chain-id",
      "31337",
    ]);
    assert.equal(status, 1, stderr);
    assert.match(stderr, /FAIL|Expectation failed|failed/i);
  });

  it("passes a revert expect via CLI", () => {
    const file = path.join(dir, "revert.notebook.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        format: NOTEBOOK_FILE_FORMAT,
        version: NOTEBOOK_FILE_VERSION,
        title: "Revert",
        chain: { id: 31337 },
        contracts: [{ name: "Counter", address, abi }],
        blocks: [
          {
            type: "expect",
            config: {
              kind: "revert",
              contract: "Counter",
              functionName: "setChecked",
              args: ["5000"],
              reason: "too large",
            },
          },
        ],
      }),
    );
    const { status, stderr } = runCli([
      "run",
      file,
      "--rpc-url",
      "http://127.0.0.1:8545",
      "--chain-id",
      "31337",
    ]);
    assert.equal(status, 0, stderr);
  });
});
