import { useMemo, useState } from "react";
import { AlertCircle, ArrowRight, Globe, Plus, Search } from "lucide-react";
import type { CheckResult } from "../../types/homeproxy";
import { routeClassLabel, routeClassToBadgeColor } from "../../lib/rule-utils";
import { normalizeDomain } from "../../lib/domain";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

interface Props {
  currentDomain: string;
  currentCheck: CheckResult | null;
  loadingCurrentSite: boolean;
  onOpenQuick: (domain: string) => void;
}

export function DashboardTab({
  currentDomain,
  currentCheck,
  loadingCurrentSite,
  onOpenQuick,
}: Props) {
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState("");

  const statusLabel = useMemo(() => {
    if (!currentCheck) {
      return currentDomain ? "Unknown" : "";
    }
    const base = routeClassLabel(currentCheck.class);
    if (currentCheck.class === "proxy" && currentCheck.outbound) {
      return `${base}: ${currentCheck.outbound}`;
    }
    return base;
  }, [currentCheck, currentDomain]);

  const statusColor = loadingCurrentSite ? "zinc" : routeClassToBadgeColor(currentCheck?.class ?? "unknown");
  function openPickerFromInput() {
    const normalized = normalizeDomain(inputValue);
    if (!normalized) {
      setError("Некорректный URL или домен.");
      return;
    }
    setError("");
    onOpenQuick(normalized);
  }

  function openPickerFromCurrentSite() {
    if (!currentDomain) {
      setError("Не удалось определить домен активной вкладки.");
      return;
    }
    setError("");
    onOpenQuick(currentDomain);
  }

  const CARD_CLASS = "rounded-xl border border-zinc-800 bg-zinc-900 p-3";

  return (
    <div className="relative flex flex-col space-y-3 p-3 pb-4">
      <div className={CARD_CLASS}>
        <div className={`flex items-center gap-3 ${currentDomain ? "mb-3" : ""}`}>
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/90">
            {currentDomain ? (
              <img
                src={`https://www.google.com/s2/favicons?domain=${currentDomain}&sz=64`}
                alt="favicon"
                className="h-7 w-7 opacity-90"
              />
            ) : (
              <Globe className="text-zinc-600" size={20} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="-translate-y-px truncate text-sm font-semibold text-zinc-100">{currentDomain || "Нет активного окна"}</h2>
            {currentDomain ? (
              <div className="mt-0 -translate-y-[3px]">
                <Badge color={statusColor}>{loadingCurrentSite ? "Checking..." : statusLabel}</Badge>
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-zinc-500">Откройте сайт в активной вкладке браузера.</p>
            )}
          </div>
        </div>

        {currentDomain ? (
          <Button variant="secondary" size="sm" className="w-full gap-2 border-zinc-700 text-zinc-200" onClick={openPickerFromCurrentSite}>
            <Plus size={14} /> Добавить правило
          </Button>
        ) : null}
      </div>

      <div className={CARD_CLASS}>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Быстрое добавление</h3>
        <div className="grid grid-cols-[1fr_auto] items-start gap-2">
          <Input
            value={inputValue}
            onChange={(event) => {
              setInputValue(event.target.value);
              setError("");
            }}
            data-testid="dashboard-quick-input"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                openPickerFromInput();
              }
            }}
            placeholder="укажите домен или ссылку"
            icon={Search}
            className="w-full"
          />
          <Button
            variant="secondary"
            size="icon"
            data-testid="dashboard-quick-submit"
            className="h-9 w-9 border-zinc-700 text-zinc-100"
            onClick={openPickerFromInput}
            aria-label="Продолжить"
            title="Продолжить"
          >
            <ArrowRight size={16} />
          </Button>
        </div>
        {error ? (
          <p className="mt-2 flex items-center gap-1 text-xs text-rose-400">
            <AlertCircle size={12} /> {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
