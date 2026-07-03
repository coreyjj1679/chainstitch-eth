import { encodeFunctionData, numberToHex, type Abi, type AbiFunction, type PublicClient } from "viem";
import type { Config } from "wagmi";
import {
  simulateContract,
  waitForTransactionReceipt,
  writeContract,
} from "wagmi/actions";
import { coerceArg, functionSignature, getFunctions } from "@/lib/abi";
import { getRpcMethod, type RpcParamSpec } from "@/lib/rpc-methods";
import { interpolate } from "@/lib/variables";
import type { CallConfig, ContractEntry, NotebookBlock, RpcConfig } from "@/lib/types";

export interface RunContext {
  publicClient: PublicClient;
  contracts: ContractEntry[];
  scope: Record<string, unknown>;
  /** Required for write blocks in execute mode */
  wagmiConfig?: Config;
  account?: `0x${string}`;
  /** "simulate": writes are eth_call'd as `sender` instead of sent */
  mode?: "execute" | "simulate";
  /** Caller for simulated writes (set by "Simulate all as" or a sender block) */
  sender?: `0x${string}`;
  /** Execute writes as `sender` via anvil_impersonateAccount (local forks) */
  impersonate?: boolean;
}

export interface RunOutcome {
  value: unknown;
  txHash?: `0x${string}`;
  simulated?: boolean;
  /** What ran, e.g. "Read call (eth_call)" */
  kind?: string;
  /** Caller (wallet / simulated sender / impersonated account) */
  sender?: string;
  /** Chain head at execution time (receipt block for real writes) */
  blockNumber?: bigint;
  /** Call details: contract, function, inputs, output */
  details?: Record<string, unknown>;
  /** Transaction details: hash, status, gas, logs */
  txDetails?: Record<string, unknown>;
}

/** Best-effort chain head for run metadata; never fails the block run. */
async function headBlockNumber(client: PublicClient): Promise<bigint | undefined> {
  try {
    return await client.getBlockNumber({ cacheTime: 0 });
  } catch {
    return undefined;
  }
}

function findContract(ctx: RunContext, config: CallConfig): ContractEntry {
  const contract = ctx.contracts.find((c) => c.id === config.contractId);
  if (!contract) throw new Error("Select a contract for this block");
  if (!contract.address)
    throw new Error(`"${contract.name}" has no address. Fill it in the address book.`);
  return contract;
}

function getCallFunction(abi: Abi, config: CallConfig): AbiFunction {
  const fn = getFunctions(abi).find((f) => f.name === config.functionName);
  if (!fn) throw new Error("Select a function for this block");
  return fn;
}

