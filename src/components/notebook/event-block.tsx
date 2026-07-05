"use client";

import { useEffect, useMemo } from "react";
import { eventSignature, getEvents } from "@/lib/abi";
import type { ContractEntry, EventConfig } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Event block: pick a contract event from the address book, optionally
 * filter on its indexed params, choose a block range — the run queries
 * `eth_getLogs` and decodes every match.
 */
export function EventBlock({
  config,
  contracts,
  onChange,
}: {
  config: EventConfig;
  contracts: ContractEntry[];
  onChange: (config: Partial<EventConfig>) => void;
}) {
  const contract = contracts.find((c) => c.id === config.contractId);
  const events = useMemo(() => (contract ? getEvents(contract.abi) : []), [contract]);
  const selected = events.find((e) => e.name === config.eventName);

  // Skip pointless dropdown interaction when there is only one choice.
  useEffect(() => {
    if (!config.contractId && contracts.length === 1) {
      onChange({ contractId: contracts[0].id, eventName: "", filters: [] });
    }
  }, [config.contractId, contracts, onChange]);

  useEffect(() => {
    if (contract && !config.eventName && events.length === 1) {
      onChange({ eventName: events[0].name, filters: [] });
    }
  }, [contract, config.eventName, events, onChange]);

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Contract</Label>
          <Select
            value={config.contractId || null}
            items={contracts.map((c) => ({ value: c.id, label: c.name }))}
            onValueChange={(value) =>
              onChange({ contractId: (value as string) ?? "", eventName: "", filters: [] })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select contract…" />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {contracts.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Event</Label>
          <Select
            value={config.eventName || null}
            items={events.map((e) => ({ value: e.name, label: eventSignature(e) }))}
            onValueChange={(value) =>
              onChange({ eventName: (value as string) ?? "", filters: [] })
            }
          >
            <SelectTrigger className="w-full font-mono" disabled={!contract}>
              <SelectValue
                placeholder={
                  contract && events.length === 0
                    ? "No events in this ABI"
                    : "Select event…"
                }
              />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {events.map((e) => (
                <SelectItem key={eventSignature(e)} value={e.name} className="font-mono">
                  {eventSignature(e)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selected && selected.inputs.some((i) => i.indexed) && (
        <div className="grid gap-2">
          {selected.inputs.map((input, i) =>
            input.indexed ? (
              <div key={i} className="grid grid-cols-[10rem_1fr] items-center gap-2">
                <Label className="justify-end truncate text-right font-mono text-xs text-muted-foreground">
                  {input.name || `topic${i}`}
                  <span className="text-muted-foreground/60"> {input.type}</span>
                </Label>
                <Input
                  className="h-8 font-mono text-xs"
                  placeholder="any — or a value / {{variable}} to filter"
                  value={config.filters?.[i] ?? ""}
                  onChange={(e) => {
                    const filters = [...(config.filters ?? [])];
                    while (filters.length <= i) filters.push("");
                    filters[i] = e.target.value;
                    onChange({ filters });
                  }}
                />
              </div>
            ) : null,
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="grid grid-cols-[10rem_1fr] items-center gap-2">
          <Label className="justify-end text-right font-mono text-xs text-muted-foreground">
            from block
          </Label>
          <Input
            className="h-8 font-mono text-xs"
            placeholder="last ~1000 blocks"
            title='A block number, "earliest", or {{variable}} — empty scans the recent ~1000 blocks'
            value={config.fromBlock ?? ""}
            onChange={(e) => onChange({ fromBlock: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-[6rem_1fr] items-center gap-2">
          <Label className="justify-end text-right font-mono text-xs text-muted-foreground">
            to block
          </Label>
          <Input
            className="h-8 font-mono text-xs"
            placeholder="latest"
            title='A block number, "latest", or {{variable}}'
            value={config.toBlock ?? ""}
            onChange={(e) => onChange({ toBlock: e.target.value })}
          />
        </div>
      </div>

      {selected && (
        <p className="font-mono text-xs text-muted-foreground/70">
          matches decode to {"{ event, blockNumber, txHash, args }"} — save as a
          variable and drill in downstream, e.g.{" "}
          {`{{logs[0].args.${selected.inputs.find((i) => i.name)?.name ?? "value"}}}`}
        </p>
      )}
    </div>
  );
}
