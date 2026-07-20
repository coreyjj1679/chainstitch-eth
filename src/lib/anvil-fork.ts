/**
 * Spawn an ephemeral `anvil --fork-url` for headless stateful simulation.
 * Shared by the CLI and the server-side notebook simulate path.
 * Requires the `anvil` binary on PATH (Foundry).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Could not allocate a free port"));
        return;
      }
      const port = addr.port;
      server.close((err) => (err ? reject(err) : resolvePort(port)));
    });
  });
}

export async function waitForRpc(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for RPC at ${url}`);
}

export async function spawnAnvilFork(forkUrl: string): Promise<{
  url: string;
  child: ChildProcess;
  chainId: number;
}> {
  const port = await freePort();
  // --steps-tracing helps decoded revert traces on the fork; keep accounts low
  // so small hosts (512 MB VPS) have a chance.
  const args = [
    "--port",
    String(port),
    "--fork-url",
    forkUrl,
    "--silent",
    "--accounts",
    "1",
  ];
  const child = spawn("anvil", args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => {
    stderr += d.toString();
  });
  child.on("error", (err) => {
    stderr += err.message;
  });
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForRpc(url, 45_000);
  } catch (e) {
    child.kill("SIGTERM");
    const hint =
      stderr.trim() ||
      (e instanceof Error ? e.message : String(e));
    const missing =
      /ENOENT|not found|anvil/i.test(hint) || stderr === "";
    throw new Error(
      missing
        ? `anvil is not available (${hint || "spawn failed"}). Install Foundry: https://book.getfoundry.sh/getting-started/installation`
        : `Failed to start anvil (${hint})`,
    );
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_chainId",
      params: [],
    }),
  });
  const body = (await res.json()) as { result?: string };
  const chainId = Number.parseInt(body.result ?? "0x7a69", 16);
  return { url, child, chainId };
}
