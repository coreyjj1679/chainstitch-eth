import "server-only";
import { getAuthContext, type AuthContext } from "@/server/auth-context";
import { ApiError } from "@/server/errors";
import { appMode, appUrl } from "@/server/mode";
import { listProjects } from "@/server/dal/projects";
import { createContract, listContracts } from "@/server/dal/contracts";
import { listNotebooks } from "@/server/dal/notebooks";
import {
  CODE_FLAVORS,
  getNotebookCode,
  getNotebookFile,
  importNotebookFile,
} from "@/server/dal/notebook-files";
import { lookupAbiForProject } from "@/server/abi-lookup";
import {
  eventSignature,
  functionSignature,
  getEvents,
  getFunctions,
  returnsSignature,
} from "@/lib/abi";
import { NOTEBOOK_FILE_FORMAT_DOC } from "@/lib/notebook-file";
import type { Abi, AbiFunction } from "viem";

/**
 * A minimal, stateless MCP server (Streamable HTTP transport, JSON
 * responses) exposing Chainstitch to coding agents: read the address book,
 * author notebooks from manifests, pull a notebook back as a manifest or as
 * generated source. Deliberately no SDK dependency — the surface is small
 * (initialize / tools/list / tools/call) and every tool is a thin wrapper
 * over the same DAL the REST routes use, so authorization is identical.
 *
 * Sessions: none (each request is independent, as the spec's stateless mode
 * allows). Execution tools are intentionally absent: block execution is
 * browser-side by design (see CONTRIBUTING invariants), until the headless
 * runner ships.
 */

const SERVER_NAME = "chainstitch";
const SERVER_VERSION = "0.1.0";
/** Spec revisions this implementation is compatible with. */
const KNOWN_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL_VERSION = "2025-06-18";

const INSTRUCTIONS = `Chainstitch is a notebook tool for smart contracts: blocks (read / write / rpc / event / …) run top-to-bottom against a project's chain, chained by {{variables}}, and every block generates wagmi/viem/python/rust source.

Typical flows:
- Author a notebook from a codebase: list_projects → list_contracts (see what the address book has) → get_notebook_format → create_notebook (embed ABIs for anything missing, e.g. from Foundry/Hardhat artifacts).
- Hand a flow to a frontend: list_notebooks → get_notebook_code with flavor "wagmi" (or "viem") and adapt the returned source.
- get_notebook returns the same portable manifest create_notebook accepts — read one notebook as a template for writing another.

Notes: notebooks are definitions; execution happens in the user's browser (writes are signed by their wallet), so create/import here and let the user hit Run. Numbers in block args are strings in base units (wei). Addresses/ABIs come from the project address book — add_contract can fetch verified ABIs by address.`;

// --- JSON-RPC plumbing --------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

type JsonRpcId = string | number | null;

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

// --- Tool registry ------------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (ctx: AuthContext, args: Record<string, unknown>) => Promise<ToolPayload>;
}

/** Either a JSON payload (pretty-printed for the agent) or plain text. */
type ToolPayload = { json: unknown } | { text: string };

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  throw new ApiError(400, `"${key}" (string) is required`);
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new ApiError(400, `"${key}" must be a positive integer`);
  }
  return n;
}

/** Compact human-readable ABI summary: signatures instead of raw JSON. */
function abiSummary(abi: Abi) {
  const fns = getFunctions(abi);
  const describe = (fn: AbiFunction) => {
    const returns = returnsSignature(fn);
    return `${functionSignature(fn)}${returns ? ` → (${returns})` : ""}`;
  };
  return {
    reads: fns
      .filter((f) => f.stateMutability === "view" || f.stateMutability === "pure")
      .map(describe),
    writes: fns
      .filter((f) => f.stateMutability === "nonpayable" || f.stateMutability === "payable")
      .map(describe),
    events: getEvents(abi).map(eventSignature),
  };
}

function notebookUrl(projectId: string, notebookId: string): string {
  return `${appUrl()}/p/${projectId}/n/${notebookId}`;
}

