/**
 * Unit tests for expect-block evaluation and notebook-file parsing.
 * Run: npm run test:expect
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateExpectCondition,
  evaluateExpectEvent,
  parseExpectConfig,
} from "../src/lib/expect";
import {
  NOTEBOOK_FILE_FORMAT,
  NOTEBOOK_FILE_VERSION,
  parseNotebookFile,
  buildNotebookFile,
} from "../src/lib/notebook-file";
import type { DecodedEventEntry, NotebookBlock } from "../src/lib/types";

describe("parseExpectConfig", () => {
  it("rejects unknown kinds", () => {
    const r = parseExpectConfig({ kind: "nope" });
    assert.equal(r.ok, false);
  });

  it("requires a condition for kind=condition", () => {
    const r = parseExpectConfig({ kind: "condition", condition: "  " });
    assert.equal(r.ok, false);
  });

  it("normalizes a condition expect", () => {
    const r = parseExpectConfig({ kind: "condition", condition: " {{x}} > 0 " });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.config, { kind: "condition", condition: "{{x}} > 0" });
    }
  });

  it("requires eventName for kind=event", () => {
    const r = parseExpectConfig({ kind: "event" });
    assert.equal(r.ok, false);
  });

  it("normalizes an event expect", () => {
    const r = parseExpectConfig({
      kind: "event",
      eventName: " Transfer ",
      contract: " USDC ",
      fromVariable: " {{swaps}} ",
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.config, {
        kind: "event",
        eventName: "Transfer",
        contract: "USDC",
        fromVariable: "swaps",
      });
    }
  });

  it("requires functionName for kind=revert", () => {
    const r = parseExpectConfig({ kind: "revert", args: [] });
    assert.equal(r.ok, false);
  });

  it("normalizes a revert expect", () => {
    const r = parseExpectConfig({
      kind: "revert",
      contract: "Vault",
      functionName: "withdraw",
      args: ["1"],
      reason: "Insufficient",
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.config.kind, "revert");
      assert.equal(r.config.functionName, "withdraw");
      assert.deepEqual(r.config.args, ["1"]);
      assert.equal(r.config.reason, "Insufficient");
    }
  });
});

describe("evaluateExpectCondition", () => {
  it("passes when the condition holds", () => {
    const out = evaluateExpectCondition(
      { kind: "condition", condition: "{{bal}} > 0" },
      { bal: 10n },
    );
    assert.equal(out.ok, true);
    assert.match(out.message, /expect:/);
  });

  it("fails when the condition is false", () => {
    const out = evaluateExpectCondition(
      { kind: "condition", condition: "{{bal}} > 100" },
      { bal: 10n },
    );
    assert.equal(out.ok, false);
    assert.match(out.message, /Expectation failed/);
  });
});

describe("evaluateExpectEvent", () => {
  const sample: DecodedEventEntry[] = [
    {
      address: "0xabc",
      contract: "USDC",
      event: "Transfer",
      args: { from: "0x1", to: "0x2" },
    },
    {
      address: "0xabc",
      contract: "USDC",
      event: "Approval",
    },
  ];

  it("finds an event on the last write", () => {
    const out = evaluateExpectEvent(
      { kind: "event", eventName: "Transfer" },
      {},
      sample,
    );
    assert.equal(out.ok, true);
  });

  it("fails when the event is missing", () => {
    const out = evaluateExpectEvent(
      { kind: "event", eventName: "Deposit" },
      {},
      sample,
    );
    assert.equal(out.ok, false);
    assert.match(out.message, /Deposit/);
  });

  it("filters by contract name", () => {
    const out = evaluateExpectEvent(
      { kind: "event", eventName: "Transfer", contract: "Vault" },
      {},
      sample,
    );
    assert.equal(out.ok, false);
  });

  it("reads events from a scope variable", () => {
    const out = evaluateExpectEvent(
      { kind: "event", eventName: "Approval", fromVariable: "logs" },
      { logs: sample },
      null,
    );
    assert.equal(out.ok, true);
  });

  it("fails when there is no write yet", () => {
    const out = evaluateExpectEvent(
      { kind: "event", eventName: "Transfer" },
      {},
      null,
    );
    assert.equal(out.ok, false);
  });
});

describe("notebook file round-trip with expect", () => {
  const abi = [
    {
      type: "function",
      name: "balanceOf",
      stateMutability: "view",
      inputs: [{ name: "a", type: "address" }],
      outputs: [{ type: "uint256" }],
    },
    {
      type: "function",
      name: "withdraw",
      stateMutability: "nonpayable",
      inputs: [{ name: "amount", type: "uint256" }],
      outputs: [],
    },
  ] as const;

  it("parses condition / event / revert expects", () => {
    const parsed = parseNotebookFile({
      format: NOTEBOOK_FILE_FORMAT,
      version: NOTEBOOK_FILE_VERSION,
      title: "Assert demo",
      description: null,
      chain: { id: 31337 },
      contracts: [
        {
          name: "Token",
          address: "0x0000000000000000000000000000000000000001",
          abi,
        },
      ],
      blocks: [
        {
          type: "expect",
          config: { kind: "condition", condition: "{{bal}} > 0" },
        },
        {
          type: "expect",
          config: { kind: "event", eventName: "Transfer", contract: "Token" },
        },
        {
          type: "expect",
          config: {
            kind: "revert",
            contract: "Token",
            functionName: "withdraw",
            args: ["1"],
            reason: "Empty",
          },
        },
      ],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.file.blocks.length, 3);
    assert.equal(parsed.file.blocks[0].config.kind, "condition");
    assert.equal(parsed.file.blocks[1].config.kind, "event");
    assert.equal(parsed.file.blocks[2].config.kind, "revert");
    assert.equal(parsed.file.blocks[2].config.contract, "Token");
  });

  it("rejects invalid expect configs", () => {
    const parsed = parseNotebookFile({
      format: NOTEBOOK_FILE_FORMAT,
      version: NOTEBOOK_FILE_VERSION,
      title: "Bad",
      chain: { id: 1 },
      contracts: [],
      blocks: [{ type: "expect", config: { kind: "condition" } }],
    });
    assert.equal(parsed.ok, false);
  });

  it("exports revert expects with contract by name", () => {
    const blocks: NotebookBlock[] = [
      {
        id: "e1",
        type: "expect",
        config: {
          kind: "revert",
          contractId: "c1",
          functionName: "withdraw",
          args: ["1"],
          reason: "Nope",
        },
        outputVariable: null,
      },
    ];
    const file = buildNotebookFile(
      { title: "Export", description: null },
      blocks,
      [
        {
          id: "c1",
          projectId: "p",
          name: "Token",
          address: "0x0000000000000000000000000000000000000001",
          abi: [...abi],
          createdAt: 0,
        },
      ],
      31337,
    );
    assert.equal(file.contracts.length, 1);
    assert.equal(file.blocks[0].config.kind, "revert");
    assert.equal(file.blocks[0].config.contract, "Token");
    assert.equal(file.blocks[0].config.contractId, undefined);
  });
});
