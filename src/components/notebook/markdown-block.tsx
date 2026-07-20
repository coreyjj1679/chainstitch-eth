"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { interpolateLenient } from "@/lib/variables";
import { displayValue } from "@/lib/serialize";
import { useNotebookStore } from "@/stores/notebook-store";
import { Textarea } from "@/components/ui/textarea";
import type { MarkdownConfig } from "@/lib/types";

/**
 * Text / markdown cell. GFM (tables, strikethrough, autolinks) + KaTeX math
 * (`$inline$` / `$$block$$`). `{{variable}}` interpolates from the run scope
 * before markdown parses, so live numbers can sit inside prose.
 */
export function MarkdownBlock({
  config,
  editing,
  onChange,
}: {
  config: MarkdownConfig;
  editing: boolean;
  onChange: (config: Partial<MarkdownConfig>) => void;
}) {
  // Text blocks can reference run results: {{temp}} renders the live value.
  const scope = useNotebookStore((s) => s.scope);

  if (editing) {
    return (
      <Textarea
        autoFocus
        placeholder={"Write markdown… {{variableName}} for run results, $x^2$ / $$\\frac{a}{b}$$ for math"}
        className="min-h-24 font-mono text-sm"
        value={config.text}
        onChange={(e) => onChange({ text: e.target.value })}
      />
    );
  }

  if (!config.text.trim()) {
    return (
      <p className="text-sm text-muted-foreground/60 italic">
        Empty text block — double-click or hit the pencil to edit.
      </p>
    );
  }

  return (
    <div
      className={
        "prose prose-sm prose-invert max-w-none cursor-text rounded-md px-1 py-0.5 " +
        // Tighten notebook cells vs default prose rhythm; keep tables readable.
        "prose-headings:scroll-mt-20 prose-headings:font-semibold " +
        "prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 " +
        "prose-hr:my-4 prose-hr:border-border " +
        "prose-a:text-primary prose-a:no-underline hover:prose-a:underline " +
        "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 " +
        "prose-code:font-mono prose-code:text-xs prose-code:before:content-none prose-code:after:content-none " +
        "prose-pre:bg-muted/60 prose-pre:border prose-pre:border-border " +
        "prose-table:text-sm prose-th:border-b prose-th:border-border prose-th:px-2 prose-th:py-1.5 " +
        "prose-td:border-b prose-td:border-border/60 prose-td:px-2 prose-td:py-1.5 " +
        "[&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto"
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {interpolateLenient(config.text, scope, displayValue)}
      </ReactMarkdown>
    </div>
  );
}
