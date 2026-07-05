/**
 * AI import: convert pasted Foundry test files (.t.sol) into notebook blocks
 * with Gemini. Everything runs client-side — the user's Google AI Studio key
 * goes from their browser straight to Google, matching the "the server never
 * touches keys" stance (RPC URLs work the same way).
 *
 * Flow: (optional) pre-flight audit of what the tests need → conversion in
 * JSON mode over every provided file (test + imported interfaces + Foundry
 * artifacts) → deterministic validation/mapping against the address book →
 * one repair retry with the errors appended if a response was unusable.
 */

import { getFunctions } from "@/lib/abi";
import { isGroupType } from "@/lib/block-label";
import { RPC_METHODS } from "@/lib/rpc-methods";
import type { Abi } from "viem";
import type {
  BlockConfig,
  BlockType,
  CallConfig,
  ContractEntry,
  NotebookBlock,
} from "@/lib/types";

export const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
] as const;
export const DEFAULT_GEMINI_MODEL: (typeof GEMINI_MODELS)[number] = "gemini-2.5-flash";

/** localStorage keys (browser-only, never sent to the Chainstitch server). */
export const GEMINI_KEY_STORAGE = "cn-gemini-api-key";
export const GEMINI_MODEL_STORAGE = "cn-gemini-model";

/** One pasted/dropped Solidity source file. */
export interface ImportSourceFile {
  name: string;
  content: string;
}

/** An exact ABI supplied via a Foundry/Hardhat artifact drop. */
export interface SuppliedAbi {
  name: string;
  abi: Abi;
}

/** A contract the tests reference that isn't in the address book. */
export interface MissingContract {
  name: string;
  /** Exact ABI when a matching artifact was supplied — importable in one click. */
  abi?: Abi;
  /** Ids of the imported read/write blocks that reference it. */
  blockIds: string[];
}

export interface AiImportResult {
  blocks: NotebookBlock[];
  warnings: string[];
  missing: MissingContract[];
}

export interface PreflightContract {
  name: string;
  /** One line on where/why the tests touch it. */
  why: string;
  status: "address-book" | "artifact" | "missing";
}

export interface PreflightReport {
  summary: string;
  contracts: PreflightContract[];
  /** Symbols/files referenced but not visible in the provided context. */
  unresolved: string[];
}

/** Shape the model is asked to produce (validated, never trusted). */
interface RawBlock {
  id?: unknown;
  type?: unknown;
  /** Contract *name* for read/write blocks. */
  contract?: unknown;
  config?: unknown;
  outputVariable?: unknown;
  parentId?: unknown;
  runWhen?: unknown;
}

const IMPORTABLE_TYPES: BlockType[] = [
  "read",
  "write",
  "rpc",
  "markdown",
  "variable",
  "sender",
  "if",
];

/** Anvil's default funded accounts — natural stand-ins for test actors. */
const ANVIL_ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
];

/** Foundry test entry points found in the provided sources, in order. */
export function findTestFunctions(files: ImportSourceFile[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const match of file.content.matchAll(
      /function\s+((?:test|invariant)\w*)\s*\(/g,
    )) {
      if (!seen.has(match[1])) {
        seen.add(match[1]);
        names.push(match[1]);
      }
    }
  }
  return names;
}

// --- Prompt building ---------------------------------------------------------

function rpcCatalog(): string {
  return RPC_METHODS.map((m) => {
    const params = m.params
      .map((p) => `${p.name}${p.optional ? "?" : ""} (${p.kind}, e.g. ${p.placeholder})`)
      .join("; ");
    return `- "${m.id}": ${m.description}${params ? ` — params: [${params}]` : " — params: []"}`;
  }).join("\n");
}

function fnList(abi: Abi): string {
  return (
    getFunctions(abi)
      .map(
        (f) =>
          `${f.name}(${f.inputs.map((i) => i.type).join(",")}) [${f.stateMutability}]`,
      )
      .join(", ") || "(no functions)"
  );
}

function contractCatalog(contracts: ContractEntry[]): string {
  if (contracts.length === 0) return "(the address book is empty)";
  return contracts
    .map((c) => `- "${c.name}" @ ${c.address || "(no address yet)"}: ${fnList(c.abi)}`)
    .join("\n");
}

function suppliedCatalog(extraAbis: SuppliedAbi[]): string {
  if (extraAbis.length === 0) return "";
  const rows = extraAbis.map((a) => `- "${a.name}": ${fnList(a.abi)}`).join("\n");
  return `
- Supplied artifact ABIs (exact interfaces; these contracts are NOT in the address book yet — reference them by these names and the app offers to add them on insert):
${rows}`;
}

