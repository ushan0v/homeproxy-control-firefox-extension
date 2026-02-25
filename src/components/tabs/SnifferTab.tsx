import { useMemo, useState } from "react";
import { CircleAlert, Trash2 } from "lucide-react";
import type { SnifferDomainItem } from "../../types/homeproxy";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

interface Props {
  items: SnifferDomainItem[];
  tabId: number | null;
  onOpenQuick: (domain: string) => void;
  onClearSniffer: (tabId: number) => Promise<void>;
}

const FILTERS = ["All", "Proxy", "Direct", "Block"] as const;

type FilterType = (typeof FILTERS)[number];

function toTestIdSuffix(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "") || "item";
}

export function SnifferTab({ items, tabId, onOpenQuick, onClearSniffer }: Props) {
  const [filter, setFilter] = useState<FilterType>("All");

  const filtered = useMemo(() => {
    if (filter === "All") return items;
    return items.filter((item) => item.status === filter);
  }, [filter, items]);

  function colorByStatus(status: SnifferDomainItem["status"]): "amber" | "emerald" | "rose" | "zinc" {
    switch (status) {
      case "Proxy":
        return "amber";
      case "Direct":
        return "emerald";
      case "Block":
        return "rose";
      default:
        return "zinc";
    }
  }

  return (
    <div className="relative flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-950/80 p-3">
        <div className="min-w-0 flex-1 overflow-x-auto no-scrollbar">
          <div className="flex w-max items-center gap-2 pr-1">
            {FILTERS.map((item) => (
              <button
                key={item}
                onClick={() => setFilter(item)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${
                  filter === item
                    ? "bg-zinc-100 text-zinc-900"
                    : "border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {typeof tabId === "number" ? (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 whitespace-nowrap gap-1.5 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
            onClick={(event) => {
              event.currentTarget.blur();
              void onClearSniffer(tabId);
            }}
          >
            <Trash2 size={14} /> Очистить
          </Button>
        ) : null}
      </div>

      <div className="space-y-1 p-2">
        {filtered.map((req) => {
          const hasError = Boolean(req.error.trim());
          const testIdSuffix = toTestIdSuffix(req.id);

          return (
            <div key={req.id} className="relative cursor-default rounded-lg border border-zinc-900 p-2.5">
              <div className="flex items-center gap-3">
                {hasError ? (
                  <div
                    data-testid={`sniffer-error-indicator-${testIdSuffix}`}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-zinc-800 bg-zinc-950 text-rose-500"
                    title="Ошибка последнего запроса"
                    aria-label="Ошибка последнего запроса"
                  >
                    <CircleAlert size={14} />
                  </div>
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-zinc-800 bg-zinc-950 text-[10px] font-mono text-zinc-500">
                    {req.type.slice(0, 3).toUpperCase()}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-zinc-200">{req.domain}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
                    <span className="rounded bg-zinc-950 px-1">{req.method}</span>
                    <span>{req.durationMs}ms</span>
                    {req.statusCode ? <span>HTTP {req.statusCode}</span> : null}
                    <span>req: {req.requestCount}</span>
                  </div>
                </div>

                <Badge color={colorByStatus(req.status)}>{req.status}</Badge>

                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 w-8 border-zinc-700 px-0 text-zinc-200 hover:text-zinc-100"
                  onClick={() => {
                    onOpenQuick(req.domain || req.url);
                  }}
                  aria-label="Добавить правило"
                  title="Добавить правило"
                >
                  <span aria-hidden="true" className="text-[21px] font-semibold leading-none">
                    +
                  </span>
                </Button>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-zinc-500">Пока нет перехваченных запросов.</div>
        ) : null}
      </div>
    </div>
  );
}
