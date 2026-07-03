"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { HighlighterCore } from "shiki";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CodeFlavor } from "@/lib/codegen";

const FLAVORS: Array<{ id: CodeFlavor; label: string; lang: string }> = [
  { id: "wagmi", label: "wagmi", lang: "typescript" },
  { id: "viem", label: "viem", lang: "typescript" },
  { id: "python", label: "python", lang: "python" },
  { id: "rust", label: "rust", lang: "rust" },
  { id: "solidity", label: "solidity", lang: "solidity" },
];

let highlighterPromise: Promise<HighlighterCore> | null = null;

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then((shiki) =>
      shiki.createHighlighter({
        themes: ["github-dark-default"],
        langs: ["typescript", "python", "rust", "solidity"],
      }),
    );
  }
  return highlighterPromise;
}

export function HighlightedCode({ code, lang = "typescript" }: { code: string; lang?: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHighlighter().then((highlighter) => {
      if (cancelled) return;
      setHtml(
        highlighter.codeToHtml(code, {
          lang,
          theme: "github-dark-default",
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (!html) {
    return (
      <pre className="overflow-x-auto rounded-lg bg-[#0d1117] p-4 font-mono text-xs text-neutral-300">
        {code}
      </pre>
    );
  }
  return (
    <div
      className="code-line-numbers overflow-x-auto rounded-lg text-xs [&_pre]:!bg-[#0d1117] [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-4"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function CodePanel({
  generate,
}: {
  generate: (flavor: CodeFlavor) => string;
}) {
  const [flavor, setFlavor] = useState<CodeFlavor>("wagmi");
  const [copied, setCopied] = useState(false);
  const code = generate(flavor);
  const lang = FLAVORS.find((f) => f.id === flavor)?.lang ?? "typescript";

  return (
    <div className="relative mt-2">
      <div className="mb-2 flex items-center justify-between">
        <Tabs value={flavor} onValueChange={(v) => setFlavor(v as CodeFlavor)}>
          <TabsList>
            {FLAVORS.map((f) => (
              <TabsTrigger key={f.id} value={f.id} className="font-mono text-xs">
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <HighlightedCode code={code} lang={lang} />
    </div>
  );
}