function fileSection(files: ImportSourceFile[]): string {
  return files
    .map((f) => `--- FILE: ${f.name} ---\n${f.content}`)
    .join("\n\n");
}

interface PromptContext {
  files: ImportSourceFile[];
  contracts: ContractEntry[];
  extraAbis: SuppliedAbi[];
  /** Restrict conversion to these test functions (undefined = all). */
  selectedTests?: string[];
}

function buildConvertPrompt(ctx: PromptContext): string {
  const scope =
    ctx.selectedTests && ctx.selectedTests.length > 0
      ? `Convert ONLY these test functions, in this order: ${ctx.selectedTests.join(", ")}. Use setUp(), inherited contracts, modifiers, constants and helper functions from ALL provided files as context, but do not convert other test functions.`
      : "Convert every test function in the provided files, in source order.";

  return `You convert Foundry (forge-std) Solidity test files into a "Chainstitch" notebook — an ordered list of executable blocks run top to bottom against an anvil fork.

Respond with STRICT JSON only (no markdown fences, no commentary):
{"blocks": [...], "warnings": ["..."]}

Each block:
{"id": "b1", "type": "...", "contract": "Name-or-omit", "config": {...}, "outputVariable": null, "parentId": null, "runWhen": null}

BLOCK TYPES and their "config":
- "markdown": {"text": "..."} — narration. Start with a title block summarizing the file; add a "## test_Name" heading block before each converted test function; use notes for anything that cannot execute (expected reverts, unsupported cheatcodes).
- "variable": {"name": "alice", "value": "0x..."} — named constant, referenced later as {{alice}}.
- "read": {"functionName": "balanceOf", "args": ["{{alice}}"]} + top-level "contract": exact catalog name. View/pure calls only.
- "write": {"functionName": "deposit", "args": ["1000000"], "value": "0"} + "contract". State-changing calls; "value" is wei for payable calls, omit otherwise.
- "rpc": {"method": "<id>", "params": ["..."]} — direct node calls. Known method ids:
${rpcCatalog()}
  For anvil cheatcodes use method id "custom": params[0] = the raw JSON-RPC method name, params[1] = its params as a JSON array string. Example vm.deal(alice, 10 ether): {"method": "custom", "params": ["anvil_setBalance", "[\\"{{alice}}\\", \\"0x8ac7230489e80000\\"]"]}.
- "sender": {"address": "{{alice}}", "simulateOnly": false} — a GROUP: child blocks carry this block's id as their "parentId" and execute as that caller. simulateOnly false = real writes via anvil impersonation (right for converted tests); true = dry-run only.
- "if": {"condition": "{{bal}} == 1000000"} — evaluates and displays true/false. Use one per assertion. Condition grammar is EXACTLY one comparison: operand [op operand], op ∈ == != < <= > >=, operands are {{var}} / {{var.path}} references or literals (integers, decimals, 0x hex, "quoted strings", true/false), optional leading "!". NO &&, ||, or arithmetic — split compound assertions into several if blocks, and precompute any arithmetic into a variable via a warning if impossible.

RULES:
- Never output type "recipe".
- Groups ("sender", "if") are one level deep: a group's parentId is always null, and a group id may only appear in the parentId of NON-group blocks.
- "outputVariable" saves a block's result for later {{name}} references; dot paths drill into structured results (e.g. {{receipt.blockNumber}} after saving a write as "receipt"). Declare variables before use, top to bottom.
- {{interpolation}} works in args, params, value, sender addresses, and conditions.
- Argument formats (they are typed into form fields as strings): uint/int → decimal string ("1500000"), address → "0x..." or {{var}}, bool → "true"/"false", bytes → "0x...", arrays/structs → JSON string.

CHEATCODE MAPPING:
- vm.prank / vm.startPrank(addr) → wrap the affected calls in a "sender" group ({"address": addr, "simulateOnly": false}).
- vm.deal(addr, wei) → custom anvil_setBalance [addr, "0x<hex wei>"].
- vm.warp(ts) → custom evm_setNextBlockTimestamp [ts], then custom evm_mine [].
- skip/relative time → custom evm_increaseTime [seconds], then custom evm_mine [].
- vm.roll(n) → custom anvil_mine with the needed block count, plus a warning that heights are approximate.
- vm.expectRevert(...) → keep the call block, precede it with a markdown note "expected to revert: <reason>" and add a warning.
- makeAddr("name") / test actors → "variable" blocks mapped to anvil's default accounts, in order: ${ANVIL_ACCOUNTS.join(", ")}. Note the mapping in a markdown block.
- assertEq/assertGt/assertTrue/... → save the relevant read into an outputVariable, then an "if" block encoding the expectation.
- Fuzz test parameters → pin one sensible concrete value as a "variable" block and add a warning.

SETUP & CONTRACTS:
- The project address book (use these EXACT names in "contract"):
${contractCatalog(ctx.contracts)}${suppliedCatalog(ctx.extraAbis)}
- Calls to contracts in neither catalog: still emit the block with "contract" set to the contract's name from the test, and add ONE warning per such contract.
- Contracts deployed inside setUp() cannot be deployed by the notebook — convert the setUp state changes that ARE expressible (deals, warps, approvals as sender groups), reference the deployed contracts by name, and warn.
- Inherited/imported code that is missing from the provided files: do your best from usage, and add a warning naming the file that would help.
- ${scope}
- Be faithful: keep call order and arguments exact.

THE FILES:
${fileSection(ctx.files)}`;
}

