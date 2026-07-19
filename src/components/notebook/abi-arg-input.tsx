"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPublicClient, http, isAddress } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import type { PublicClient } from "viem";
import {
  baseToHuman,
  humanToBase,
  isAddressAbiType,
  isAmountLikeParam,
  isBoolAbiType,
  isIntegerAbiType,
  isRawIntegerString,
  isVariableOrEmpty,
  looksLikeEnsName,
} from "@/lib/units";
import type { ContractEntry } from "@/lib/types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type UnitMode = "human" | "raw";

function placeholderFor(
  type: string,
  opts: { amount?: boolean; unitLabel?: string },
): string {
  if (type.endsWith("]") || type.startsWith("tuple")) {
    return 'JSON, e.g. ["0x…", "123n"]';
  }
  if (opts.amount && opts.unitLabel) {
    return `e.g. 1.5 — or {{variable}}`;
  }
  if (isIntegerAbiType(type)) return "0 — or {{variable}}";
  if (isAddressAbiType(type)) return "0x… / name / ENS — or {{variable}}";
  return `${type} — or {{variable}}`;
}

/** Lazy mainnet client for ENS when the project chain has no resolver. */
let ensClient: PublicClient | null = null;
function getEnsClient(): PublicClient {
  if (!ensClient) {
    ensClient = createPublicClient({
      chain: mainnet,
      transport: http(),
    }) as PublicClient;
  }
  return ensClient;
}

async function resolveEns(
  name: string,
  projectClient?: PublicClient,
): Promise<string | null> {
  const normalized = normalize(name.trim());
  const tryClient = async (client: PublicClient) => {
    try {
      const addr = await client.getEnsAddress({ name: normalized });
      return addr ?? null;
    } catch {
      return null;
    }
  };
  if (projectClient?.chain?.id === 1) {
    return tryClient(projectClient);
  }
  const fromProject = projectClient ? await tryClient(projectClient) : null;
  if (fromProject) return fromProject;
  return tryClient(getEnsClient());
}

function AmountArgInput({
  value,
  onChange,
  decimals,
  unitLabel,
  type,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  decimals: number;
  unitLabel: string;
  type: string;
  className?: string;
}) {
  const [mode, setMode] = useState<UnitMode>(() =>
    isVariableOrEmpty(value) || !isRawIntegerString(value) ? "raw" : "human",
  );
  /** Local edit buffer; `null` means derive the shown text from `value`. */
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const display =
    draft ??
    (mode === "human" && isRawIntegerString(value)
      ? (baseToHuman(value, decimals) ?? value)
      : value);

  const commitHuman = useCallback(
    (text: string) => {
      if (isVariableOrEmpty(text)) {
        setMode("raw");
        setDraft(null);
        setError(null);
        onChange(text);
        return;
      }
      const parsed = humanToBase(text, decimals);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      setError(null);
      setDraft(null);
      onChange(parsed.base);
    },
    [decimals, onChange],
  );

  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          className={cn("h-8 flex-1 font-mono text-xs", className)}
          placeholder={placeholderFor(type, { amount: true, unitLabel })}
          value={display}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            setError(null);
            if (mode === "raw") onChange(next);
          }}
          onBlur={() => {
            if (mode === "human") commitHuman(display);
            else setDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && mode === "human") {
              e.currentTarget.blur();
            }
          }}
        />
        <button
          type="button"
          title={
            mode === "human"
              ? `Entering ${unitLabel}; click for raw base units`
              : `Entering raw units; click for ${unitLabel}`
          }
          className="h-8 shrink-0 rounded-md border border-border/60 bg-muted/40 px-2 font-mono text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => {
            if (mode === "human") {
              if (!isVariableOrEmpty(display)) {
                const parsed = humanToBase(display, decimals);
                if (parsed.ok) onChange(parsed.base);
              }
              setMode("raw");
              setDraft(null);
              setError(null);
            } else {
              if (isVariableOrEmpty(value)) return;
              if (!isRawIntegerString(value)) return;
              if (baseToHuman(value, decimals) == null) return;
              setMode("human");
              setDraft(null);
              setError(null);
            }
          }}
        >
          {mode === "human" ? unitLabel : "raw"}
        </button>
      </div>
      {error && (
        <p className="text-[10px] text-destructive">{error}</p>
      )}
      {mode === "human" && isRawIntegerString(value) && !error && (
        <p className="font-mono text-[10px] text-muted-foreground/60">
          = {value} raw
        </p>
      )}
    </div>
  );
}