const TOOLS: ToolDef[] = [
  {
    name: "list_projects",
    description:
      "List the projects in this Chainstitch instance (name, chain id, your role). A project is the unit of scoping: it has one chain, one address book, and its notebooks.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (ctx) => {
      const projects = await listProjects(ctx);
      // rpcUrl stays out of agent context deliberately (it embeds API keys).
      return {
        json: projects.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          chainId: p.chainId,
          role: p.role,
        })),
      };
    },
  },
  {
    name: "list_contracts",
    description:
      "The project's address book: every contract with its address and a compact ABI summary (read/write function signatures and events). Use these names in notebook manifests via config.contract.",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" } },
      required: ["project_id"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const contracts = await listContracts(ctx, str(args, "project_id"));
      return {
        json: contracts.map((c) => ({
          name: c.name,
          address: c.address || null,
          ...abiSummary(c.abi as Abi),
        })),
      };
    },
  },
  {
    name: "add_contract",
    description:
      "Add a contract to the project's address book. Provide an ABI (raw array or Foundry/Hardhat artifact) — or omit it to fetch the verified ABI by address from Sourcify/Blockscout/Etherscan (proxies resolve to their implementation automatically). Requires editor access.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        name: { type: "string", description: "Address-book name; defaults to the verified source name" },
        address: { type: "string", description: "0x… deployment address" },
        abi: {
          description: "Optional ABI JSON (array or artifact object). Omit to auto-fetch by address.",
        },
        chain_id: {
          type: "number",
          description: "Override the lookup chain (e.g. mainnet ABIs for an anvil fork of it)",
        },
      },
      required: ["project_id", "address"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const projectId = str(args, "project_id");
      const address = str(args, "address");
      let abi = args.abi;
      let name = typeof args.name === "string" ? args.name.trim() : "";
      let source: string | undefined;
      if (abi === undefined || abi === null) {
        const lookup = await lookupAbiForProject(
          ctx,
          projectId,
          address,
          optionalNumber(args, "chain_id"),
        );
        if (!lookup.found || !lookup.abi) {
          throw new ApiError(
            404,
            `No verified ABI found for ${address} (tried: ${lookup.tried.join(", ")}${lookup.etherscanConfigured ? "" : "; set ETHERSCAN_API_KEY for wider coverage"}). Pass the ABI explicitly.`,
          );
        }
        abi = lookup.abi;
        source = lookup.source;
        if (!name) name = lookup.name ?? "";
      }
      if (!name) throw new ApiError(400, `"name" is required when the ABI is provided manually`);
      const created = await createContract(ctx, projectId, { name, address, abi });
      return {
        json: {
          id: created.id,
          name: created.name,
          address: created.address,
          ...(source ? { abiSource: source } : {}),
          ...abiSummary(created.abi as Abi),
        },
      };
    },
  },
  {
    name: "list_notebooks",
    description: "List a project's notebooks (title, description, timestamps, id).",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" } },
      required: ["project_id"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const notebooks = await listNotebooks(ctx, str(args, "project_id"));
      return {
        json: notebooks.map((n) => ({
          id: n.id,
          title: n.title,
          description: n.description,
          updatedAt: new Date(n.updatedAt).toISOString(),
          url: notebookUrl(n.projectId, n.id),
        })),
      };
    },
  },
  {
    name: "get_notebook_format",
    description:
      "The portable notebook manifest format (chainstitch-notebook v1): block types, config fields, {{variable}} rules, a full example. Read this before calling create_notebook.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => ({ text: NOTEBOOK_FILE_FORMAT_DOC }),
  },
  {
    name: "get_notebook",
    description:
      "A notebook's full content as a portable manifest (the same shape create_notebook accepts): blocks in order, with the ABIs of every contract they reference.",
    inputSchema: {
      type: "object",
      properties: { notebook_id: { type: "string" } },
      required: ["notebook_id"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => ({
      json: await getNotebookFile(ctx, str(args, "notebook_id")),
    }),
  },
  {
    name: "create_notebook",
    description:
      "Create a notebook in a project from a manifest (call get_notebook_format first). Contracts are matched to the address book by address, then name; missing ones are created from the manifest's ABIs. Returns the notebook URL to hand to the user, plus any warnings. Requires editor access.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        notebook: {
          type: "object",
          description: "A chainstitch-notebook v1 manifest (see get_notebook_format)",
        },
      },
      required: ["project_id", "notebook"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const projectId = str(args, "project_id");
      // Tolerate a double-encoded manifest (agents sometimes stringify it).
      let manifest = args.notebook;
      if (typeof manifest === "string") {
        try {
          manifest = JSON.parse(manifest);
        } catch {
          throw new ApiError(400, `"notebook" is a string but not valid JSON`);
        }
      }
      const result = await importNotebookFile(ctx, projectId, manifest);
      return {
        json: {
          notebookId: result.notebook.id,
          title: result.notebook.title,
          url: notebookUrl(projectId, result.notebook.id),
          blockCount: result.blockCount,
          createdContracts: result.createdContracts,
          warnings: result.warnings,
        },
      };
    },
  },
  {
    name: "get_notebook_code",
    description: `The whole notebook as generated source code, ready to adapt into an app or script. Flavors: ${CODE_FLAVORS.join(", ")} (wagmi = React hooks, viem = TypeScript script, python = web3.py, rust = alloy).`,
    inputSchema: {
      type: "object",
      properties: {
        notebook_id: { type: "string" },
        flavor: { type: "string", enum: [...CODE_FLAVORS] },
      },
      required: ["notebook_id"],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const flavor = typeof args.flavor === "string" ? args.flavor : "wagmi";
      const result = await getNotebookCode(ctx, str(args, "notebook_id"), flavor);
      return { text: `// ${result.title} — ${result.flavor}\n\n${result.code}` };
    },
  },
];

