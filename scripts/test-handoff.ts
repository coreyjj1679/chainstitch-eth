/**
 * Unit tests for the integration handoff brief builder.
 * Run: npm run test:handoff
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Abi } from "viem";
import {
  buildNotebookHandoffBrief,
  handoffBackendSteps,
  handoffFrontendSteps,
  variableRootsInBlock,
} from "../src/lib/notebook-handoff";
import type { ContractEntry, NotebookBlock } from "../src/lib/types";

const erc20Abi = [
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
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as Abi;

const contracts: ContractEntry[] = [
  {
    id: "c1",
    projectId: "p1",
    name: "USDC",
    address: "0x0000000000000000000000000000000000000001",
    abi: erc20Abi,
    createdAt: 0,
  },
];

describe("variableRootsInBlock", () => {
  it("extracts root names from args and runWhen", () => {
    const block: NotebookBlock = {
      id: "b1",
      type: "write",
      config: {
        contractId: "c1",
        functionName: "approve",
        args: ["{{spender}}", "{{amt.raw}}"],
      },
      outputVariable: null,
      runWhen: "{{allowance}} < {{amt}}",
    };
    const roots = variableRootsInBlock(block).sort();
    assert.deepEqual(roots, ["allowance", "amt", "spender"]);
  });
});

describe("buildNotebookHandoffBrief", () => {
  const blocks: NotebookBlock[] = [
    {
      id: "m1",
      type: "markdown",
      config: { text: "# Deposit flow\n\nApprove then check balance." },
      outputVariable: null,
    },
    {
      id: "v1",
      type: "variable",
      config: { name: "spender", value: "0xabc" },
      outputVariable: null,
    },
    {
      id: "w1",
      type: "write",
      config: {
        contractId: "c1",
        functionName: "approve",
        args: ["{{spender}}", "1000000"],
      },
      outputVariable: "approval",
    },
    {
      id: "e1",
      type: "expect",
      config: {
        kind: "event",
        eventName: "Approval",
        contract: "USDC",
      },
      outputVariable: null,
    },
    {
      id: "r1",
      type: "read",
      config: {
        contractId: "c1",
        functionName: "balanceOf",
        args: ["{{spender}}"],
      },
      outputVariable: "balance",
    },
  ];

  it("captures intent, call surface, expect-event, and variables", () => {
    const brief = buildNotebookHandoffBrief(blocks, contracts, {
      title: "Deposit",
      description: "demo",
      chainId: 1,
    });
    assert.equal(brief.intent, "Deposit flow");
    assert.equal(brief.title, "Deposit");
    assert.equal(brief.chainId, 1);

    const write = brief.steps.find((s) => s.blockId === "w1");
    assert.ok(write);
    assert.equal(write.contract, "USDC");
    assert.equal(write.signature, "approve(address spender, uint256 amount)");
    assert.equal(write.outputVariable, "approval");
    assert.equal(write.args?.[0].value, "{{spender}}");

    assert.equal(brief.events.length, 1);
    assert.equal(brief.events[0].source, "expect");
    assert.equal(brief.events[0].eventName, "Approval");
    assert.match(brief.events[0].signature ?? "", /Approval\(/);
    assert.ok(brief.events[0].inputs?.some((i) => i.name === "spender"));

    const spender = brief.variables.find((v) => v.name === "spender");
    assert.ok(spender);
    assert.equal(spender.constantValue, "0xabc");
    assert.ok(spender.consumedBy.includes("w1"));
    assert.ok(spender.consumedBy.includes("r1"));

    const balance = brief.variables.find((v) => v.name === "balance");
    assert.ok(balance);
    assert.equal(balance.producedByBlockId, "r1");

    assert.deepEqual(brief.contracts, [
      { name: "USDC", address: "0x0000000000000000000000000000000000000001" },
    ]);
  });

  it("splits frontend vs backend steps", () => {
    const brief = buildNotebookHandoffBrief(blocks, contracts, {
      title: "Deposit",
      chainId: 1,
    });
    const fe = handoffFrontendSteps(brief);
    assert.ok(fe.some((s) => s.type === "write"));
    assert.ok(fe.some((s) => s.role === "intent"));
    const be = handoffBackendSteps(brief);
    assert.ok(be.some((s) => s.type === "expect"));
  });

  it("catalogs event-query blocks", () => {
    const withQuery: NotebookBlock[] = [
      {
        id: "q1",
        type: "event",
        config: {
          contractId: "c1",
          eventName: "Transfer",
          filters: ["", "{{to}}", ""],
        },
        outputVariable: "transfers",
      },
    ];
    const brief = buildNotebookHandoffBrief(withQuery, contracts, {
      title: "Logs",
      chainId: 1,
    });
    assert.equal(brief.events.length, 1);
    assert.equal(brief.events[0].source, "event-block");
    assert.equal(brief.events[0].fromVariable, "transfers");
    assert.match(brief.events[0].signature ?? "", /Transfer\(/);
  });
});