function AddressArgInput({
  value,
  onChange,
  contracts,
  publicClient,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  contracts: ContractEntry[];
  publicClient?: PublicClient;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [ensStatus, setEnsStatus] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const resolving = useRef(false);

  const query = value.trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!query || query.includes("{{")) return [];
    if (isAddress(value.trim())) return [];
    return contracts
      .filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.address.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [contracts, query, value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const tryResolveEns = useCallback(
    async (text: string) => {
      if (!looksLikeEnsName(text) || resolving.current) return;
      resolving.current = true;
      setEnsStatus("Resolving ENS…");
      try {
        const addr = await resolveEns(text, publicClient);
        if (addr) {
          onChange(addr);
          setEnsStatus(`Resolved ${text.trim()}`);
        } else {
          setEnsStatus("ENS name not found");
        }
      } catch {
        setEnsStatus("ENS resolve failed");
      } finally {
        resolving.current = false;
      }
    },
    [onChange, publicClient],
  );

  return (
    <div ref={wrapRef} className="relative grid gap-1">
      <Input
        className={cn("h-8 font-mono text-xs", className)}
        placeholder={placeholderFor("address", {})}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setEnsStatus(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so a suggestion click can land first.
          window.setTimeout(() => {
            void tryResolveEns(value);
          }, 120);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && looksLikeEnsName(value)) {
            e.preventDefault();
            void tryResolveEns(value);
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute top-full z-40 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-md">
          {suggestions.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full flex-col gap-0.5 px-2 py-1.5 text-left hover:bg-muted"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(c.address);
                  setOpen(false);
                  setEnsStatus(null);
                }}
              >
                <span className="truncate text-xs font-medium">{c.name}</span>
                <span className="truncate font-mono text-[10px] text-muted-foreground">
                  {c.address}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {ensStatus && (
        <p className="text-[10px] text-muted-foreground/70">{ensStatus}</p>
      )}
    </div>
  );
}

/**
 * Shared ABI argument / filter field: bool select, address autocomplete +
 * ENS, unit-aware amounts when decimals are known, otherwise a plain input.
 */
export function AbiArgInput({
  name,
  type,
  value,
  onChange,
  contracts = [],
  decimals,
  unitLabel,
  publicClient,
  className,
}: {
  name?: string;
  type: string;
  value: string;
  onChange: (next: string) => void;
  contracts?: ContractEntry[];
  /** Token / ETH decimals — enables human amount entry when set. */
  decimals?: number | null;
  unitLabel?: string;
  publicClient?: PublicClient;
  className?: string;
}) {
  if (isBoolAbiType(type)) {
    if (value.includes("{{")) {
      return (
        <Input
          className={cn("h-8 font-mono text-xs", className)}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="true / false / {{variable}}"
        />
      );
    }
    const normalized =
      value === "true" || value === "1"
        ? "true"
        : value === "false" || value === "0"
          ? "false"
          : value;
    return (
      <Select
        value={normalized === "true" || normalized === "false" ? normalized : null}
        items={[
          { value: "true", label: "true" },
          { value: "false", label: "false" },
        ]}
        onValueChange={(v) => onChange((v as string) ?? "")}
      >
        <SelectTrigger className={cn("h-8 w-full font-mono text-xs", className)}>
          <SelectValue placeholder="true / false" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true" className="font-mono">
            true
          </SelectItem>
          <SelectItem value="false" className="font-mono">
            false
          </SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (isAddressAbiType(type)) {
    return (
      <AddressArgInput
        value={value}
        onChange={onChange}
        contracts={contracts}
        publicClient={publicClient}
        className={className}
      />
    );
  }

  if (
    decimals != null &&
    decimals >= 0 &&
    isAmountLikeParam(name, type)
  ) {
    return (
      <AmountArgInput
        value={value}
        onChange={onChange}
        decimals={decimals}
        unitLabel={unitLabel ?? "units"}
        type={type}
        className={className}
      />
    );
  }

  return (
    <Input
      className={cn("h-8 font-mono text-xs", className)}
      placeholder={placeholderFor(type, {})}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Payable ETH value — always 18 decimals, toggle ETH / wei. */
export function PayableValueInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  return (
    <AmountArgInput
      value={value}
      onChange={onChange}
      decimals={18}
      unitLabel="ETH"
      type="uint256"
      className={className}
    />
  );
}
