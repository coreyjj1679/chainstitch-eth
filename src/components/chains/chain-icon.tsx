"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface ChainIconProps {
  /** CoinGecko asset URL for the chain's native logo. */
  src: string;
  /** Used for alt text and the fallback monogram if the image fails. */
  alt: string;
  className?: string;
}

/**
 * A chain logo loaded from CoinGecko's asset CDN. Falls back to a monogram
 * tile when the remote image can't be loaded (offline, air-gapped self-host,
 * CDN outage) so the dropdown never shows a broken-image glyph.
 */
export function ChainIcon({ src, alt, className }: ChainIconProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex size-4 items-center justify-center rounded-full bg-muted text-[0.55rem] font-semibold text-muted-foreground",
          className,
        )}
      >
        {alt.charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    // Brand logos are tiny remote PNGs/JPEGs from CoinGecko; not worth a
    // next/image remote-pattern config or optimizer round-trip. The rounded
    // white chip keeps opaque JPEGs (Arbitrum/Scroll/Linea) seamless in dark
    // mode and gives transparent PNGs a consistent token-icon tile.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn(
        "size-4 shrink-0 rounded-full bg-white object-contain",
        className,
      )}
    />
  );
}
