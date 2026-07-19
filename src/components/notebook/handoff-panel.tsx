"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Code2, ListTree } from "lucide-react";
import { toast } from "sonner";
import {
  buildNotebookHandoffBrief,
  handoffBackendSteps,
  handoffFrontendSteps,
  type HandoffEvent,
  type HandoffStep,
  type NotebookHandoffBrief,
} from "@/lib/notebook-handoff";
import type { ContractEntry, NotebookBlock, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

function StepRow({ step }: { step: HandoffStep }) {
  return (
    <div className="grid gap-0.5 border-b border-border/40 py-2 last:border-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded border border-border/50 px-1 font-mono text-[10px] text-muted-foreground">
          {step.type}
        </span>
        <span className="min-w-0 flex-1 font-mono text-xs text-foreground/90">
          {step.signature
            ? `${step.contract ? `${step.contract}.` : ""}${step.signature}`
            : step.label}
        </span>
        {step.outputVariable && (
          <span className="font-mono text-[10px] text-sky-400">
            → {`{{${step.outputVariable}}}`}
          </span>
        )}
      </div>
      {step.args && step.args.some((a) => a.value !== "") && (
        <ul className="pl-2 font-mono text-[10px] text-muted-foreground/80">
          {step.args.map((a, i) =>
            a.value === "" ? null : (
              <li key={i}>
                {a.name}: <span className="text-foreground/70">{a.value}</span>
                <span className="text-muted-foreground/50"> ({a.type})</span>
              </li>
            ),
          )}
        </ul>
      )}
      {step.expectEvent && (
        <p className="pl-2 font-mono text-[10px] text-rose-400/90">
          expect event {step.expectEvent.signature ?? step.expectEvent.eventName}
          {step.expectEvent.fromVariable
            ? ` from {{${step.expectEvent.fromVariable}}}`
            : " (last write)"}
        </p>
      )}
      {step.expectRevert && (
        <p className="pl-2 font-mono text-[10px] text-rose-400/90">
          expect revert
          {step.expectRevert.reason ? ` containing “${step.expectRevert.reason}”` : ""}
        </p>
      )}
      {step.condition && (
        <p className="pl-2 font-mono text-[10px] text-fuchsia-400/80">
          {step.condition}
        </p>
      )}
    </div>
  );
}

function EventRow({ event }: { event: HandoffEvent }) {
  return (
    <div className="grid gap-0.5 border-b border-border/40 py-2 last:border-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className={cn(
            "rounded border px-1 font-mono text-[10px]",
            event.source === "expect"
              ? "border-rose-400/30 text-rose-400"
              : "border-emerald-400/30 text-emerald-400",
          )}
        >
          {event.source === "expect" ? "expect" : "query"}
        </span>
        <span className="min-w-0 flex-1 font-mono text-xs">
          {event.contract ? `${event.contract}.` : ""}
          {event.signature ?? event.eventName}
        </span>
      </div>
      {event.inputs && event.inputs.length > 0 && (
        <ul className="pl-2 font-mono text-[10px] text-muted-foreground/80">
          {event.inputs.map((inp, i) => (
            <li key={i}>
              {inp.indexed ? "indexed " : ""}
              {inp.type}
              {inp.name ? ` ${inp.name}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BriefBody({
  brief,
  onOpenCode,
}: {
  brief: NotebookHandoffBrief;
  onOpenCode?: () => void;
}) {
  const frontend = handoffFrontendSteps(brief);
  const backend = handoffBackendSteps(brief);

  return (
    <Tabs defaultValue="overview" className="gap-2">
      <TabsList className="h-7">
        <TabsTrigger value="overview" className="px-2 text-[11px]">
          Overview
        </TabsTrigger>
        <TabsTrigger value="frontend" className="px-2 text-[11px]">
          Frontend ({frontend.filter((s) => s.role === "frontend").length})
        </TabsTrigger>
        <TabsTrigger value="backend" className="px-2 text-[11px]">
          Backend ({brief.events.length})
        </TabsTrigger>
        <TabsTrigger value="variables" className="px-2 text-[11px]">
          Variables ({brief.variables.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="grid gap-3">
        {brief.intent && (
          <p className="text-sm text-foreground/90">{brief.intent}</p>
        )}
        <div className="grid gap-1 sm:grid-cols-3">
          <div className="rounded-md border border-border/50 px-2 py-1.5">
            <p className="text-[10px] text-muted-foreground">Calls</p>
            <p className="font-mono text-sm">
              {brief.steps.filter((s) => s.type === "read" || s.type === "write").length}
            </p>
          </div>
          <div className="rounded-md border border-border/50 px-2 py-1.5">
            <p className="text-[10px] text-muted-foreground">Events</p>
            <p className="font-mono text-sm">{brief.events.length}</p>
          </div>
          <div className="rounded-md border border-border/50 px-2 py-1.5">
            <p className="text-[10px] text-muted-foreground">Variables</p>
            <p className="font-mono text-sm">{brief.variables.length}</p>
          </div>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">
            Call sequence
          </p>
          <div className="max-h-56 overflow-y-auto rounded-md border border-border/40 px-2">
            {brief.steps
              .filter((s) => s.type === "read" || s.type === "write" || s.type === "rpc")
              .map((s) => (
                <StepRow key={s.blockId} step={s} />
              ))}
            {brief.steps.filter(
              (s) => s.type === "read" || s.type === "write" || s.type === "rpc",
            ).length === 0 && (
              <p className="py-2 text-[11px] text-muted-foreground/60">
                No read / write / RPC steps yet.
              </p>
            )}
          </div>
        </div>
        {onOpenCode && (
          <Button
            variant="outline"
            size="sm"
            className="w-fit gap-1.5"
            onClick={onOpenCode}
          >
            <Code2 className="size-3.5" />
            Open wagmi / viem source
          </Button>
        )}
      </TabsContent>

      <TabsContent value="frontend">
        <p className="mb-2 text-[11px] text-muted-foreground">
          Calls and hooks to wire into the app — open the code panel for copy-paste
          wagmi / viem.
        </p>
        <div className="max-h-72 overflow-y-auto rounded-md border border-border/40 px-2">
          {frontend.length === 0 ? (
            <p className="py-2 text-[11px] text-muted-foreground/60">No frontend steps.</p>
          ) : (
            frontend.map((s) => <StepRow key={s.blockId} step={s} />)
          )}
        </div>
        {onOpenCode && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-fit gap-1.5"
            onClick={onOpenCode}
          >
            <Code2 className="size-3.5" />
            Open integration source
          </Button>
        )}
      </TabsContent>

      <TabsContent value="backend">
        <p className="mb-2 text-[11px] text-muted-foreground">
          Event logs to index or assert — from Expect cells and Events query blocks.
        </p>
        <div className="max-h-72 overflow-y-auto rounded-md border border-border/40 px-2">
          {brief.events.length === 0 ? (
            <p className="py-2 text-[11px] text-muted-foreground/60">
              No expected events yet. Add an Expect → Event cell (or an Events
              query) so backends know which logs this flow produces.
            </p>
          ) : (
            brief.events.map((e) => (
              <EventRow key={`${e.fromBlockId}-${e.eventName}`} event={e} />
            ))
          )}
        </div>
        {backend.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">
              Backend steps
            </p>
            <div className="max-h-40 overflow-y-auto rounded-md border border-border/40 px-2">
              {backend.map((s) => (
                <StepRow key={s.blockId} step={s} />
              ))}
            </div>
          </div>
        )}
      </TabsContent>

      <TabsContent value="variables">
        <div className="max-h-72 overflow-y-auto rounded-md border border-border/40">
          {brief.variables.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-muted-foreground/60">
              No {"{{variables}}"} wired yet.
            </p>
          ) : (
            <table className="w-full text-left font-mono text-[11px]">
              <thead className="border-b border-border/40 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Name</th>
                  <th className="px-2 py-1.5 font-medium">Produced by</th>
                  <th className="px-2 py-1.5 font-medium">Consumed by</th>
                </tr>
              </thead>
              <tbody>
                {brief.variables.map((v) => (
                  <tr key={v.name} className="border-b border-border/30 last:border-0">
                    <td className="px-2 py-1.5 text-sky-400">{`{{${v.name}}}`}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {v.constantValue !== undefined
                        ? `const ${v.constantValue}`
                        : (v.producedByBlockId?.slice(0, 8) ?? "—")}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {v.consumedBy.length
                        ? `${v.consumedBy.length} block${v.consumedBy.length === 1 ? "" : "s"}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}

/**
 * Notebook-level integration handoff panel — call sequence, event catalog,
 * variable wiring, with Frontend / Backend tabs.
 */
export function HandoffPanel({
  title,
  description,
  blocks,
  contracts,
  project,
  onOpenCode,
}: {
  title: string;
  description?: string | null;
  blocks: NotebookBlock[];
  contracts: ContractEntry[];
  project: Project;
  onOpenCode?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const brief = useMemo(
    () =>
      buildNotebookHandoffBrief(blocks, contracts, {
        title,
        description,
        chainId: project.chainId,
      }),
    [blocks, contracts, title, description, project.chainId],
  );

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(brief, null, 2));
      setCopied(true);
      toast.success("Handoff brief copied");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <div className="mb-6 rounded-xl border p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ListTree className="size-4 text-muted-foreground" />
        <p className="text-sm font-medium">Integration handoff</p>
        <span className="font-mono text-[10px] text-muted-foreground/70">
          chain {brief.chainId}
          {brief.contracts.length > 0
            ? ` · ${brief.contracts.map((c) => c.name).join(", ")}`
            : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1.5 text-xs"
          onClick={copyJson}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          Copy JSON
        </Button>
      </div>
      <BriefBody brief={brief} onOpenCode={onOpenCode} />
    </div>
  );
}
