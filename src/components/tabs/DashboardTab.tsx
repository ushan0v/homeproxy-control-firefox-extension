import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, Globe, List, Plus, Search } from "lucide-react";
import type { CheckResult } from "../../types/homeproxy";
import { routeClassLabel, routeClassToBadgeColor, type RuleDomainMatchHint } from "../../lib/rule-utils";
import { normalizeDomain } from "../../lib/domain";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

interface DashboardRuleMatch {
  id: string;
  name: string;
  hints: RuleDomainMatchHint[];
  isActive: boolean;
}

interface Props {
  currentDomain: string;
  currentCheck: CheckResult | null;
  currentRuleMatches: DashboardRuleMatch[];
  loadingCurrentSite: boolean;
  quickMode: boolean;
  onOpenQuick: (domain: string) => void;
}

export function DashboardTab({
  currentDomain,
  currentCheck,
  currentRuleMatches,
  loadingCurrentSite,
  quickMode,
  onOpenQuick,
}: Props) {
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (quickMode) return;
    const timer = window.setTimeout(() => {
      setInputValue("");
      setError("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [quickMode]);

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
    setInputValue("");
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
          <>
            <Button variant="secondary" size="sm" className="w-full gap-2 border-zinc-700 text-zinc-200" onClick={openPickerFromCurrentSite}>
              <Plus size={14} /> Добавить правило
            </Button>
            {currentRuleMatches.length ? (
              <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Совпадение</p>
                <div className="mt-1 max-h-40 space-y-1.5 overflow-y-auto pr-0.5 no-scrollbar">
                  {currentRuleMatches.map((match) => {
                    const visibleHints = match.hints.slice(0, 2);
                    const hiddenHints = Math.max(0, match.hints.length - visibleHints.length);
                    return (
                      <div
                        key={match.id}
                        className={`rounded-md border px-2 py-1.5 ${
                          match.isActive ? "border-blue-500/35 bg-blue-500/5" : "border-zinc-800 bg-zinc-900/70"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <List size={11} className={match.isActive ? "text-blue-400" : "text-zinc-500"} />
                          <p className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-tight text-zinc-100" title={match.name}>
                            {match.name || "Без названия"}
                          </p>
                          {match.isActive ? (
                            <Badge color="blue" className="shrink-0 px-1.5 py-0 text-[9px]">
                              Текущее
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 space-y-0.5">
                          {visibleHints.map((hint) => (
                            <p
                              key={`${match.id}:${hint.key}:${hint.value}`}
                              className="truncate text-[10px] leading-tight text-zinc-300"
                              title={`${hint.label}: ${hint.value}`}
                            >
                              <span className="text-zinc-500">{hint.label}:</span> {hint.value}
                            </p>
                          ))}
                          {hiddenHints ? <p className="text-[10px] leading-tight text-zinc-500">+{hiddenHints} ещё</p> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </>
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
