"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { interpolateLenient } from "@/lib/variables";
import { displayValue } from "@/lib/serialize";
import { useNotebookStore } from "@/stores/notebook-store";
import { Textarea } from "@/components/ui/textarea";
import type { MarkdownConfig } from "@/lib/types";

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
        placeholder="Write markdown… use {{variableName}} to show a run result inline"
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
    <div className="prose prose-sm prose-invert max-w-none cursor-text rounded-md px-1 py-0.5 [&_a]:text-primary [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_p]:leading-6 [&_table]:text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {interpolateLenient(config.text, scope, displayValue)}
      </ReactMarkdown>
    </div>
  );
}