function buildPreflightPrompt(ctx: PromptContext): string {
  return `You are preparing to convert Foundry (forge-std) Solidity test files into executable notebook blocks. Do NOT convert anything yet — audit whether the provided context is sufficient.

Respond with STRICT JSON only:
{"summary": "one sentence on readiness", "contracts": [{"name": "Vault", "why": "vault.deposit(...) in test_Deposit"}], "unresolved": ["BaseTest — inherited, its setUp()/helpers are not in the provided files; paste BaseTest.sol"]}

- "contracts": every distinct on-chain contract or interface the tests interact with (calls, deploys, assertions on state). Where a catalog entry below matches, use its EXACT name.
- "unresolved": everything referenced but not visible in the provided files or catalogs — inherited contracts, imported files, helper libraries, named constants — each with a short hint about what to paste or drop.
- Known address book:
${contractCatalog(ctx.contracts)}${suppliedCatalog(ctx.extraAbis)}

THE FILES:
${fileSection(ctx.files)}`;
}

// --- Gemini call -------------------------------------------------------------

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message?: string };
}

async function callGemini(
  prompt: string,
  apiKey: string,
  model: string,
): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
    },
  );

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as GeminiResponse | null;
    const detail = body?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 400 && /api key/i.test(detail)) {
      throw new Error("Google rejected the API key — check it at aistudio.google.com/apikey");
    }
    if (res.status === 429) {
      throw new Error(
        "Rate limited by the Gemini free tier — wait a minute and try again",
      );
    }
    throw new Error(`Gemini request failed: ${detail}`);
  }

  const body = (await res.json()) as GeminiResponse;
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");
  if (!text) {
    const reason = body.candidates?.[0]?.finishReason;
    throw new Error(
      reason
        ? `Gemini returned no content (finish reason: ${reason})`
        : "Gemini returned an empty response",
    );
  }
  return text;
}

/** Ask, parse, and — if the output is unusable — retry once with the error. */
async function requestJson<T>(
  prompt: string,
  apiKey: string,
  model: string,
  parse: (text: string) => T,
): Promise<T> {
  let lastError = "";
  let text = await callGemini(prompt, apiKey, model);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return parse(text);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt === 1) break;
      text = await callGemini(
        `${prompt}\n\nYOUR PREVIOUS RESPONSE WAS INVALID (${lastError}). It was:\n${text.slice(0, 4000)}\n\nReturn the corrected STRICT JSON now.`,
        apiKey,
        model,
      );
    }
  }
  throw new Error(`The model's output could not be used (${lastError})`);
}

