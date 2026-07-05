import "server-only";
import { isAddress, type Abi } from "viem";
import { validateAbi } from "@/lib/abi";
import type { AbiLookupResult } from "@/lib/types";
import type { AuthContext } from "@/server/auth-context";
import { badRequest } from "@/server/errors";
import { requireProject } from "@/server/dal/projects";

/**
 * Fetch a verified contract ABI by address from public explorer APIs:
 * Etherscan v2 (when ETHERSCAN_API_KEY is set), Sourcify, and Blockscout.
 *
 * SSRF guard (see docs/editions-plan.md): every outbound URL is built from
 * the fixed hosts below — user input only ever lands in the path/query as a
 * validated 0x address and a numeric chain id. Redirects are refused, every
 * request carries a timeout, and responses are size-capped before parsing.
 */

const TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const SOURCIFY_HOST = "https://sourcify.dev";
const ETHERSCAN_HOST = "https://api.etherscan.io";

/** Blockscout is per-chain; only these fixed instances are ever contacted. */
const BLOCKSCOUT_HOSTS: Record<number, string> = {
  1: "https://eth.blockscout.com",
  10: "https://optimism.blockscout.com",
  100: "https://gnosis.blockscout.com",
  137: "https://polygon.blockscout.com",
  324: "https://zksync.blockscout.com",
  8453: "https://base.blockscout.com",
  42161: "https://arbitrum.blockscout.com",
  534352: "https://scroll.blockscout.com",
  11155111: "https://eth-sepolia.blockscout.com",
  84532: "https://base-sepolia.blockscout.com",
  421614: "https://arbitrum-sepolia.blockscout.com",
  11155420: "https://optimism-sepolia.blockscout.com",
};

/** Guarded fetch: no redirects, bounded time and size, JSON only. */
async function fetchJson(url: string): Promise<unknown | null> {
  const res = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok && res.status !== 404) return null;
  const text = await res.text();
  if (text.length > MAX_RESPONSE_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface SourceHit {
  source: "etherscan" | "sourcify" | "blockscout";
  name?: string;
  abi: Abi;
  /** Implementation address when the explorer flags the contract as a proxy. */
  implementationAddress?: string;
}

function cleanName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.trim().slice(0, 128);
  return name.length > 0 ? name : undefined;
}

/** Accepts an ABI candidate (array or JSON string); undefined when invalid. */
function cleanAbi(raw: unknown): Abi | undefined {
  if (raw == null) return undefined;
  const validation = validateAbi(raw);
  return validation.ok ? validation.abi : undefined;
}

async function fromEtherscan(
  chainId: number,
  address: string,
  apiKey: string,
): Promise<SourceHit | null> {
  const url =
    `${ETHERSCAN_HOST}/v2/api?chainid=${chainId}&module=contract` +
    `&action=getsourcecode&address=${address}&apikey=${apiKey}`;
  const json = (await fetchJson(url)) as {
    status?: string;
    result?: Array<{
      ABI?: string;
      ContractName?: string;
      Proxy?: string;
      Implementation?: string;
    }>;
  } | null;
  const entry = json?.status === "1" ? json.result?.[0] : undefined;
  const abi = cleanAbi(entry?.ABI);
  if (!entry || !abi) return null;
  return {
    source: "etherscan",
    name: cleanName(entry.ContractName),
    abi,
    implementationAddress:
      entry.Proxy === "1" && entry.Implementation?.startsWith("0x")
        ? entry.Implementation
        : undefined,
  };
}

async function fromSourcify(
  chainId: number,
  address: string,
): Promise<SourceHit | null> {
  const url =
    `${SOURCIFY_HOST}/server/v2/contract/${chainId}/${address}` +
    `?fields=abi,compilation`;
  const json = (await fetchJson(url)) as {
    match?: string | null;
    abi?: unknown;
    compilation?: { name?: string };
  } | null;
  const abi = cleanAbi(json?.abi);
  if (!json?.match || !abi) return null;
  // Sourcify has no proxy metadata; the client falls back to an EIP-1967
  // storage-slot read against the project RPC.
  return { source: "sourcify", name: cleanName(json.compilation?.name), abi };
}

