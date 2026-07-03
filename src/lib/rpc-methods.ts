import type { PublicClient } from "viem";

export interface RpcParamSpec {
  name: string;
  placeholder: string;
  /** How the raw string is coerced before the call */
  kind: "string" | "bigintOrTag" | "bigint" | "json";
  optional?: boolean;
}

export interface RpcMethodSpec {
  id: string;
  label: string;
  description: string;
  params: RpcParamSpec[];
  exec: (client: PublicClient, args: unknown[]) => Promise<unknown>;
  /** viem code template; argN placeholders are substituted by codegen */
  viemCode: (args: string[]) => string;
}

function toBlockArg(value: unknown): { blockNumber: bigint } | { blockTag: "latest" | "earliest" | "pending" | "safe" | "finalized" } {
  if (typeof value === "bigint") return { blockNumber: value };
  const text = String(value ?? "latest").trim() || "latest";
  if (/^\d+$/.test(text)) return { blockNumber: BigInt(text) };
  return { blockTag: text as "latest" };
}

export const RPC_METHODS: RpcMethodSpec[] = [
  {
    id: "getBlockNumber",
    label: "getBlockNumber",
    description: "Current block number",
    params: [],
    exec: (client) => client.getBlockNumber(),
    viemCode: () => `await client.getBlockNumber()`,
  },
  {
    id: "getBlock",
    label: "getBlock",
    description: "Block by number or tag",
    params: [
      { name: "block", placeholder: "latest | 19000000", kind: "bigintOrTag", optional: true },
    ],
    exec: (client, [block]) => client.getBlock(toBlockArg(block)),
    viemCode: ([block]) => `await client.getBlock(${block})`,
  },
  {
    id: "getBalance",
    label: "getBalance",
    description: "Native token balance of an address",
    params: [{ name: "address", placeholder: "0x…", kind: "string" }],
    exec: (client, [address]) => client.getBalance({ address: address as `0x${string}` }),
    viemCode: ([address]) => `await client.getBalance({ address: ${address} })`,
  },
  {
    id: "getTransaction",
    label: "getTransaction",
    description: "Transaction by hash",
    params: [{ name: "hash", placeholder: "0x…", kind: "string" }],
    exec: (client, [hash]) => client.getTransaction({ hash: hash as `0x${string}` }),
    viemCode: ([hash]) => `await client.getTransaction({ hash: ${hash} })`,
  },
  {
    id: "getTransactionReceipt",
    label: "getTransactionReceipt",
    description: "Receipt for a mined transaction",
    params: [{ name: "hash", placeholder: "0x…", kind: "string" }],
    exec: (client, [hash]) =>
      client.getTransactionReceipt({ hash: hash as `0x${string}` }),
    viemCode: ([hash]) => `await client.getTransactionReceipt({ hash: ${hash} })`,
  },
  {
    id: "getGasPrice",
    label: "getGasPrice",
    description: "Current gas price (wei)",
    params: [],
    exec: (client) => client.getGasPrice(),
    viemCode: () => `await client.getGasPrice()`,
  },
  {
    id: "getChainId",
    label: "getChainId",
    description: "Chain id reported by the RPC",
    params: [],
    exec: (client) => client.getChainId(),
    viemCode: () => `await client.getChainId()`,
  },
  {
    id: "getCode",
    label: "getCode",
    description: "Deployed bytecode at an address",
    params: [{ name: "address", placeholder: "0x…", kind: "string" }],
    exec: (client, [address]) => client.getCode({ address: address as `0x${string}` }),
    viemCode: ([address]) => `await client.getCode({ address: ${address} })`,
  },
  {
    id: "getStorageAt",
    label: "getStorageAt",
    description: "Raw storage slot value",
    params: [
      { name: "address", placeholder: "0x…", kind: "string" },
      { name: "slot", placeholder: "0x0", kind: "string" },
    ],
    exec: (client, [address, slot]) =>
      client.getStorageAt({
        address: address as `0x${string}`,
        slot: slot as `0x${string}`,
      }),
    viemCode: ([address, slot]) =>
      `await client.getStorageAt({ address: ${address}, slot: ${slot} })`,
  },
  {
    id: "getLogs",
    label: "getLogs",
    description: "Logs matching a filter (JSON)",
    params: [
      {
        name: "filter",
        placeholder: '{ "address": "0x…", "fromBlock": "latest" }',
        kind: "json",
        optional: true,
      },
    ],
    exec: (client, [filter]) =>
      client.getLogs((filter ?? {}) as Parameters<PublicClient["getLogs"]>[0]),
    viemCode: ([filter]) => `await client.getLogs(${filter})`,
  },
  {
    id: "custom",
    label: "Custom RPC request",
    description: "Raw JSON-RPC method and params",
    params: [
      { name: "method", placeholder: "anvil_impersonateAccount", kind: "string" },
      { name: "params", placeholder: '["0x…"]', kind: "json", optional: true },
    ],
    exec: (client, [method, params]) =>
      client.request({
        method: method as never,
        params: (params ?? []) as never,
      }),
    viemCode: ([method, params]) =>
      `await client.request({ method: ${method}, params: ${params} })`,
  },
];

export function getRpcMethod(id: string): RpcMethodSpec | undefined {
  return RPC_METHODS.find((m) => m.id === id);
}