function resolveCallArgs(
  fn: AbiFunction,
  config: CallConfig,
  scope: Record<string, unknown>,
): unknown[] {
  return fn.inputs.map((input, i) => {
    const raw = config.args[i] ?? "";
    if (typeof raw === "string" && raw.trim() === "" ) {
      throw new Error(`Missing argument: ${input.name || `#${i + 1}`} (${input.type})`);
    }
    const resolved = interpolate(raw, scope);
    return coerceArg(resolved, input.type);
  });
}

/** Map ABI params to a { name (type): value } object for readable details. */
function namedParams(
  params: readonly { name?: string; type: string }[],
  values: readonly unknown[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  params.forEach((p, i) => {
    const key = p.name ? `${p.name} (${p.type})` : `[${i}] (${p.type})`;
    out[key] = values[i];
  });
  return out;
}

/** Decoded outputs of a read, keyed by param name/type. */
function namedOutputs(fn: AbiFunction, value: unknown): Record<string, unknown> | unknown {
  const outputs = fn.outputs ?? [];
  if (outputs.length === 0) return "(no return value)";
  if (outputs.length === 1) {
    const o = outputs[0];
    return { [o.name ? `${o.name} (${o.type})` : o.type]: value };
  }
  return namedParams(outputs, value as unknown[]);
}

function coerceRpcParam(value: unknown, spec: RpcParamSpec): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (text === "" && spec.optional) return undefined;
  switch (spec.kind) {
    case "bigint":
      return BigInt(text);
    case "bigintOrTag":
      return /^\d+$/.test(text) ? BigInt(text) : text;
    case "json":
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Parameter "${spec.name}" must be valid JSON`);
      }
    default:
      return text;
  }
}

async function runRead(block: NotebookBlock, ctx: RunContext): Promise<RunOutcome> {
  const config = block.config as CallConfig;
  const contract = findContract(ctx, config);
  const fn = getCallFunction(contract.abi, config);
  const args = resolveCallArgs(fn, config, ctx.scope);
  const [value, blockNumber] = await Promise.all([
    ctx.publicClient.readContract({
      address: contract.address as `0x${string}`,
      abi: contract.abi,
      functionName: config.functionName,
      args,
    }),
    headBlockNumber(ctx.publicClient),
  ]);
  return {
    value,
    kind: "Read call (eth_call)",
    blockNumber,
    details: {
      Contract: `${contract.name} @ ${contract.address}`,
      Function: functionSignature(fn),
      ...(fn.inputs.length > 0 ? { Inputs: namedParams(fn.inputs, args) } : {}),
      Output: namedOutputs(fn, value),
    },
  };
}

/** Transaction-tab details from a receipt (shared by wallet + impersonated writes). */
function receiptDetails(
  txHash: string,
  receipt: {
    status: string;
    blockNumber: bigint;
    transactionIndex: number;
    gasUsed: bigint;
    effectiveGasPrice?: bigint;
    logs: readonly unknown[];
  },
): Record<string, unknown> {
  return {
    "Tx hash": txHash,
    Status: receipt.status,
    Block: receipt.blockNumber,
    "Tx index": receipt.transactionIndex,
    "Gas used": receipt.gasUsed,
    ...(receipt.effectiveGasPrice !== undefined
      ? { "Gas price (wei)": receipt.effectiveGasPrice }
      : {}),
    Logs: receipt.logs.length,
  };
}

/** Ensure a caller address is an EOA (no deployed bytecode). */
async function assertEoa(client: PublicClient, address: `0x${string}`): Promise<void> {
  const code = await client.getCode({ address });
  if (code && code !== "0x") {
    throw new Error(
      `Caller ${address} is a contract, not an EOA. Use an externally-owned account.`,
    );
  }
}

async function runWrite(block: NotebookBlock, ctx: RunContext): Promise<RunOutcome> {
  const config = block.config as CallConfig;
  const contract = findContract(ctx, config);
  const fn = getCallFunction(contract.abi, config);
  const args = resolveCallArgs(fn, config, ctx.scope);
  const value =
    config.value && config.value.trim() !== ""
      ? BigInt(String(interpolate(config.value, ctx.scope)))
      : undefined;

  const baseDetails: Record<string, unknown> = {
    Contract: `${contract.name} @ ${contract.address}`,
    Function: functionSignature(fn),
    ...(fn.inputs.length > 0 ? { Inputs: namedParams(fn.inputs, args) } : {}),
    ...(value !== undefined ? { "Value (wei)": value } : {}),
  };

  // Simulate-only mode: eth_call as the scoped sender, nothing is sent on-chain.
  if (ctx.mode === "simulate") {
    const caller = ctx.sender ?? ctx.account;
    if (!caller) {
      throw new Error("Provide a caller address to simulate writes");
    }
    await assertEoa(ctx.publicClient, caller);
    const [{ result }, blockNumber] = await Promise.all([
      ctx.publicClient.simulateContract({
        address: contract.address as `0x${string}`,
        abi: contract.abi,
        functionName: config.functionName,
        args,
        account: caller,
        ...(value !== undefined ? { value } : {}),
      }),
      headBlockNumber(ctx.publicClient),
    ]);
    return {
      value: result === undefined ? "ok (no return value)" : result,
      simulated: true,
      kind: "Write (simulated — nothing sent on-chain)",
      sender: caller,
      blockNumber,
      details: {
        ...baseDetails,
        "Return value":
          result === undefined ? "(no return value)" : namedOutputs(fn, result),
      },
    };
  }

  // Impersonated execution: real tx sent as `sender` via anvil cheatcodes.
  if (ctx.impersonate && ctx.sender) {
    const client = ctx.publicClient;
    await assertEoa(client, ctx.sender);
    await client.request({
      method: "anvil_impersonateAccount" as never,
      params: [ctx.sender] as never,
    });
    const data = encodeFunctionData({
      abi: contract.abi,
      functionName: config.functionName,
      args,
    });
    const txHash = (await client.request({
      method: "eth_sendTransaction" as never,
      params: [
        {
          from: ctx.sender,
          to: contract.address,
          data,
          ...(value !== undefined ? { value: numberToHex(value) } : {}),
        },
      ] as never,
    })) as `0x${string}`;
    const receipt = await client.waitForTransactionReceipt({ hash: txHash });
    return {
      value: receipt,
      txHash,
      kind: "Write (impersonated via anvil)",
      sender: ctx.sender,
      blockNumber: receipt.blockNumber,
      details: baseDetails,
      txDetails: receiptDetails(txHash, receipt),
    };
  }

  if (!ctx.wagmiConfig || !ctx.account) {
    throw new Error("Connect a wallet to run write blocks");
  }

  // Simulate first so revert reasons surface before the wallet prompt.
  const { request } = await simulateContract(ctx.wagmiConfig, {
    address: contract.address as `0x${string}`,
    abi: contract.abi,
    functionName: config.functionName,
    args,
    account: ctx.account,
    ...(value !== undefined ? { value } : {}),
  });
  const txHash = await writeContract(ctx.wagmiConfig, request);
  const receipt = await waitForTransactionReceipt(ctx.wagmiConfig, { hash: txHash });
  return {
    value: receipt,
    txHash,
    kind: "Write (wallet transaction)",
    sender: ctx.account,
    blockNumber: receipt.blockNumber,
    details: baseDetails,
    txDetails: receiptDetails(txHash, receipt),
  };
}

async function runRpc(block: NotebookBlock, ctx: RunContext): Promise<RunOutcome> {
  const config = block.config as RpcConfig;
  const method = getRpcMethod(config.method);
  if (!method) throw new Error(`Unknown RPC method: ${config.method}`);
  const args = method.params.map((spec, i) => {
    const raw = config.params[i] ?? "";
    if (typeof raw === "string" && raw.trim() === "" && !spec.optional) {
      throw new Error(`Missing parameter: ${spec.name}`);
    }
    const resolved = typeof raw === "string" ? interpolate(raw, ctx.scope) : raw;
    return coerceRpcParam(resolved, spec);
  });
  const [value, blockNumber] = await Promise.all([
    method.exec(ctx.publicClient, args),
    headBlockNumber(ctx.publicClient),
  ]);
  const params = args.filter((a) => a !== undefined);
  return {
    value,
    kind: "JSON-RPC call",
    blockNumber,
    details: {
      Method: method.label,
      ...(params.length > 0 ? { Params: params } : {}),
      Output: value,
    },
  };
}

export async function runBlock(
  block: NotebookBlock,
  ctx: RunContext,
): Promise<RunOutcome> {
  switch (block.type) {
    case "read":
      return runRead(block, ctx);
    case "write":
      return runWrite(block, ctx);
    case "rpc":
      return runRpc(block, ctx);
    default:
      // markdown and sender blocks don't execute anything themselves
      return { value: undefined };
  }
}

export function shortError(error: unknown): string {
  if (error instanceof Error) {
    // viem errors carry verbose metadata after the first blank line
    const message = "shortMessage" in error && typeof error.shortMessage === "string"
      ? error.shortMessage
      : error.message;
    return message.split("\n\n")[0];
  }
  return String(error);
}
