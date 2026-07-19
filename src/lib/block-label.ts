import type {
  BlockType,
  CallConfig,
  ContractEntry,
  EventConfig,
  ExpectConfig,
  IfConfig,
  MarkdownConfig,
  NotebookBlock,
  Recipe,
  RecipeBlockConfig,
  RpcConfig,
  SenderConfig,
  VariableConfig,
} from "@/lib/types";

/** Group cells that contain child blocks (one level deep, never nested). */
export function isGroupType(type: BlockType): boolean {
  return type === "sender" || type === "if";
}

/** Blocks that hit the chain themselves (run/simulate buttons, codegen). */
export function isRunnableType(type: BlockType): boolean {
  return type === "read" || type === "write" || type === "rpc" || type === "event";
}

/** Blocks that produce a result cell (runnables plus control / assert cells). */
export function isExecutableType(type: BlockType): boolean {
  return (
    isRunnableType(type) ||
    type === "if" ||
    type === "recipe" ||
    type === "expect"
  );
}

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
  recipes?: Recipe[],
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
    case "event": {
      const config = block.config as EventConfig;
      const contract = contracts.find((c) => c.id === config.contractId);
      if (!contract || !config.eventName) return "Events (unconfigured)";
      return `${contract.name}.${config.eventName} events`;
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
    case "if": {
      const condition = (block.config as IfConfig).condition;
      return condition ? `if ${condition}` : "Condition (unconfigured)";
    }
    case "expect": {
      const config = block.config as ExpectConfig;
      if (config.kind === "condition") {
        const condition = config.condition?.trim();
        return condition ? `expect ${condition}` : "Expect (unconfigured)";
      }
      if (config.kind === "event") {
        const name = config.eventName?.trim();
        return name ? `expect event ${name}` : "Expect event (unconfigured)";
      }
      if (config.kind === "revert") {
        const fn = config.functionName?.trim();
        return fn
          ? `expect revert ${fn}${config.reason ? ` (${config.reason})` : ""}`
          : "Expect revert (unconfigured)";
      }
      return "Expect (unconfigured)";
    }
    case "recipe": {
      const recipeId = (block.config as RecipeBlockConfig).recipeId;
      if (!recipeId) return "Recipe (unconfigured)";
      const recipe = recipes?.find((r) => r.id === recipeId);
      return recipe ? `Recipe: ${recipe.name}` : "Recipe (deleted)";
    }
  }
}

/**
 * Blocks in the order they execute: top-level order, with each group's
 * children expanded right after their parent.
 */
export function executionOrder(blocks: NotebookBlock[]): NotebookBlock[] {
  const ordered: NotebookBlock[] = [];
  for (const block of blocks.filter((b) => !b.parentId)) {
    ordered.push(block);
    if (isGroupType(block.type)) {
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
    case "event": {
      const config = block.config as EventConfig;
      return !!config.contractId && !!config.eventName;
    }
    case "sender":
      return !!(block.config as SenderConfig).address;
    case "variable":
      return !!(block.config as VariableConfig).name;
    case "if":
      return ((block.config as IfConfig).condition ?? "").trim().length > 0;
    case "expect": {
      const config = block.config as ExpectConfig;
      if (config.kind === "condition") {
        return ((config.condition ?? "").trim().length > 0);
      }
      if (config.kind === "event") {
        return !!config.eventName?.trim();
      }
      if (config.kind === "revert") {
        return !!config.contractId && !!config.functionName;
      }
      return false;
    }
    case "recipe":
      return !!(block.config as RecipeBlockConfig).recipeId;
  }
}
