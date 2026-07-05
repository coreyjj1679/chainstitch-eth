import type { AbiEvent, AbiFunction } from "viem";
import { getEvents, getFunctions } from "@/lib/abi";
import { executionOrder } from "@/lib/block-label";
import { getRpcMethod } from "@/lib/rpc-methods";
import type {
  CallConfig,
  ContractEntry,
  EventConfig,
  IfConfig,
  NotebookBlock,
  Project,
  RpcConfig,
  SenderConfig,
  VariableConfig,
} from "@/lib/types";

export type CodeFlavor = "wagmi" | "viem" | "python" | "rust" | "solidity";

const COMMENT_PREFIX: Record<CodeFlavor, string> = {
  wagmi: "//",
  viem: "//",
  python: "#",
  rust: "//",
  solidity: "//",
};

function camelCase(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) =>
    c ? c.toUpperCase() : "",
  );
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1) || "contract";
}

function pascalCase(name: string): string {
  const camel = camelCase(name);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function snakeCase(name: string): string {
  return camelCase(name)
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase();
}

function soleVariable(raw: string): string | null {
  const match = raw.trim().match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
  return match ? match[1] : null;
}

function findFn(contract: ContractEntry, name: string): AbiFunction | undefined {
  return getFunctions(contract.abi).find((f) => f.name === name);
}

function findEvent(contract: ContractEntry, name: string): AbiEvent | undefined {
  return getEvents(contract.abi).find((e) => e.name === name);
}

/** The event's indexed filters that are actually set, with their inputs. */
function activeFilters(
  config: EventConfig,
  event: AbiEvent,
): Array<{ name: string; type: string; raw: string }> {
  return event.inputs.flatMap((input, i) => {
    const raw = (config.filters ?? [])[i] ?? "";
    if (!input.indexed || !input.name || raw.trim() === "") return [];
    return [{ name: input.name, type: input.type, raw }];
  });
}

/* ── argument rendering per language ─────────────────────────────── */

function renderArgTs(raw: string, abiType: string): string {
  const variable = soleVariable(raw);
  if (variable) return variable;
  const trimmed = raw.trim();
  if (trimmed === "") return "/* TODO */";
  if (abiType.endsWith("]") || abiType.startsWith("tuple")) return trimmed;
  if (abiType.startsWith("uint") || abiType.startsWith("int")) return `${trimmed}n`;
  if (abiType === "bool") return trimmed === "true" || trimmed === "1" ? "true" : "false";
  return JSON.stringify(trimmed);
}

function renderArgPython(raw: string, abiType: string): string {
  const variable = soleVariable(raw);
  if (variable) return variable.replace(/\./g, "_");
  const trimmed = raw.trim();
  if (trimmed === "") return "None  # TODO";
  if (abiType.endsWith("]") || abiType.startsWith("tuple")) return trimmed;
  if (abiType.startsWith("uint") || abiType.startsWith("int")) return trimmed;
  if (abiType === "bool") return trimmed === "true" || trimmed === "1" ? "True" : "False";
  return JSON.stringify(trimmed);
}

function renderArgRust(raw: string, abiType: string): string {
  const variable = soleVariable(raw);
  if (variable) return variable.replace(/\./g, "_");
  const trimmed = raw.trim();
  if (trimmed === "") return "todo!()";
  if (abiType === "address") return `address!("${trimmed}")`;
  if (abiType.startsWith("uint") || abiType.startsWith("int"))
    return `U256::from(${trimmed})`;
  if (abiType === "bool") return trimmed === "true" || trimmed === "1" ? "true" : "false";
  if (abiType.endsWith("]") || abiType.startsWith("tuple"))
    return `/* ${trimmed} */`;
  return JSON.stringify(trimmed) + ".into()";
}

function renderArgSolidity(raw: string, abiType: string): string {
  const variable = soleVariable(raw);
  if (variable) return variable.replace(/\./g, "_");
  const trimmed = raw.trim();
  if (trimmed === "") return "/* TODO */";
  if (abiType === "address") return trimmed;
  if (abiType.startsWith("uint") || abiType.startsWith("int")) return trimmed;
  if (abiType === "bool") return trimmed === "true" || trimmed === "1" ? "true" : "false";
  if (abiType.endsWith("]") || abiType.startsWith("tuple")) return trimmed;
  return JSON.stringify(trimmed);
}

function renderArgs(
  config: CallConfig,
  fn: AbiFunction,
  render: (raw: string, abiType: string) => string,
): string {
  if (fn.inputs.length === 0) return "";
  return fn.inputs.map((input, i) => render(config.args[i] ?? "", input.type)).join(", ");
}

/* ── shared signatures ───────────────────────────────────────────── */

/** `event NumberSet(address indexed setter, uint256 n);` — rust sol! / solidity */
function eventSoliditySignature(event: AbiEvent): string {
  const params = event.inputs
    .map((i) => `${i.type}${i.indexed ? " indexed" : ""}${i.name ? ` ${i.name}` : ""}`)
    .join(", ");
  return `event ${event.name}(${params});`;
}

/** `function setNumber(uint256 newNumber) external;` — used by rust sol! and solidity */
function soliditySignature(fn: AbiFunction): string {
  const params = fn.inputs
    .map((i) => `${i.type}${i.name ? ` ${i.name}` : ""}`)
    .join(", ");
  const mutability =
    fn.stateMutability === "view" || fn.stateMutability === "pure"
      ? ` ${fn.stateMutability}`
      : fn.stateMutability === "payable"
        ? " payable"
        : "";
  const returns =
    fn.outputs && fn.outputs.length > 0
      ? ` returns (${fn.outputs.map((o) => o.type).join(", ")})`
      : "";
  return `function ${fn.name}(${params}) external${mutability}${returns};`;
}

/* ── typescript (viem / wagmi) ───────────────────────────────────── */

export function clientPrelude(project: Project): string {
  return [
    `import { createPublicClient, http, defineChain } from "viem";`,
    ``,
    `const chain = defineChain({`,
    `  id: ${project.chainId},`,
    `  name: "Chain ${project.chainId}",`,
    `  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },`,
    `  rpcUrls: { default: { http: ["${project.rpcUrl}"] } },`,
    `});`,
    ``,
    `const client = createPublicClient({ chain, transport: http() });`,
  ].join("\n");
}

function contractConstsTs(contract: ContractEntry): string {
  const varName = camelCase(contract.name);
  return [
    `// ABI from your address book entry "${contract.name}"`,
    `const ${varName}Address = "${contract.address || "0x…"}";`,
    `const ${varName}Abi = [/* ${contract.name} ABI */] as const;`,
  ].join("\n");
}

function genCallTs(
  block: NotebookBlock,
  contract: ContractEntry,
  fn: AbiFunction,
  flavor: "viem" | "wagmi",
): string {
  const config = block.config as CallConfig;
  const varName = camelCase(contract.name);
  const args = renderArgs(config, fn, renderArgTs);
  const output = block.outputVariable ?? "result";
  const valueLine =
    config.value && config.value.trim() !== ""
      ? `  value: ${renderArgTs(config.value, "uint256")},`
      : null;

  if (block.type === "read") {
    if (flavor === "viem") {
      return [
        contractConstsTs(contract),
        ``,
        `const ${output} = await client.readContract({`,
        `  address: ${varName}Address,`,
        `  abi: ${varName}Abi,`,
        `  functionName: "${config.functionName}",`,
        ...(args ? [`  args: [${args}],`] : []),
        `});`,
      ].join("\n");
    }
    return [
      `import { useReadContract } from "wagmi";`,
      ``,
      contractConstsTs(contract),
      ``,
      `const { data: ${output} } = useReadContract({`,
      `  address: ${varName}Address,`,
      `  abi: ${varName}Abi,`,
      `  functionName: "${config.functionName}",`,
      ...(args ? [`  args: [${args}],`] : []),
      `});`,
    ].join("\n");
  }

  if (flavor === "viem") {
    return [
      `import { createWalletClient, custom } from "viem";`,
      ``,
      contractConstsTs(contract),
      ``,
      `const walletClient = createWalletClient({ chain, transport: custom(window.ethereum) });`,
      `const [account] = await walletClient.getAddresses();`,
      ``,
      `// Simulate first: reverts surface here, before the wallet prompt`,
      `const { request } = await client.simulateContract({`,
      `  address: ${varName}Address,`,
      `  abi: ${varName}Abi,`,
      `  functionName: "${config.functionName}",`,
      ...(args ? [`  args: [${args}],`] : []),
      ...(valueLine ? [valueLine] : []),
      `  account,`,
      `});`,
      `const txHash = await walletClient.writeContract(request);`,
      `const ${output} = await client.waitForTransactionReceipt({ hash: txHash });`,
    ].join("\n");
  }
  return [
    `import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";`,
    ``,
    contractConstsTs(contract),
    ``,
    `const { writeContract, data: txHash } = useWriteContract();`,
    `const { data: ${output} } = useWaitForTransactionReceipt({ hash: txHash });`,
    ``,
    `// Call this from your submit handler:`,
    `writeContract({`,
    `  address: ${varName}Address,`,
    `  abi: ${varName}Abi,`,
    `  functionName: "${config.functionName}",`,
    ...(args ? [`  args: [${args}],`] : []),
    ...(valueLine ? [valueLine] : []),
    `});`,
  ].join("\n");
}

function genRpcTs(block: NotebookBlock, flavor: "viem" | "wagmi"): string {
  const config = block.config as RpcConfig;
  const method = getRpcMethod(config.method);
  if (!method) return "// Configure the block to see its code";
  const output = block.outputVariable ?? "result";

  const renderedParams = method.params.map((spec, i) => {
    const raw = (config.params[i] ?? "").trim();
    const variable = soleVariable(raw);
    if (variable) return variable;
    if (raw === "") return spec.optional ? "{}" : "/* TODO */";
    if (spec.kind === "json") return raw;
    if (spec.kind === "bigint") return `${raw}n`;
    if (spec.kind === "bigintOrTag")
      return /^\d+$/.test(raw) ? `{ blockNumber: ${raw}n }` : `{ blockTag: "${raw}" }`;
    return JSON.stringify(raw);
  });

  const call = method.viemCode(renderedParams);
  const hookLines =
    flavor === "wagmi"
      ? [`import { usePublicClient } from "wagmi";`, ``, `const client = usePublicClient();`, ``]
      : [];
  return [...hookLines, `const ${output} = ${call};`].join("\n");
}

/* ── event blocks (getLogs) ──────────────────────────────────────── */

/** Block-range value for TS: bigint literal, tag string, or {{var}} name. */
function renderBlockRefTs(raw: string | undefined): string | null {
  const text = (raw ?? "").trim();
  if (text === "") return null;
  const variable = soleVariable(text);
  if (variable) return variable;
  if (/^\d+$/.test(text)) return `${text}n`;
  return JSON.stringify(text);
}

function genEventTs(
  block: NotebookBlock,
  contract: ContractEntry,
  event: AbiEvent,
  flavor: "viem" | "wagmi",
): string {
  const config = block.config as EventConfig;
  const varName = camelCase(contract.name);
  const output = block.outputVariable ?? "logs";
  const filters = activeFilters(config, event);
  const argsLine =
    filters.length > 0
      ? `  args: { ${filters.map((f) => `${f.name}: ${renderArgTs(f.raw, f.type)}`).join(", ")} },`
      : null;

  if (flavor === "viem") {
    const fromBlock = renderBlockRefTs(config.fromBlock);
    const toBlock = renderBlockRefTs(config.toBlock);
    return [
      contractConstsTs(contract),
      ``,
      `const ${output} = await client.getContractEvents({`,
      `  address: ${varName}Address,`,
      `  abi: ${varName}Abi,`,
      `  eventName: "${config.eventName}",`,
      ...(argsLine ? [argsLine] : []),
      ...(fromBlock ? [`  fromBlock: ${fromBlock},`] : []),
      ...(toBlock ? [`  toBlock: ${toBlock},`] : []),
      `});`,
    ].join("\n");
  }
  return [
    `import { useWatchContractEvent } from "wagmi";`,
    ``,
    contractConstsTs(contract),
    ``,
    `// Live subscription — for a one-shot history query, use the viem flavor.`,
    `useWatchContractEvent({`,
    `  address: ${varName}Address,`,
    `  abi: ${varName}Abi,`,
    `  eventName: "${config.eventName}",`,
    ...(argsLine ? [argsLine] : []),
    `  onLogs(${output}) {`,
    `    console.log(${output});`,
    `  },`,
    `});`,
  ].join("\n");
}

/* ── python (web3.py) ────────────────────────────────────────────── */

function pythonRpcParam(raw: string, kind: string, optional?: boolean): string {
  const variable = soleVariable(raw);
  if (variable) return variable.replace(/\./g, "_");
  const trimmed = raw.trim();
  if (trimmed === "") return optional ? '"latest"' : "None  # TODO";
  if (kind === "json") return trimmed;
  if (kind === "bigint") return trimmed;
  if (kind === "bigintOrTag") return /^\d+$/.test(trimmed) ? trimmed : JSON.stringify(trimmed);
  return JSON.stringify(trimmed);
}

const PYTHON_RPC: Record<string, (p: string[]) => string> = {
  getBlockNumber: () => `w3.eth.block_number`,
  getBlock: ([block]) => `w3.eth.get_block(${block ?? '"latest"'})`,
  getBalance: ([address]) => `w3.eth.get_balance(${address})`,
  getTransaction: ([hash]) => `w3.eth.get_transaction(${hash})`,
  getTransactionReceipt: ([hash]) => `w3.eth.get_transaction_receipt(${hash})`,
  getGasPrice: () => `w3.eth.gas_price`,
  getChainId: () => `w3.eth.chain_id`,
  getCode: ([address]) => `w3.eth.get_code(${address})`,
  getStorageAt: ([address, slot]) => `w3.eth.get_storage_at(${address}, ${slot})`,
  getLogs: ([filter]) => `w3.eth.get_logs(${filter ?? "{}"})`,
  custom: ([method, params]) => `w3.provider.make_request(${method}, ${params ?? "[]"})`,
};

function genPython(block: NotebookBlock, contracts: ContractEntry[]): string {
  const output = snakeCase(block.outputVariable ?? "result");

  if (block.type === "event") {
    const config = block.config as EventConfig;
    const contract = contracts.find((c) => c.id === config.contractId);
    const event = contract && findEvent(contract, config.eventName);
    if (!contract || !event) return "# Configure the block to see its code";
    const varName = snakeCase(contract.name);
    const filters = activeFilters(config, event);
    const blockRef = (raw: string | undefined, fallback: string): string => {
      const text = (raw ?? "").trim();
      if (text === "") return fallback;
      const variable = soleVariable(text);
      if (variable) return variable.replace(/\./g, "_");
      return /^\d+$/.test(text) ? text : JSON.stringify(text);
    };
    return [
      `# ABI from your address book entry "${contract.name}"`,
      `${varName} = w3.eth.contract(address="${contract.address || "0x…"}", abi=${varName.toUpperCase()}_ABI)`,
      ``,
      `${output} = ${varName}.events.${config.eventName}().get_logs(`,
      `    from_block=${blockRef(config.fromBlock, '"earliest"')},`,
      `    to_block=${blockRef(config.toBlock, '"latest"')},`,
      ...(filters.length > 0
        ? [
            `    argument_filters={${filters
              .map((f) => `"${f.name}": ${renderArgPython(f.raw, f.type)}`)
              .join(", ")}},`,
          ]
        : []),
      `)`,
    ].join("\n");
  }

  if (block.type === "rpc") {
    const config = block.config as RpcConfig;
    const method = getRpcMethod(config.method);
    if (!method) return "# Configure the block to see its code";
    const params = method.params.map((spec, i) =>
      pythonRpcParam(config.params[i] ?? "", spec.kind, spec.optional),
    );
    const gen = PYTHON_RPC[method.id];
    return `${output} = ${gen ? gen(params) : `w3.provider.make_request("${method.id}", [${params.join(", ")}])`}`;
  }

  const config = block.config as CallConfig;
  const contract = contracts.find((c) => c.id === config.contractId);
  const fn = contract && findFn(contract, config.functionName);
  if (!contract || !fn) return "# Configure the block to see its code";

  const varName = snakeCase(contract.name);
  const args = renderArgs(config, fn, renderArgPython);
  const lines = [
    `# ABI from your address book entry "${contract.name}"`,
    `${varName} = w3.eth.contract(address="${contract.address || "0x…"}", abi=${varName.toUpperCase()}_ABI)`,
    ``,
  ];

  if (block.type === "read") {
    lines.push(`${output} = ${varName}.functions.${config.functionName}(${args}).call()`);
    return lines.join("\n");
  }

  const txFields = [`    "from": account.address,`];
  if (config.value && config.value.trim() !== "") {
    txFields.push(`    "value": ${renderArgPython(config.value, "uint256")},`);
  }
  lines.push(
    `tx = ${varName}.functions.${config.functionName}(${args}).build_transaction({`,
    ...txFields,
    `})`,
    `signed = account.sign_transaction(tx)`,
    `tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)`,
    `${output} = w3.eth.wait_for_transaction_receipt(tx_hash)`,
  );
  return lines.join("\n");
}

/* ── rust (alloy) ────────────────────────────────────────────────── */

const RUST_RPC: Record<string, (p: string[]) => string> = {
  getBlockNumber: () => `provider.get_block_number().await?`,
  getBalance: ([address]) => `provider.get_balance(address!(${address})).await?`,
  getGasPrice: () => `provider.get_gas_price().await?`,
  getChainId: () => `provider.get_chain_id().await?`,
  getCode: ([address]) => `provider.get_code_at(address!(${address})).await?`,
  getTransactionReceipt: ([hash]) =>
    `provider.get_transaction_receipt(${hash}.parse()?).await?`,
};

function genRust(block: NotebookBlock, contracts: ContractEntry[]): string {
  const output = snakeCase(block.outputVariable ?? "result");

  if (block.type === "event") {
    const config = block.config as EventConfig;
    const contract = contracts.find((c) => c.id === config.contractId);
    const event = contract && findEvent(contract, config.eventName);
    if (!contract || !event) return "// Configure the block to see its code";
    const typeName = pascalCase(contract.name);
    const instance = snakeCase(contract.name);
    const filters = activeFilters(config, event);
    const blockRef = (raw: string | undefined, fallback: string): string => {
      const text = (raw ?? "").trim();
      if (text === "") return fallback;
      const variable = soleVariable(text);
      if (variable) return `${variable.replace(/\./g, "_")}.into()`;
      if (/^\d+$/.test(text)) return `${text}.into()`;
      const tag = text.charAt(0).toUpperCase() + text.slice(1);
      return `BlockNumberOrTag::${tag}`;
    };
    return [
      `sol! {`,
      `    #[sol(rpc)]`,
      `    contract ${typeName} {`,
      `        ${eventSoliditySignature(event)}`,
      `    }`,
      `}`,
      ``,
      `let ${instance} = ${typeName}::new(address!("${contract.address || "0x…"}"), provider.clone());`,
      `let ${output} = ${instance}`,
      `    .${event.name}_filter()`,
      ...(filters.length > 0
        ? [`    // indexed filters: ${filters.map((f) => `${f.name} = ${f.raw}`).join(", ")} — see .topic1()/.topic2()`]
        : []),
      `    .from_block(${blockRef(config.fromBlock, "BlockNumberOrTag::Earliest")})`,
      `    .to_block(${blockRef(config.toBlock, "BlockNumberOrTag::Latest")})`,
      `    .query()`,
      `    .await?;`,
    ].join("\n");
  }

  if (block.type === "rpc") {
    const config = block.config as RpcConfig;
    const method = getRpcMethod(config.method);
    if (!method) return "// Configure the block to see its code";
    const params = method.params.map((spec, i) => {
      const raw = (config.params[i] ?? "").trim();
      const variable = soleVariable(raw);
      if (variable) return variable.replace(/\./g, "_");
      return JSON.stringify(raw);
    });
    const gen = RUST_RPC[method.id];
    if (gen) return `let ${output} = ${gen(params)};`;
    if (method.id === "custom") {
      return `let ${output}: serde_json::Value = provider.raw_request(${params[0] ?? '"…"'}.into(), ${(block.config as RpcConfig).params[1] || "()"}).await?;`;
    }
    return `// ${method.id}: see the alloy Provider trait for the matching method`;
  }

  const config = block.config as CallConfig;
  const contract = contracts.find((c) => c.id === config.contractId);
  const fn = contract && findFn(contract, config.functionName);
  if (!contract || !fn) return "// Configure the block to see its code";

  const typeName = pascalCase(contract.name);
  const instance = snakeCase(contract.name);
  const args = renderArgs(config, fn, renderArgRust);

  const lines = [
    `sol! {`,
    `    #[sol(rpc)]`,
    `    contract ${typeName} {`,
    `        ${soliditySignature(fn)}`,
    `    }`,
    `}`,
    ``,
    `let ${instance} = ${typeName}::new(address!("${contract.address || "0x…"}"), provider.clone());`,
  ];

  if (block.type === "read") {
    lines.push(`let ${output} = ${instance}.${fn.name}(${args}).call().await?;`);
  } else {
    const valueSuffix =
      config.value && config.value.trim() !== ""
        ? `.value(${renderArgRust(config.value, "uint256")})`
        : "";
    lines.push(
      `let pending = ${instance}.${fn.name}(${args})${valueSuffix}.send().await?;`,
      `let ${output} = pending.get_receipt().await?;`,
    );
  }
  return lines.join("\n");
}

/* ── solidity ────────────────────────────────────────────────────── */

function genSolidity(block: NotebookBlock, contracts: ContractEntry[]): string {
  if (block.type === "rpc") {
    return "// JSON-RPC calls have no Solidity equivalent";
  }
  if (block.type === "event") {
    return "// Log queries have no Solidity equivalent — events are consumed off-chain";
  }

  const config = block.config as CallConfig;
  const contract = contracts.find((c) => c.id === config.contractId);
  const fn = contract && findFn(contract, config.functionName);
  if (!contract || !fn) return "// Configure the block to see its code";

  const ifaceName = `I${pascalCase(contract.name)}`;
  const args = renderArgs(config, fn, renderArgSolidity);
  const address = contract.address || "0x…";
  const output = block.outputVariable ?? "result";

  const lines = [
    `interface ${ifaceName} {`,
    `    ${soliditySignature(fn)}`,
    `}`,
    ``,
  ];

  const valueCall =
    block.type === "write" && config.value && config.value.trim() !== ""
      ? `{value: ${renderArgSolidity(config.value, "uint256")}}`
      : "";

  if (fn.outputs && fn.outputs.length === 1) {
    lines.push(
      `${fn.outputs[0].type} ${output} = ${ifaceName}(${address}).${fn.name}${valueCall}(${args});`,
    );
  } else {
    lines.push(`${ifaceName}(${address}).${fn.name}${valueCall}(${args});`);
  }
  return lines.join("\n");
}

/* ── variable (constant declaration) ─────────────────────────────── */

function generateVariableCode(config: VariableConfig, flavor: CodeFlavor): string {
  const name = config.name || "NAME";
  const value = (config.value ?? "").trim();
  const isAddr = /^0x[a-fA-F0-9]{40}$/.test(value);
  const isNum = /^\d+$/.test(value);

  switch (flavor) {
    case "viem":
    case "wagmi": {
      if (isAddr) return `const ${name} = "${value}" as const;`;
      if (isNum) return `const ${name} = ${value}n;`;
      return `const ${name} = ${JSON.stringify(value)};`;
    }
    case "python": {
      if (isNum) return `${snakeCase(name).toUpperCase()} = ${value}`;
      return `${snakeCase(name).toUpperCase()} = ${JSON.stringify(value)}`;
    }
    case "rust": {
      if (isAddr) return `let ${snakeCase(name)} = address!("${value}");`;
      if (isNum) return `let ${snakeCase(name)} = U256::from(${value}u64);`;
      return `let ${snakeCase(name)} = ${JSON.stringify(value)};`;
    }
    case "solidity": {
      if (isAddr) return `address constant ${name} = ${value};`;
      if (isNum) return `uint256 constant ${name} = ${value};`;
      return `string constant ${name} = ${JSON.stringify(value)};`;
    }
  }
}

/* ── entry points ────────────────────────────────────────────────── */

export function generateBlockCode(
  block: NotebookBlock,
  contracts: ContractEntry[],
  project: Project,
  flavor: CodeFlavor,
): string {
  const comment = COMMENT_PREFIX[flavor];
  if (block.type === "markdown") return "";
  if (block.type === "sender") {
    const address = (block.config as SenderConfig).address || "0x…";
    return `${comment} acting as ${address} (simulation scope — impersonate this caller)`;
  }
  if (block.type === "if") {
    const condition = (block.config as IfConfig).condition || "…";
    return `${comment} if ${condition}: (the blocks below run only when this holds)`;
  }
  if (block.type === "recipe") {
    return `${comment} recipe cell — reruns a saved recipe (see Recipes in the sidebar)`;
  }
  if (block.type === "variable") {
    return generateVariableCode(block.config as VariableConfig, flavor);
  }

  switch (flavor) {
    case "viem":
    case "wagmi": {
      if (block.type === "rpc") return genRpcTs(block, flavor);
      if (block.type === "event") {
        const config = block.config as EventConfig;
        const contract = contracts.find((c) => c.id === config.contractId);
        const event = contract && findEvent(contract, config.eventName);
        if (!contract || !event) return "// Configure the block to see its code";
        return genEventTs(block, contract, event, flavor);
      }
      const config = block.config as CallConfig;
      const contract = contracts.find((c) => c.id === config.contractId);
      const fn = contract && findFn(contract, config.functionName);
      if (!contract || !fn) return "// Configure the block to see its code";
      return genCallTs(block, contract, fn, flavor);
    }
    case "python":
      return genPython(block, contracts);
    case "rust":
      return genRust(block, contracts);
    case "solidity":
      return genSolidity(block, contracts);
  }
}

function notebookPrelude(project: Project, flavor: CodeFlavor): string {
  switch (flavor) {
    case "viem":
    case "wagmi":
      return clientPrelude(project);
    case "python":
      return [
        `from web3 import Web3`,
        ``,
        `w3 = Web3(Web3.HTTPProvider("${project.rpcUrl}"))`,
        `account = w3.eth.account.from_key("0x<private-key>")  # needed for writes`,
      ].join("\n");
    case "rust":
      return [
        `use alloy::{primitives::{address, U256}, providers::{Provider, ProviderBuilder}, sol};`,
        ``,
        `let provider = ProviderBuilder::new().connect("${project.rpcUrl}").await?;`,
      ].join("\n");
    case "solidity":
      return `// Core snippets for chain ${project.chainId} — drop into a contract or Foundry test.`;
  }
}

export function generateNotebookCode(
  blocks: NotebookBlock[],
  contracts: ContractEntry[],
  project: Project,
  flavor: CodeFlavor,
): string {
  const comment = COMMENT_PREFIX[flavor];
  const parts: string[] = [notebookPrelude(project, flavor)];
  // Execution order keeps group children right below their group's comment.
  for (const block of executionOrder(blocks)) {
    if (block.type === "markdown") continue;
    const code = generateBlockCode(block, contracts, project, flavor);
    if (code) parts.push(code);
  }
  return parts.join(`\n\n${comment} ────────────────────────────────\n\n`);
}
