"use client";

import { ArrowRight } from "lucide-react";
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
      {block.outputVariable && (
        <>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60" />
          <span className="shrink-0 text-primary">{block.outputVariable}</span>
        </>
      )}
    </div>
  );
}