async function fromBlockscout(
  chainId: number,
  address: string,
): Promise<SourceHit | null> {
  const host = BLOCKSCOUT_HOSTS[chainId];
  if (!host) return null;
  const json = (await fetchJson(`${host}/api/v2/smart-contracts/${address}`)) as {
    abi?: unknown;
    name?: string;
    implementations?: Array<{ address?: string; address_hash?: string }>;
  } | null;
  const abi = cleanAbi(json?.abi);
  if (!abi) return null;
  const impl = json?.implementations?.[0];
  const implementationAddress = impl?.address ?? impl?.address_hash;
  return {
    source: "blockscout",
    name: cleanName(json?.name),
    abi,
    implementationAddress: implementationAddress?.startsWith("0x")
      ? implementationAddress
      : undefined,
  };
}

/** All sources for one address, in parallel; first hit by priority wins. */
async function race(chainId: number, address: string): Promise<{
  hit: SourceHit | null;
  tried: string[];
}> {
  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  const attempts: Array<{ name: string; run: Promise<SourceHit | null> }> = [];
  if (apiKey) {
    attempts.push({
      name: "etherscan",
      run: fromEtherscan(chainId, address, apiKey),
    });
  }
  attempts.push({ name: "sourcify", run: fromSourcify(chainId, address) });
  if (BLOCKSCOUT_HOSTS[chainId]) {
    attempts.push({ name: "blockscout", run: fromBlockscout(chainId, address) });
  }

  const settled = await Promise.allSettled(attempts.map((a) => a.run));
  const hits = settled.map((r) => (r.status === "fulfilled" ? r.value : null));
  const hit = hits.find((h) => h !== null) ?? null;
  // Sources disagree on proxy metadata (Sourcify has none): keep the
  // priority hit but adopt a proxy hint any other source reported.
  if (hit && !hit.implementationAddress) {
    hit.implementationAddress = hits.find(
      (h) => h?.implementationAddress,
    )?.implementationAddress;
  }
  return { hit, tried: attempts.map((a) => a.name) };
}

/**
 * The route entry point: editor-gated like contract creation (the result's
 * only purpose is to create an address-book entry), with `chainId` optionally
 * overriding the project chain so fork users can fetch from the source chain.
 * Gate and validation run before any outbound request.
 */
export async function lookupAbiForProject(
  ctx: AuthContext,
  projectId: string,
  address: string,
  chainId?: number,
): Promise<AbiLookupResult> {
  const project = await requireProject(ctx, projectId, "editor");
  if (!isAddress(address)) throw badRequest("address must be a valid 0x… address");
  const chain = chainId ?? project.chainId;
  if (!Number.isSafeInteger(chain) || chain <= 0) {
    throw badRequest("chainId must be a positive integer");
  }
  return lookupAbi(chain, address);
}

/**
 * Look up a verified ABI for `address` on `chainId`. When the explorer flags
 * a proxy, the implementation ABI is resolved one level deep and returned in
 * place of the proxy's own ABI (the app's address-book convention: proxy
 * address + implementation ABI).
 */
export async function lookupAbi(
  chainId: number,
  address: string,
): Promise<AbiLookupResult> {
  const etherscanConfigured = !!process.env.ETHERSCAN_API_KEY?.trim();
  const { hit, tried } = await race(chainId, address);
  if (!hit) return { found: false, tried, etherscanConfigured };

  if (hit.implementationAddress) {
    const impl = await race(chainId, hit.implementationAddress);
    return {
      found: true,
      source: hit.source,
      // The implementation's name describes the contract better than
      // "TransparentUpgradeableProxy"; keep the proxy's as a fallback.
      name: impl.hit?.name ?? hit.name,
      abi: impl.hit?.abi ?? hit.abi,
      implementation: {
        address: hit.implementationAddress,
        name: impl.hit?.name,
        abiResolved: !!impl.hit,
      },
      tried,
      etherscanConfigured,
    };
  }

  return {
    found: true,
    source: hit.source,
    name: hit.name,
    abi: hit.abi,
    implementation: null,
    tried,
    etherscanConfigured,
  };
}
