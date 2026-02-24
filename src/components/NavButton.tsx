import type { LucideIcon } from "lucide-react";

interface Props {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  testId?: string;
}

export function NavButton({ active, onClick, icon: Icon, label, testId }: Props) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`relative flex flex-col items-center justify-center gap-1 transition-colors ${
        active ? "text-blue-500" : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {active ? <div className="absolute -top-[1px] h-[2px] w-8 rounded-full bg-blue-500 shadow-glow" /> : null}
      <div className={`rounded-full p-1.5 transition-all ${active ? "bg-blue-500/10" : "bg-transparent"}`}>
        <Icon size={20} strokeWidth={active ? 2.5 : 2} />
      </div>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}
