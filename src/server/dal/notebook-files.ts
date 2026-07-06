import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AuthContext } from "@/server/auth-context";
import { badRequest } from "@/server/errors";
import { requireProject, getProject } from "@/server/dal/projects";
import { getNotebookWithBlocks, requireNotebook } from "@/server/dal/notebooks";
import { createContract, listContracts } from "@/server/dal/contracts";
import { generateNotebookCode, type CodeFlavor } from "@/lib/codegen";
import {
  buildNotebookFile,
  parseNotebookFile,
  type NotebookFile,
} from "@/lib/notebook-file";
import type {
  BlockConfig,
  BlockType,
  ContractEntry,
  NotebookBlock,
} from "@/lib/types";

/** The notebook's current content as a portable manifest (viewer+). */
export async function getNotebookFile(
  ctx: AuthContext,
  notebookId: string,
): Promise<NotebookFile> {
  const notebook = await getNotebookWithBlocks(ctx, notebookId);
  const project = await requireProject(ctx, notebook.projectId);
  const contracts = (await listContracts(ctx, notebook.projectId)) as ContractEntry[];
  const blocks = notebook.blocks.map((b) => ({
    ...b,
    type: b.type as BlockType,
    config: b.config as BlockConfig,
  }));
  return buildNotebookFile(
    { title: notebook.title, description: notebook.description },
    blocks,
    contracts,
    project.chainId,
  );
}

export const CODE_FLAVORS: readonly CodeFlavor[] = [
  "wagmi",
  "viem",
  "python",
  "rust",
  "solidity",
];

/** Whole-notebook generated source in one flavor (viewer+). */
export async function getNotebookCode(
  ctx: AuthContext,
  notebookId: string,
  flavor: string,
): Promise<{ notebookId: string; title: string; flavor: CodeFlavor; code: string }> {
  if (!CODE_FLAVORS.includes(flavor as CodeFlavor)) {
    throw badRequest(
      `Unknown flavor "${flavor}" — expected one of: ${CODE_FLAVORS.join(", ")}`,
    );
  }
  const notebook = await getNotebookWithBlocks(ctx, notebookId);
  const project = await getProject(ctx, notebook.projectId);
  const contracts = (await listContracts(ctx, notebook.projectId)) as ContractEntry[];
  const blocks = notebook.blocks.map((b) => ({
    ...b,
    type: b.type as BlockType,
    config: b.config as BlockConfig,
  })) as NotebookBlock[];
  return {
    notebookId,
    title: notebook.title,
    flavor: flavor as CodeFlavor,
    code: generateNotebookCode(blocks, contracts, project, flavor as CodeFlavor),
  };
}

export interface ImportResult {
  notebook: {
    id: string;
    projectId: string;
    title: string;
    description: string | null;
    createdAt: number;
    updatedAt: number;
  };
  blockCount: number;
  /** Address-book entries created by this import (names). */
  createdContracts: string[];
  /** Non-fatal notes: chain mismatch, name-only matches, dropped references. */
  warnings: string[];
}

/**
 * Import a portable notebook manifest into a project (editor+): validate,
 * map the file's contracts onto the address book (by address, then name,
 * creating what's missing), then create the notebook with fresh block ids.
 */