/** Parse model output as a JSON object, tolerating stray markdown fences. */
function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  const parsed: unknown = JSON.parse(cleaned);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("response is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

// --- Validation & mapping ----------------------------------------------------

function parseConvertJson(text: string): { blocks: RawBlock[]; warnings: string[] } {
  const obj = parseJsonObject(text);
  if (!Array.isArray(obj.blocks) || obj.blocks.length === 0) {
    throw new Error('response has no "blocks" array');
  }
  const warnings = Array.isArray(obj.warnings)
    ? obj.warnings.filter((w): w is string => typeof w === "string")
    : [];
  return { blocks: obj.blocks as RawBlock[], warnings };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

/** Args/params arrive as arbitrary JSON — flatten each entry to a form string. */
function toFormStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((entry) => {
    if (typeof entry === "string") return entry;
    if (typeof entry === "number" || typeof entry === "boolean") return String(entry);
    return JSON.stringify(entry);
  });
}

const KNOWN_RPC_IDS = new Set(RPC_METHODS.map((m) => m.id));

/**
 * Turn the model's raw blocks into NotebookBlocks: resolve contract names
 * against the address book and supplied artifacts, normalize configs, keep
 * group links sane, and collect warnings instead of failing wherever the
 * result is still usable.
 */
function mapBlocks(
  raw: RawBlock[],
  contracts: ContractEntry[],
  extraAbis: SuppliedAbi[],
  warnings: string[],
): { blocks: NotebookBlock[]; missing: MissingContract[] } {
  const blocks: NotebookBlock[] = [];
  /** model id → { id, group } for parent remapping (insertBlocksAt re-mints). */
  const seen = new Map<string, { id: string; group: boolean }>();
  const missing = new Map<string, MissingContract>();
  const declared = new Set<string>();
  const unresolvedRefs = new Set<string>();

  const checkRefs = (text: string) => {
    for (const match of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      const root = match[1].split(/[.[]/)[0].trim();
      if (root && !declared.has(root)) unresolvedRefs.add(root);
    }
  };

  const checkCall = (
    position: string,
    label: string,
    abi: Abi,
    functionName: string,
    args: string[],
  ) => {
    const fn = getFunctions(abi).find((f) => f.name === functionName);
    if (!fn) {
      warnings.push(
        `${position}: "${label}" has no function "${functionName}" — pick one manually`,
      );
    } else if (fn.inputs.length !== args.length) {
      warnings.push(
        `${position}: ${label}.${functionName} expects ${fn.inputs.length} argument(s), got ${args.length} — review them`,
      );
    }
  };

  raw.forEach((entry, index) => {
    const position = `block ${index + 1}`;
    const type = str(entry.type) as BlockType;
    if (!IMPORTABLE_TYPES.includes(type)) {
      warnings.push(`${position}: unsupported type "${str(entry.type) || "?"}" was dropped`);
      return;
    }
    const rawConfig =
      typeof entry.config === "object" && entry.config !== null
        ? (entry.config as Record<string, unknown>)
        : {};

    const id = crypto.randomUUID();
    let config: BlockConfig;
    switch (type) {
      case "markdown": {
        const text = str(rawConfig.text);
        if (!text.trim()) {
          warnings.push(`${position}: empty text block was dropped`);
          return;
        }
        checkRefs(text);
        config = { text };
        break;
      }
      case "variable": {
        const name = str(rawConfig.name).trim();
        const value = str(rawConfig.value);
        if (!name) {
          warnings.push(`${position}: variable block without a name was dropped`);
          return;
        }
        declared.add(name);
        config = { name, value };
        break;
      }
      case "sender": {
        const address = str(rawConfig.address).trim();
        checkRefs(address);
        config = {
          address,
          simulateOnly: rawConfig.simulateOnly !== false,
        };
        break;
      }
      case "if": {
        const condition = str(rawConfig.condition).trim();
        checkRefs(condition);
        config = { condition };
        break;
      }
      case "rpc": {
        let method = str(rawConfig.method).trim();
        let params = toFormStrings(rawConfig.params);
        // The model sometimes emits raw JSON-RPC names directly — wrap them.
        if (method && !KNOWN_RPC_IDS.has(method)) {
          params = [method, JSON.stringify(params)];
          method = "custom";
        }
        params.forEach(checkRefs);
        config = { method: method || "getBlockNumber", params };
        break;
      }
      case "read":
      case "write": {
        const functionName = str(rawConfig.functionName).trim();
        const args = toFormStrings(rawConfig.args);
        const value = strOrNull(rawConfig.value);
        const contractName = str(entry.contract).trim();
        const contract = contracts.find(
          (c) => c.name.toLowerCase() === contractName.toLowerCase(),
        );
        const supplied = contract
          ? undefined
          : extraAbis.find((a) => a.name.toLowerCase() === contractName.toLowerCase());
        if (contract && functionName) {
          checkCall(position, contract.name, contract.abi, functionName, args);
        } else if (supplied && functionName) {
          checkCall(position, supplied.name, supplied.abi, functionName, args);
        }
        if (!contract && contractName) {
          const key = contractName.toLowerCase();
          const entry_ = missing.get(key) ?? {
            name: supplied?.name ?? contractName,
            abi: supplied?.abi,
            blockIds: [],
          };
          entry_.blockIds.push(id);
          missing.set(key, entry_);
        }
        args.forEach(checkRefs);
        if (value) checkRefs(value);
        config = {
          contractId: contract?.id ?? "",
          functionName,
          args,
          ...(type === "write" && value ? { value } : {}),
        } satisfies CallConfig;
        break;
      }
      default:
        // Unreachable: IMPORTABLE_TYPES was checked above ("recipe" etc. dropped).
        return;
    }

    const modelId = str(entry.id) || `imported-${index}`;
    const isGroup = isGroupType(type);

    // Parent links: only non-groups may nest, and only under an earlier group.
    let parentId: string | null = null;
    const rawParent = str(entry.parentId);
    if (rawParent && !isGroup) {
      const parent = seen.get(rawParent);
      if (parent?.group) parentId = parent.id;
      else warnings.push(`${position}: parent link "${rawParent}" is invalid — moved to top level`);
    }

    const outputVariable = strOrNull(entry.outputVariable)?.replace(/[{}]/g, "").trim() || null;
    if (outputVariable) declared.add(outputVariable);
    const runWhen = strOrNull(entry.runWhen);
    if (runWhen) checkRefs(runWhen);

    seen.set(modelId, { id, group: isGroup });
    blocks.push({ id, type, config, outputVariable, parentId, runWhen });
  });

  for (const name of unresolvedRefs) {
    warnings.push(`{{${name}}} is referenced but never declared — check the imported flow`);
  }
  if (blocks.length === 0) {
    throw new Error("no usable blocks in the response");
  }
  return { blocks, missing: [...missing.values()] };
}

// --- Entry points --------------------------------------------------------------

export interface ConvertOptions {
  files: ImportSourceFile[];
  contracts: ContractEntry[];
  extraAbis?: SuppliedAbi[];
  /** Restrict conversion to these test functions (undefined = all). */
  selectedTests?: string[];
  apiKey: string;
  model?: string;
}

export async function convertTestToBlocks(opts: ConvertOptions): Promise<AiImportResult> {
  const extraAbis = opts.extraAbis ?? [];
  const prompt = buildConvertPrompt({
    files: opts.files,
    contracts: opts.contracts,
    extraAbis,
    selectedTests: opts.selectedTests,
  });
  return requestJson(
    prompt,
    opts.apiKey,
    opts.model || DEFAULT_GEMINI_MODEL,
    (text) => {
      const { blocks: rawBlocks, warnings } = parseConvertJson(text);
      const { blocks, missing } = mapBlocks(rawBlocks, opts.contracts, extraAbis, warnings);
      return { blocks, warnings, missing };
    },
  );
}

/**
 * Pre-flight audit: one cheap request that reports which contracts the tests
 * touch (classified against the address book and supplied artifacts) and what
 * context is still missing — so the user knows what to paste before burning a
 * conversion on incomplete input.
 */
export async function preflightCheck(
  opts: Omit<ConvertOptions, "selectedTests">,
): Promise<PreflightReport> {
  const extraAbis = opts.extraAbis ?? [];
  const prompt = buildPreflightPrompt({
    files: opts.files,
    contracts: opts.contracts,
    extraAbis,
  });
  return requestJson(
    prompt,
    opts.apiKey,
    opts.model || DEFAULT_GEMINI_MODEL,
    (text) => {
      const obj = parseJsonObject(text);
      const rawContracts = Array.isArray(obj.contracts) ? obj.contracts : [];
      const contracts: PreflightContract[] = rawContracts.flatMap((c) => {
        const name =
          typeof c === "string" ? c.trim() : str((c as Record<string, unknown>)?.name).trim();
        if (!name) return [];
        const why =
          typeof c === "object" && c !== null
            ? str((c as Record<string, unknown>).why)
            : "";
        const inBook = opts.contracts.some(
          (e) => e.name.toLowerCase() === name.toLowerCase(),
        );
        const inArtifacts = extraAbis.some(
          (a) => a.name.toLowerCase() === name.toLowerCase(),
        );
        return [
          {
            name,
            why,
            status: inBook ? "address-book" : inArtifacts ? "artifact" : "missing",
          } satisfies PreflightContract,
        ];
      });
      if (contracts.length === 0 && !Array.isArray(obj.unresolved)) {
        throw new Error('response has neither "contracts" nor "unresolved"');
      }
      return {
        summary: str(obj.summary),
        contracts,
        unresolved: Array.isArray(obj.unresolved)
          ? obj.unresolved.filter((u): u is string => typeof u === "string")
          : [],
      };
    },
  );
}
