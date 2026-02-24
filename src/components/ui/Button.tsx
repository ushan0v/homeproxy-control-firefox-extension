import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon" | "square";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
}

const VARIANT_STYLES: Record<Variant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/20",
  secondary: "bg-zinc-900 text-zinc-100 hover:bg-zinc-800 border border-zinc-700",
  ghost: "bg-transparent text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60",
  danger: "bg-rose-600/10 text-rose-500 hover:bg-rose-600/20 border border-rose-600/30",
};

const SIZE_STYLES: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-9 px-3 text-xs",
  lg: "h-11 px-5 text-sm",
  icon: "h-9 w-9",
  square: "h-11 w-11",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-lg font-medium focus:outline-none focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_STYLES[variant]} ${SIZE_STYLES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