export async function importNotebookFile(
  ctx: AuthContext,
  projectId: string,
  input: unknown,
): Promise<ImportResult> {
  const project = await requireProject(ctx, projectId, "editor");
  const parsed = parseNotebookFile(input);
  if (!parsed.ok) throw badRequest(parsed.error);
  const file = parsed.file;

  const warnings: string[] = [];
  if (file.chain.id && file.chain.id !== project.chainId) {
    warnings.push(
      `The file targets chain ${file.chain.id} but the project uses chain ${project.chainId} — fine for forks, wrong addresses otherwise.`,
    );
  }

  // --- Map the file's contracts onto the project's address book -------------
  const existing = (await listContracts(ctx, projectId)) as ContractEntry[];
  const byAddress = new Map(
    existing.filter((c) => c.address).map((c) => [c.address.toLowerCase(), c]),
  );
  const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c]));
  const takenNames = new Set(existing.map((c) => c.name.toLowerCase()));

  const createdContracts: string[] = [];
  const contractIdByFileName = new Map<string, string>();

  for (const fileContract of file.contracts) {
    const key = fileContract.name.toLowerCase();
    const addressHit = fileContract.address
      ? byAddress.get(fileContract.address.toLowerCase())
      : undefined;
    if (addressHit) {
      contractIdByFileName.set(key, addressHit.id);
      continue;
    }
    const nameHit = byName.get(key);
    if (nameHit && (!fileContract.address || !nameHit.address)) {
      // Same name and no conflicting deployment address: reuse the entry.
      contractIdByFileName.set(key, nameHit.id);
      warnings.push(
        `Contract "${fileContract.name}" was matched to an existing address-book entry by name.`,
      );
      continue;
    }
    // Create a new entry; suffix the name when it collides with a different
    // deployment (never silently repoint blocks at another address).
    let name = fileContract.name;
    if (takenNames.has(name.toLowerCase())) {
      const suffix = fileContract.address
        ? fileContract.address.slice(0, 8)
        : "imported";
      name = `${fileContract.name} (${suffix})`;
      let n = 2;
      while (takenNames.has(name.toLowerCase())) {
        name = `${fileContract.name} (${suffix} ${n++})`;
      }
      warnings.push(
        `Contract name "${fileContract.name}" already exists with a different address — imported as "${name}".`,
      );
    }
    const created = await createContract(ctx, projectId, {
      name,
      address: fileContract.address,
      abi: fileContract.abi,
    });
    takenNames.add(name.toLowerCase());
    contractIdByFileName.set(key, created.id);
    createdContracts.push(name);
  }

  // --- Resolve block configs -------------------------------------------------
  const existingIds = new Set(existing.map((c) => c.id));
  const projectRecipes = await db
    .select({ id: schema.recipes.id })
    .from(schema.recipes)
    .where(eq(schema.recipes.projectId, projectId));
  const recipeIds = new Set(projectRecipes.map((r) => r.id));

  // Fresh ids up front so group membership can be remapped in one pass.
  const newIdByFileId = new Map<string, string>();
  const mintedIds = file.blocks.map((block) => {
    const id = crypto.randomUUID();
    if (block.id) newIdByFileId.set(block.id, id);
    return id;
  });

  const rows = file.blocks.map((block, index) => {
    const config = { ...block.config };
    if (typeof config.contract === "string") {
      const key = config.contract.toLowerCase();
      // The file's own contracts win; otherwise fall back to the project's
      // address book, so files don't need to embed ABIs the instance has.
      const resolved = contractIdByFileName.get(key) ?? byName.get(key)?.id;
      if (!resolved) {
        const available = existing.map((c) => c.name).join(", ") || "(empty)";
        throw badRequest(
          `Block ${index + 1} references contract "${config.contract}", which is neither in the file's contracts array nor this project's address book (address book: ${available}).`,
        );
      }
      config.contractId = resolved;
      delete config.contract;
    } else if (typeof config.contractId === "string" && !existingIds.has(config.contractId)) {
      warnings.push(
        `Block ${index + 1} referenced a contract id that does not exist in this project — it will need reconfiguring.`,
      );
      delete config.contractId;
    }
    if (block.type === "recipe") {
      const recipeId = typeof config.recipeId === "string" ? config.recipeId : "";
      if (recipeId && !recipeIds.has(recipeId)) {
        warnings.push(
          `Block ${index + 1} links a recipe that does not exist in this project — pick a recipe after import.`,
        );
        delete config.recipeId;
      }
    }
    return {
      id: mintedIds[index],
      order: index,
      type: block.type,
      config: JSON.stringify(config),
      outputVariable: block.outputVariable ?? null,
      parentId: block.parentId ? (newIdByFileId.get(block.parentId) ?? null) : null,
      runWhen: block.runWhen ?? null,
    };
  });

  // --- Create the notebook + blocks atomically -------------------------------
  const now = new Date();
  const notebookRow = {
    id: crypto.randomUUID(),
    projectId,
    title: file.title,
    description: file.description,
    createdAt: now,
    updatedAt: now,
  };
  // better-sqlite3 transactions are synchronous: use .run(), no awaits inside.
  db.transaction((tx) => {
    tx.insert(schema.notebooks).values(notebookRow).run();
    if (rows.length > 0) {
      tx.insert(schema.blocks)
        .values(rows.map((row) => ({ ...row, notebookId: notebookRow.id })))
        .run();
    }
  });

  // Read back through the role-checked path (also asserts consistency).
  const notebook = await requireNotebook(ctx, notebookRow.id);
  return {
    notebook: {
      id: notebook.id,
      projectId: notebook.projectId,
      title: notebook.title,
      description: notebook.description,
      createdAt: notebook.createdAt.getTime(),
      updatedAt: notebook.updatedAt.getTime(),
    },
    blockCount: rows.length,
    createdContracts,
    warnings,
  };
}