// --- Request handling -----------------------------------------------------------

const TEAM_MODE_MESSAGE =
  "This Chainstitch instance runs in team mode, which the MCP server does not support yet: sign-in is SIWE (a browser wallet signature), which a headless agent cannot perform. API tokens for agents are on the roadmap. Point the agent at a local-mode instance instead — `npm run dev` locally is enough.";

function toolResult(id: JsonRpcId, payload: ToolPayload) {
  const text = "text" in payload ? payload.text : JSON.stringify(payload.json, null, 2);
  return rpcResult(id, { content: [{ type: "text", text }] });
}

function toolError(id: JsonRpcId, message: string) {
  return rpcResult(id, { content: [{ type: "text", text: message }], isError: true });
}

async function handleToolCall(headers: Headers, id: JsonRpcId, params: unknown) {
  const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
  const tool = TOOLS.find((t) => t.name === p.name);
  if (!tool) return rpcError(id, -32602, `Unknown tool "${String(p.name)}"`);
  const args = (p.arguments ?? {}) as Record<string, unknown>;

  let ctx: AuthContext;
  try {
    ctx = await getAuthContext(headers);
  } catch {
    return toolError(id, TEAM_MODE_MESSAGE);
  }

  try {
    return toolResult(id, await tool.handler(ctx, args));
  } catch (error) {
    if (error instanceof ApiError) return toolError(id, error.message);
    console.error(`MCP tool ${tool.name} failed:`, error);
    return toolError(id, "Internal error — see the server logs");
  }
}

/**
 * One stateless Streamable-HTTP exchange: a JSON-RPC request in, a JSON
 * response out (or 202 for notifications). No SSE, no session ids.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error: body must be JSON"), {
      status: 400,
    });
  }
  // JSON-RPC batching was removed in the 2025-06-18 revision; keep it simple.
  if (Array.isArray(body)) {
    return Response.json(
      rpcError(null, -32600, "Batch requests are not supported by this server"),
      { status: 400 },
    );
  }

  const rpc = body as JsonRpcRequest;
  const method = typeof rpc.method === "string" ? rpc.method : "";
  const id: JsonRpcId = rpc.id ?? null;

  // Notifications (no id) get acknowledged without a body.
  if (rpc.id === undefined || method.startsWith("notifications/")) {
    return new Response(null, { status: 202 });
  }

  switch (method) {
    case "initialize": {
      const params = (rpc.params ?? {}) as { protocolVersion?: unknown };
      const requested = String(params.protocolVersion ?? "");
      const protocolVersion = KNOWN_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION;
      const teamNote =
        appMode() === "team" ? `\n\nIMPORTANT: ${TEAM_MODE_MESSAGE}` : "";
      return Response.json(
        rpcResult(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions: INSTRUCTIONS + teamNote,
        }),
      );
    }
    case "ping":
      return Response.json(rpcResult(id, {}));
    case "tools/list":
      return Response.json(
        rpcResult(id, {
          tools: TOOLS.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        }),
      );
    case "tools/call":
      return Response.json(await handleToolCall(request.headers, id, rpc.params));
    // Some clients probe these regardless of advertised capabilities;
    // empty lists keep their logs clean.
    case "resources/list":
      return Response.json(rpcResult(id, { resources: [] }));
    case "prompts/list":
      return Response.json(rpcResult(id, { prompts: [] }));
    default:
      return Response.json(rpcError(id, -32601, `Method not found: ${method}`));
  }
}
