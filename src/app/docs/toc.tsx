"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Left-rail table of contents with scroll-spy: the section closest to the
 * top of the viewport is highlighted. Rendered inside a sticky container by
 * the docs page (server component).
 */
export function DocsToc({ items }: { items: ReadonlyArray<readonly [string, string]> }) {
  const [active, setActive] = useState<string>(items[0]?.[0] ?? "");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost visible section; entries arrive unordered.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      // A band near the top of the viewport decides the active section.
      { rootMargin: "-10% 0px -75% 0px" },
    );
    for (const [id] of items) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label="On this page" className="grid gap-0.5">
      {items.map(([id, label]) => (
        <a
          key={id}
          href={`#${id}`}
          aria-current={active === id ? "true" : undefined}
          className={cn(
            "rounded-md border-l-2 border-transparent px-3 py-1.5 text-[0.8rem] transition-colors",
            active === id
              ? "border-primary bg-muted/60 font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
