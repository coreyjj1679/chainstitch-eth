"use client";

import { ArrowRight, GitBranch } from "lucide-react";
import { blockLabel } from "@/lib/block-label";
import type { ContractEntry, NotebookBlock } from "@/lib/types";

/** Collapsed (non-editing) view of a call/rpc block: one signature line. */
export function BlockSummary({
  block,
  contracts,
}: {
  block: NotebookBlock;
  contracts: ContractEntry[];
}) {
  return (
    <div className="flex items-center gap-2 font-mono text-sm">
      <span className="min-w-0 truncate text-foreground/90">
        {blockLabel(block, contracts)}
      </span>
      {block.runWhen && (
        <span
          className="flex min-w-0 shrink items-center gap-1 rounded border border-fuchsia-400/30 bg-fuchsia-400/10 px-1 py-0.5 text-[10px] text-fuchsia-400"
          title={`Runs only when ${block.runWhen}`}
        >
          <GitBranch className="size-2.5 shrink-0" />
          <span className="truncate">{block.runWhen}</span>
        </span>
      )}
      {block.outputVariable && (
        <>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60" />
          <span className="shrink-0 text-primary">{block.outputVariable}</span>
        </>
      )}
    </div>
  );
}
