/**
 * Chainstitch CLI — headless notebook runner.
 *
 *   chainstitch run <file.notebook.json> [--rpc-url …] [--fork-url …] …
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { parseNotebookFile } from "@/lib/notebook-file";
import { runNotebook } from "@/lib/run-notebook";
import { blockLabel } from "@/lib/block-label";
import type { ContractEntry, NotebookBlock } from "@/lib/types";

interface RunFlags {
  file: string;
  rpcUrl: string;
  forkUrl: string | null;
  chainId: number;
  privateKey: `0x${string}` | null;
  simulate: boolean;
  timeoutMs: number;
}

function usage(): never {
  console.error(`Usage:
  chainstitch run <notebook.json> [options]

Options:
  --rpc-url <url>       Existing RPC (default http://127.0.0.1:8545)
  --fork-url <url>      Spawn anvil --fork-url on an ephemeral port
  --chain-id <n>        Expected chain id (default: notebook's chain.id, or 31337)
  --private-key <hex>   Sign writes (otherwise use sender impersonation on anvil)
  --simulate            eth_call writes instead of sending transactions
  --timeout-ms <n>      Overall run timeout (default 120000)

Exit codes: 0 = all expects passed, 1 = failure / usage error.`);
  process.exit(2);
}

function parseArgs(argv: string[]): { cmd: string; flags: RunFlags } {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") usage();
  const cmd = argv[0];
  if (cmd !== "run") {
    console.error(`Unknown command "${cmd}"`);
    usage();
  }
  const rest = argv.slice(1);
  let file: string | null = null;
  const flags: Omit<RunFlags, "file"> = {
    rpcUrl: "http://127.0.0.1:8545",
    forkUrl: null,
    chainId: 0,
    privateKey: null,
    simulate: false,
    timeoutMs: 120_000,
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--rpc-url") flags.rpcUrl = rest[++i] ?? usage();
    else if (a === "--fork-url") flags.forkUrl = rest[++i] ?? usage();
    else if (a === "--chain-id") flags.chainId = Number(rest[++i] ?? usage());
    else if (a === "--private-key") {
      const key = rest[++i] ?? usage();
      flags.privateKey = (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
    } else if (a === "--simulate") flags.simulate = true;
    else if (a === "--timeout-ms") flags.timeoutMs = Number(rest[++i] ?? usage());
    else if (a.startsWith("-")) {
      console.error(`Unknown option ${a}`);
      usage();
    } else if (!file) file = a;
    else {
      console.error(`Unexpected argument ${a}`);
      usage();
    }
  }
  if (!file) usage();
  return { cmd, flags: { ...flags, file } };
}

function freePort(): Promise<number> {
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

async function waitForRpc(url: string, timeoutMs: number): Promise<void> {
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

async function spawnAnvil(forkUrl: string): Promise<{
  url: string;
  child: ChildProcess;
  chainId: number;
}> {
  const port = await freePort();
  const args = ["--port", String(port), "--fork-url", forkUrl, "--silent"];
  const child = spawn("anvil", args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => {
    stderr += d.toString();
  });
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForRpc(url, 30_000);
  } catch (e) {
    child.kill("SIGTERM");
    const hint =
      stderr.trim() ||
      (e instanceof Error ? e.message : String(e));
    throw new Error(
      `Failed to start anvil (${hint}). Install Foundry: https://book.getfoundry.sh/getting-started/installation`,
    );
  }
  // Read chain id from the fork
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

function fileToBlocks(filePath: string): {
  title: string;
  chainId: number;
  blocks: NotebookBlock[];
  contracts: ContractEntry[];
} {
  const raw = JSON.parse(readFileSync(resolve(filePath), "utf8"));
  const parsed = parseNotebookFile(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const file = parsed.file;

  // Mint stable in-memory contract ids from names.
  const contracts: ContractEntry[] = file.contracts.map((c, i) => ({
    id: `file-${i}`,
    projectId: "cli",
    name: c.name,
    address: c.address,
    abi: c.abi,
    createdAt: 0,
  }));
  const idByName = new Map(
    contracts.map((c) => [c.name.toLowerCase(), c.id] as const),
  );

  const idMap = new Map<string, string>();
  for (const b of file.blocks) {
    if (b.id) idMap.set(b.id, b.id);
  }
  // Ensure every block has an id for parent links.
  const blocks: NotebookBlock[] = file.blocks.map((b, i) => {
    const id = b.id ?? `b-${i}`;
    if (b.id) idMap.set(b.id, id);
    const config = { ...b.config };
    if (typeof config.contract === "string") {
      const eventFilter =
        b.type === "expect" && config.kind === "event";
      if (!eventFilter) {
        const cid = idByName.get(String(config.contract).toLowerCase());
        if (!cid) {
          throw new Error(
            `Block ${i + 1}: unknown contract "${config.contract}" in file contracts`,
          );
        }
        config.contractId = cid;
        delete config.contract;
      }
    }
    return {
      id,
      type: b.type,
      config: config as unknown as NotebookBlock["config"],
      outputVariable: b.outputVariable ?? null,
      parentId: b.parentId ? (idMap.get(b.parentId) ?? b.parentId) : null,
      runWhen: b.runWhen ?? null,
    };
  });

  // Remap parentIds after all ids are known
  for (const b of blocks) {
    if (b.parentId && idMap.has(b.parentId)) {
      b.parentId = idMap.get(b.parentId)!;
    }
  }

  return {
    title: file.title,
    chainId: file.chain.id,
    blocks,
    contracts,
  };
}

async function cmdRun(flags: RunFlags): Promise<number> {
  const { title, chainId: fileChainId, blocks, contracts } = fileToBlocks(
    flags.file,
  );

  let rpcUrl = flags.rpcUrl;
  let anvil: ChildProcess | null = null;
  let runtimeChainId = flags.chainId || fileChainId || 31337;

  try {
    if (flags.forkUrl) {
      console.error(`Spawning anvil --fork-url ${flags.forkUrl}…`);
      const spawned = await spawnAnvil(flags.forkUrl);
      anvil = spawned.child;
      rpcUrl = spawned.url;
      if (!flags.chainId) runtimeChainId = spawned.chainId;
      console.error(`anvil ready at ${rpcUrl} (chain ${runtimeChainId})`);
    }

    const expected = flags.chainId || fileChainId;
    if (expected && fileChainId && expected !== fileChainId) {
      console.error(
        `Chain id mismatch: notebook declares ${fileChainId}, --chain-id is ${expected}`,
      );
      return 1;
    }
    if (fileChainId && flags.forkUrl && runtimeChainId !== fileChainId) {
      // Fork may be the right network; hard-fail only when user passed --chain-id
      if (flags.chainId && flags.chainId !== runtimeChainId) {
        console.error(
          `Chain id mismatch: fork is ${runtimeChainId}, --chain-id is ${flags.chainId}`,
        );
        return 1;
      }
    }
    if (fileChainId && !flags.forkUrl && !flags.chainId) {
      // Using default local anvil — notebook must be 31337 or user must pass ids
      const clientProbe = createPublicClient({
        chain: { ...foundry, id: runtimeChainId },
        transport: http(rpcUrl),
      });
      const live = await clientProbe.getChainId();
      if (fileChainId !== live) {
        console.error(
          `Chain id mismatch: notebook declares ${fileChainId}, RPC reports ${live}. Pass --fork-url or --chain-id.`,
        );
        return 1;
      }
      runtimeChainId = live;
    }

    const chain = { ...foundry, id: runtimeChainId };
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    }) as PublicClient;

    let localSigner: Parameters<typeof runNotebook>[1]["localSigner"];
    if (flags.privateKey) {
      const account = privateKeyToAccount(flags.privateKey);
      localSigner = {
        account,
        walletClient: createWalletClient({
          account,
          chain,
          transport: http(rpcUrl),
        }),
      };
    }

    console.error(`Running "${title}" (${blocks.length} blocks)…`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), flags.timeoutMs);

    const summary = await runNotebook(blocks, {
      publicClient,
      contracts,
      mode: flags.simulate ? "simulate" : "execute",
      localSigner,
      signal: controller.signal,
      onBlockResult: (id, result) => {
        const block = blocks.find((b) => b.id === id);
        const label = block
          ? blockLabel(block, contracts)
          : id;
        const status = result.status.padEnd(7);
        if (result.status === "error") {
          console.error(`FAIL  ${label}: ${result.error}`);
        } else if (result.status === "skipped") {
          console.error(`SKIP  ${label}`);
        } else if (result.status === "success") {
          console.error(`PASS  ${label}`);
        } else if (result.status === "running") {
          // silence
        }
        void status;
      },
    });
    clearTimeout(timer);

    console.error(
      `\n${summary.succeeded} passed, ${summary.failed} failed, ${summary.skipped} skipped`,
    );
    if (!summary.ok && summary.failedBlockId) {
      const block = blocks.find((b) => b.id === summary.failedBlockId);
      const label = block ? blockLabel(block, contracts) : summary.failedBlockId;
      console.error(`Stopped at: ${label}`);
    }
    return summary.ok ? 0 : 1;
  } finally {
    if (anvil) {
      anvil.kill("SIGTERM");
    }
  }
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  if (cmd === "run") {
    const code = await cmdRun(flags);
    process.exit(code);
  }
  usage();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
