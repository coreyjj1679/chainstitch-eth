import type {
  CallConfig,
  ContractEntry,
  MarkdownConfig,
  NotebookBlock,
  RpcConfig,
  SenderConfig,
  VariableConfig,
} from "@/lib/types";

/** Constants declared by variable blocks, as a { name: value } scope. */
export function constantScope(blocks: NotebookBlock[]): Record<string, string> {
  const scope: Record<string, string> = {};
  for (const block of blocks) {
    if (block.type !== "variable") continue;
    const { name, value } = block.config as VariableConfig;
    if (name) scope[name] = value;
  }
  return scope;
}

/** One-line human label for a block, used in the TOC and collapsed summaries. */
export function blockLabel(
  block: NotebookBlock,
  contracts: ContractEntry[],
): string {
  switch (block.type) {
    case "markdown": {
      const text = (block.config as MarkdownConfig).text ?? "";
      const firstLine = text
        .split("\n")
        .map((l) => l.replace(/^#+\s*/, "").trim())
        .find((l) => l.length > 0);
      return firstLine ?? "Text";
    }
    case "read":
    case "write": {
      const config = block.config as CallConfig;
      const contract = contracts.find((c) => c.id === config.contractId);
      if (!contract || !config.functionName)
        return block.type === "read" ? "Read (unconfigured)" : "Write (unconfigured)";
      const args = (config.args ?? []).filter((a) => a !== "").join(", ");
      return `${contract.name}.${config.functionName}(${args})`;
    }
    case "rpc": {
      const config = block.config as RpcConfig;
      if (!config.method) return "RPC (unconfigured)";
      const params = (config.params ?? []).filter((p) => p !== "").join(", ");
      return `${config.method}(${params})`;
    }
    case "sender": {
      const address = (block.config as SenderConfig).address;
      return address ? `acting as ${address}` : "Sender (unconfigured)";
    }
    case "variable": {
      const { name, value } = block.config as VariableConfig;
      if (!name) return "Variable (unconfigured)";
      return `${name} = ${value}`;
    }
  }
}

/**
 * Blocks in the order they execute: top-level order, with each sender group's
 * children expanded right after their parent.
 */
export function executionOrder(blocks: NotebookBlock[]): NotebookBlock[] {
  const ordered: NotebookBlock[] = [];
  for (const block of blocks.filter((b) => !b.parentId)) {
    ordered.push(block);
    if (block.type === "sender") {
      ordered.push(...blocks.filter((c) => c.parentId === block.id));
    }
  }
  return ordered;
}

/** Whether the block has enough config to render a collapsed summary. */
export function isBlockConfigured(block: NotebookBlock): boolean {
  switch (block.type) {
    case "markdown":
      return ((block.config as MarkdownConfig).text ?? "").trim().length > 0;
    case "read":
    case "write": {
      const config = block.config as CallConfig;
      return !!config.contractId && !!config.functionName;
    }
    case "rpc":
      return !!(block.config as RpcConfig).method;
    case "sender":
      return !!(block.config as SenderConfig).address;
    case "variable":
      return !!(block.config as VariableConfig).name;
  }
}
