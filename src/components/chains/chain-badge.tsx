import { Hammer, Link2 } from "lucide-react";
import { CHAIN_PRESETS } from "@/components/chains/chain-presets";
import { ChainIcon } from "@/components/chains/chain-icon";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Chain badge with the network's logo and name (falls back to "chain <id>"
 * for networks without a preset). The raw id stays available on hover.
 */
export function ChainBadge({
  chainId,
  className,
}: {
  chainId: number;
  className?: string;
}) {
  const preset = CHAIN_PRESETS.find((p) => p.chainId === chainId);

  return (
    <Badge
      variant="secondary"
      title={`chain id ${chainId}`}
      className={cn("gap-1.5 text-xs", className)}
    >
      {preset?.iconKind === "hammer" ? (
        <Hammer className="size-3 shrink-0 text-muted-foreground" />
      ) : preset?.iconUrl ? (
        <ChainIcon
          src={preset.iconUrl}
          alt={preset.iconAlt ?? preset.label}
          className="size-3"
        />
      ) : (
        <Link2 className="size-3 shrink-0 text-muted-foreground" />
      )}
      {preset ? preset.label : `chain ${chainId}`}
    </Badge>
  );
}
