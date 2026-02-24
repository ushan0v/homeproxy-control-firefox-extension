import type { InputHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  icon?: LucideIcon;
  error?: boolean;
}

export function Input({ icon: Icon, className = "", error, ...rest }: Props) {
  return (
    <div className="relative">
      {Icon ? (
        <div
          className={`absolute left-2.5 top-1/2 -translate-y-1/2 transition-colors ${
            error ? "text-rose-500" : "text-zinc-500"
          }`}
        >
          <Icon size={16} />
        </div>
      ) : null}
      <input
        className={`h-9 w-full rounded-lg border bg-zinc-900/90 pr-2 text-xs text-zinc-100 placeholder:text-zinc-500/70 focus:outline-none ${
          Icon ? "pl-8" : "pl-2"
        } ${
          error
            ? "border-rose-500/60 focus:border-rose-500"
            : "border-zinc-700 focus:border-blue-500/40"
        } ${className}`}
        {...rest}
      />
    </div>
  );
}
