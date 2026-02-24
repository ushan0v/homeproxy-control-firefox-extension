import type { ReactNode } from "react";

type Color = "zinc" | "amber" | "emerald" | "rose" | "blue";

interface Props {
  children: ReactNode;
  color?: Color;
  className?: string;
}

const COLORS: Record<Color, string> = {
  zinc: "bg-zinc-800 text-zinc-300",
  amber: "bg-amber-500/15 text-amber-500 border border-amber-500/20",
  emerald: "bg-emerald-500/15 text-emerald-500 border border-emerald-500/20",
  rose: "bg-rose-500/15 text-rose-500 border border-rose-500/20",
  blue: "bg-blue-500/15 text-blue-500 border border-blue-500/20",
};

export function Badge({ children, color = "zinc", className = "" }: Props) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${COLORS[color]} ${className}`}
    >
      {children}
    </span>
  );
}
