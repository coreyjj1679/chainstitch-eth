/**
 * Brand mark: a Jupyter-style cell prompt `[▪]` on a dark tile — a stitched
 * contract-flow block. Flat, single accent, dev-tool aesthetic.
 */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect width="32" height="32" rx="7" fill="#0d1420" />
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="6.5"
        stroke="#2a3648"
        strokeWidth="1"
      />
      {/* [ */}
      <path
        d="M13 9.5H10.5V22.5H13"
        stroke="#7d8ea6"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* ] */}
      <path
        d="M19 9.5H21.5V22.5H19"
        stroke="#7d8ea6"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* the block */}
      <rect x="13.75" y="13.75" width="4.5" height="4.5" rx="1.25" fill="#6366f1" />
    </svg>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 leading-none">
      <LogoMark size={size} />
      <span className="font-mono text-sm font-semibold tracking-tight lowercase">
        <span className="text-primary">chain</span>
        <span className="text-foreground/85">stitch</span>
      </span>
    </span>
  );
}
