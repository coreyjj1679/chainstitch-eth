/**
 * Anvil / Hardhat cheatcode helpers usable from the browser or Node.
 * Snapshot+revert lets a stateful dry-run mutate a fork then leave it clean.
 */

import type { PublicClient } from "viem";

/** True when the RPC speaks anvil cheatcodes (local fork or `anvil --fork-url`). */
export async function isAnvilRpc(client: PublicClient): Promise<boolean> {
  try {
    await client.request({
      method: "anvil_nodeInfo" as never,
      params: [] as never,
    });
    return true;
  } catch {
    // Fall through — some builds omit nodeInfo but still support snapshots.
  }
  try {
    const id = await client.request({
      method: "evm_snapshot" as never,
      params: [] as never,
    });
    await client.request({
      method: "evm_revert" as never,
      params: [id] as never,
    });
    return true;
  } catch {
    return false;
  }
}

export async function evmSnapshot(client: PublicClient): Promise<`0x${string}`> {
  const id = await client.request({
    method: "evm_snapshot" as never,
    params: [] as never,
  });
  return id as `0x${string}`;
}

export async function evmRevert(
  client: PublicClient,
  snapshotId: `0x${string}`,
): Promise<void> {
  const ok = await client.request({
    method: "evm_revert" as never,
    params: [snapshotId] as never,
  });
  if (!ok) throw new Error("evm_revert failed — fork state may be dirty");
}
