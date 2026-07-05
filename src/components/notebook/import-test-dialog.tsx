"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import {
  ArrowLeft,
  ClipboardCheck,
  FileCode,
  FileJson,
  LoaderCircle,
  Sparkles,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { validateAbi } from "@/lib/abi";
import {
  convertTestToBlocks,
  DEFAULT_GEMINI_MODEL,
  findTestFunctions,
  GEMINI_KEY_STORAGE,
  GEMINI_MODEL_STORAGE,
  GEMINI_MODELS,
  preflightCheck,
  type AiImportResult,
  type ImportSourceFile,
  type PreflightReport,
  type SuppliedAbi,
} from "@/lib/ai-import";
import { blockLabel, executionOrder } from "@/lib/block-label";
import type { CallConfig, ContractEntry, NotebookBlock } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const PASTED_NAME = "pasted.t.sol";

/**
 * Paste/drop Foundry test files (plus imported .sol context and Foundry
 * artifact ABIs), pick the test functions to convert, optionally pre-flight
 * what's missing, convert with Gemini (bring your own free-tier key), preview,
 * insert. The API calls go straight from the browser to Google — the key
 * lives in localStorage and never reaches the Chainstitch server.
 */
export function ImportTestDialog({
  open,
  onOpenChange,
  projectId,
  contracts,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  contracts: ContractEntry[];
  onInsert: (blocks: NotebookBlock[]) => void;
}) {
  const queryClient = useQueryClient();
  // Guarded for SSR — client components still prerender on the server.
  const [apiKey, setApiKey] = useState(() =>
    typeof window === "undefined" ? "" : (localStorage.getItem(GEMINI_KEY_STORAGE) ?? ""),
  );
  const [model, setModel] = useState(() =>
    typeof window === "undefined"
      ? DEFAULT_GEMINI_MODEL
      : (localStorage.getItem(GEMINI_MODEL_STORAGE) ?? DEFAULT_GEMINI_MODEL),
  );
  const [source, setSource] = useState("");
  const [extraFiles, setExtraFiles] = useState<ImportSourceFile[]>([]);
  const [extraAbis, setExtraAbis] = useState<SuppliedAbi[]>([]);
  /** Unchecked test functions (new ones default to selected). */
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [busy, setBusy] = useState<"preflight" | "convert" | "insert" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiImportResult | null>(null);
  const [addMissing, setAddMissing] = useState(true);

  const files = useMemo<ImportSourceFile[]>(
    () => [
      ...(source.trim() ? [{ name: PASTED_NAME, content: source }] : []),
      ...extraFiles,
    ],
    [source, extraFiles],
  );
  const allTests = useMemo(() => findTestFunctions(files), [files]);
  const selectedTests = allTests.filter((t) => !deselected.has(t));

  const hasInput = files.length > 0;
  const needsTestSelection = allTests.length > 1 && selectedTests.length === 0;
  const ready = apiKey.trim() !== "" && hasInput && !busy;

  /** Any source change invalidates a previous pre-flight report. */
  function touchSources() {
    setPreflight(null);
    setError(null);
  }

  async function addDroppedFiles(accepted: File[]) {
    for (const file of accepted) {
      const text = await file.text();
      if (/\.json$/i.test(file.name)) {
        const validation = validateAbi(text);
        if (!validation.ok) {
          toast.error(`${file.name}: ${validation.error}`);
          continue;
        }
        const name = file.name.replace(/\.json$/i, "");
        setExtraAbis((prev) =>
          prev.some((a) => a.name.toLowerCase() === name.toLowerCase())
            ? prev
            : [...prev, { name, abi: validation.abi }],
        );
      } else {
        setExtraFiles((prev) =>
          prev.some((f) => f.name === file.name)
            ? prev
            : [...prev, { name: file.name, content: text }],
        );
      }
    }
    touchSources();
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted) => void addDroppedFiles(accepted),
    accept: { "application/json": [".json"], "text/plain": [".sol"] },
    noClick: false,
  });

  async function runPreflight() {
    setBusy("preflight");
    setError(null);
    try {
      setPreflight(
        await preflightCheck({
          files,
          contracts,
          extraAbis,
          apiKey: apiKey.trim(),
          model,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function convert() {
    setBusy("convert");
    setError(null);
    try {
      const converted = await convertTestToBlocks({
        files,
        contracts,
        extraAbis,
        // All selected = no restriction (also covers the 0/1-test cases).
        selectedTests:
          allTests.length > 1 && selectedTests.length < allTests.length
            ? selectedTests
            : undefined,
        apiKey: apiKey.trim(),
        model,
      });
      setResult(converted);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Create supplied-ABI contracts first so their blocks insert configured. */
  async function insert() {
    if (!result) return;
    setBusy("insert");
    try {
      const importable = result.missing.filter((m) => m.abi);
      if (addMissing && importable.length > 0) {
        for (const m of importable) {
          try {
            const created = await api.contracts.create(projectId, {
              name: m.name,
              address: "",
              abi: m.abi,
            });
            for (const block of result.blocks) {
              if (m.blockIds.includes(block.id)) {
                (block.config as CallConfig).contractId = created.id;
              }
            }
          } catch (e) {
            toast.error(
              `Could not add "${m.name}" to the address book: ${e instanceof Error ? e.message : e}`,
            );
          }
        }
        queryClient.invalidateQueries({ queryKey: ["contracts", projectId] });
      }
      onInsert(result.blocks);
      setResult(null);
      setPreflight(null);
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  }

  const previewSteps = result ? executionOrder(result.blocks) : [];
  const importableMissing = result?.missing.filter((m) => m.abi) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Import from Foundry test
          </DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="grid gap-4 py-2">
            <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
              <div className="grid gap-2">
                <Label htmlFor="gemini-key">Google AI Studio API key</Label>
                <Input
                  id="gemini-key"
                  type="password"
                  className="font-mono"
                  placeholder="AIza…"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    localStorage.setItem(GEMINI_KEY_STORAGE, e.target.value);
                  }}
                />
              </div>
              <div className="grid gap-2">
                <Label>Model</Label>
                <Select
                  value={model}
                  items={GEMINI_MODELS.map((m) => ({ value: m, label: m }))}
                  onValueChange={(value) => {
                    const next = (value as string) ?? DEFAULT_GEMINI_MODEL;
                    setModel(next);
                    localStorage.setItem(GEMINI_MODEL_STORAGE, next);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {GEMINI_MODELS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground/70">
              Free at{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                aistudio.google.com/apikey
              </a>{" "}
              (~1,500 requests/day, no card). Files are sent from your browser
              straight to Google with your key — nothing touches the Chainstitch
              server.
            </p>

            <div className="grid gap-2">
              <Label htmlFor="test-source">Test file</Label>
              <Textarea
                id="test-source"
                className="max-h-56 min-h-40 font-mono text-xs"
                placeholder={`Paste a .t.sol file (or drop files below) — the more context, the better the conversion.`}
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  touchSources();
                }}
              />
            </div>

            <div
              {...getRootProps()}
              className={cn(
                "flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-xs text-muted-foreground transition-colors",
                isDragActive ? "border-primary bg-primary/5" : "hover:border-ring/60",
              )}
            >
              <input {...getInputProps()} />
              <Upload className="size-3.5 shrink-0" />
              Drop imported <code className="rounded bg-muted px-1">.sol</code> files
              (base tests, interfaces) and Foundry artifacts
              <code className="rounded bg-muted px-1">out/**/*.json</code> — or click
            </div>

            {(extraFiles.length > 0 || extraAbis.length > 0) && (
              <div className="grid gap-0.5">
                {extraFiles.map((f) => (
                  <div
                    key={f.name}
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-muted-foreground"
                  >
                    <FileCode className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-mono">{f.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/60">
                      {f.content.split("\n").length} lines
                    </span>
                    <button
                      className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => {
                        setExtraFiles((prev) => prev.filter((x) => x.name !== f.name));
                        touchSources();
                      }}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
                {extraAbis.map((a) => (
                  <div
                    key={a.name}
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-muted-foreground"
                  >
                    <FileJson className="size-3.5 shrink-0 text-cyan-400/80" />
                    <span className="min-w-0 flex-1 truncate font-mono">{a.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/60">
                      ABI · {a.abi.length} entries
                    </span>
                    <button
                      className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`Remove ${a.name}`}
                      onClick={() => {
                        setExtraAbis((prev) => prev.filter((x) => x.name !== a.name));
                        touchSources();
                      }}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {allTests.length > 1 && (
              <div className="grid gap-1.5">
                <div className="flex items-baseline justify-between">
                  <Label>
                    Test functions ({selectedTests.length}/{allTests.length})
                  </Label>
                  <button
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() =>
                      setDeselected(
                        selectedTests.length === allTests.length
                          ? new Set(allTests)
                          : new Set(),
                      )
                    }
                  >
                    {selectedTests.length === allTests.length ? "none" : "all"}
                  </button>
                </div>
                <div className="grid max-h-40 gap-0.5 overflow-y-auto rounded-md border p-1.5">
                  {allTests.map((name) => (
                    <label
                      key={name}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={!deselected.has(name)}
                        onChange={() =>
                          setDeselected((prev) => {
                            const next = new Set(prev);
                            if (next.has(name)) next.delete(name);
                            else next.add(name);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground/70">
                  Converting a few tests at a time keeps large suites reliable —
                  setUp() and helpers are always included as context.
                </p>
              </div>
            )}

            {preflight && (
              <div className="grid gap-1.5 rounded-md border p-2.5">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <ClipboardCheck className="size-3.5 shrink-0 text-primary" />
                  {preflight.summary || "Pre-flight check"}
                </p>
                {preflight.contracts.map((c) => (
                  <p key={c.name} className="flex items-start gap-1.5 text-xs">
                    <span
                      className={cn(
                        "mt-1 size-1.5 shrink-0 rounded-full",
                        c.status === "address-book" && "bg-emerald-400",
                        c.status === "artifact" && "bg-cyan-400",
                        c.status === "missing" && "bg-amber-400",
                      )}
                    />
                    <span className="min-w-0">
                      <span className="font-mono">{c.name}</span>{" "}
                      <span className="text-muted-foreground">
                        {c.status === "address-book"
                          ? "— in the address book"
                          : c.status === "artifact"
                            ? "— ABI supplied, will be added on insert"
                            : "— missing: drop its artifact or add it to the address book"}
                        {c.why ? ` · ${c.why}` : ""}
                      </span>
                    </span>
                  </p>
                ))}
                {preflight.unresolved.map((u, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-xs text-amber-500">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                    {u}
                  </p>
                ))}
                {preflight.contracts.length === 0 &&
                  preflight.unresolved.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Nothing missing — ready to convert.
                    </p>
                  )}
              </div>
            )}

            {error && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-3 py-2">
            {result.warnings.length > 0 && (
              <div className="grid gap-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
                {result.warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-xs text-amber-500">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                    {w}
                  </p>
                ))}
              </div>
            )}

            {result.missing.length > 0 && (
              <div className="grid gap-1.5 rounded-md border p-2.5">
                <p className="text-xs font-medium">
                  {result.missing.length}{" "}
                  {result.missing.length === 1 ? "contract isn't" : "contracts aren't"} in
                  the address book
                </p>
                {result.missing.map((m) => (
                  <p key={m.name} className="flex items-start gap-1.5 text-xs">
                    <FileJson
                      className={cn(
                        "mt-0.5 size-3.5 shrink-0",
                        m.abi ? "text-cyan-400" : "text-muted-foreground/50",
                      )}
                    />
                    <span className="min-w-0 text-muted-foreground">
                      <span className="font-mono text-foreground">{m.name}</span>{" "}
                      {m.abi
                        ? "— ABI supplied; added with an empty address for you to fill"
                        : "— no ABI; add it in the Contracts tab, then select it in the affected blocks"}
                    </span>
                  </p>
                ))}
                {importableMissing.length > 0 && (
                  <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={addMissing}
                      onChange={() => setAddMissing((v) => !v)}
                    />
                    Add {importableMissing.length}{" "}
                    {importableMissing.length === 1 ? "contract" : "contracts"} to the
                    address book on insert
                  </label>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <Label>
                Preview — {result.blocks.length}{" "}
                {result.blocks.length === 1 ? "block" : "blocks"}
              </Label>
              <div className="grid max-h-64 gap-0.5 overflow-y-auto rounded-md border p-1.5">
                {previewSteps.map((step, index) => (
                  <div
                    key={step.id}
                    className={cn(
                      "flex items-center gap-2 rounded px-1.5 py-1 text-xs",
                      step.parentId && "ml-5",
                    )}
                  >
                    <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted-foreground/40">
                      {index + 1}
                    </span>
                    <span className="shrink-0 rounded border border-border/60 bg-muted/40 px-1 font-mono text-[10px] text-muted-foreground">
                      {step.type}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {blockLabel(step, contracts)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground/70">
                Blocks insert at the end of the document, fully editable — nothing
                runs until you run it.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {!result ? (
            <>
              <Button
                variant="outline"
                disabled={!ready}
                onClick={runPreflight}
                title="One cheap request: what do these tests need that isn't provided yet?"
              >
                {busy === "preflight" ? (
                  <LoaderCircle data-icon="inline-start" className="animate-spin" />
                ) : (
                  <ClipboardCheck data-icon="inline-start" />
                )}
                {busy === "preflight" ? "Checking…" : "Check requirements"}
              </Button>
              <Button
                disabled={!ready || needsTestSelection}
                onClick={convert}
                title={needsTestSelection ? "Select at least one test function" : undefined}
              >
                {busy === "convert" ? (
                  <LoaderCircle data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Sparkles data-icon="inline-start" />
                )}
                {busy === "convert" ? "Converting…" : "Convert"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setResult(null)}>
                <ArrowLeft data-icon="inline-start" />
                Back
              </Button>
              <Button disabled={busy === "insert"} onClick={insert}>
                {busy === "insert" && (
                  <LoaderCircle data-icon="inline-start" className="animate-spin" />
                )}
                Insert {result.blocks.length}{" "}
                {result.blocks.length === 1 ? "block" : "blocks"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
