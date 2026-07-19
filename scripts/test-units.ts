/**
 * Unit tests for unit-aware amount helpers.
 * Run: npm run test:units
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  baseToHuman,
  contractHasDecimals,
  displayAbiValue,
  humanToBase,
  isAmountLikeParam,
  isAmountLikeReturn,
  looksLikeEnsName,
  parseAbiDetailLabel,
} from "../src/lib/units";
import type { Abi } from "viem";

describe("humanToBase / baseToHuman", () => {
  it("converts 1.5 USDC (6 decimals)", () => {
    const r = humanToBase("1.5", 6);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.base, "1500000");
    assert.equal(baseToHuman("1500000", 6), "1.5");
  });

  it("converts 1 ETH (18 decimals)", () => {
    const r = humanToBase("1", 18);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.base, "1000000000000000000");
  });

  it("rejects invalid amounts", () => {
    const r = humanToBase("nope", 18);
    assert.equal(r.ok, false);
  });

  it("rejects variables in human mode", () => {
    const r = humanToBase("{{amt}}", 18);
    assert.equal(r.ok, false);
  });
});

describe("amount heuristics", () => {
  it("detects amount-like params", () => {
    assert.equal(isAmountLikeParam("amount", "uint256"), true);
    assert.equal(isAmountLikeParam("assets", "uint256"), true);
    assert.equal(isAmountLikeParam("to", "address"), false);
    assert.equal(isAmountLikeParam("tokenId", "uint256"), false);
  });

  it("detects amount-like returns", () => {
    assert.equal(isAmountLikeReturn("balanceOf", undefined, "uint256"), true);
    assert.equal(isAmountLikeReturn("decimals", undefined, "uint8"), false);
    assert.equal(isAmountLikeReturn("transfer", "value", "uint256"), true);
  });
});

describe("parseAbiDetailLabel", () => {
  it("parses name (type)", () => {
    assert.deepEqual(parseAbiDetailLabel("amount (uint256)"), {
      name: "amount",
      type: "uint256",
    });
    assert.deepEqual(parseAbiDetailLabel("uint256"), null);
  });
});

describe("displayAbiValue", () => {
  it("formats amount returns with decimals", () => {
    const text = displayAbiValue(1500000n, {
      type: "uint256",
      functionName: "balanceOf",
      decimals: 6,
      unitLabel: "USDC",
    });
    assert.equal(text, "1.5 USDC (1500000)");
  });

  it("leaves non-amount integers raw", () => {
    const text = displayAbiValue(6n, {
      type: "uint8",
      name: "decimals",
      functionName: "decimals",
      decimals: 6,
    });
    assert.equal(text, "6");
  });
});

describe("looksLikeEnsName", () => {
  it("accepts vitalik.eth", () => {
    assert.equal(looksLikeEnsName("vitalik.eth"), true);
  });
  it("rejects addresses and variables", () => {
    assert.equal(looksLikeEnsName("0xabc"), false);
    assert.equal(looksLikeEnsName("{{addr}}"), false);
  });
});

describe("contractHasDecimals", () => {
  it("detects ERC-20 decimals()", () => {
    const abi = [
      {
        type: "function",
        name: "decimals",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint8" }],
      },
    ] as Abi;
    assert.equal(contractHasDecimals(abi), true);
    assert.equal(contractHasDecimals([]), false);
  });
});
