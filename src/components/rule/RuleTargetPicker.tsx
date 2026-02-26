import { useEffect, useMemo, useState } from "react";
import { CornerDownRight, Globe } from "lucide-react";
import { getRootDomain, isSubdomain, normalizeDomain } from "../../lib/domain";
import {
  routeClassLabel,
  routeClassToBadgeColor,
  type DomainScope,
  type RuleDomainMatchHint,
} from "../../lib/rule-utils";
import { Badge } from "../ui/Badge";

export interface RuleTargetOption {
  id: string;
  label: string;
  outboundClass?: "proxy" | "direct" | "block" | "unknown";
  outboundLabel?: string;
  matchHintsByScope?: {
    full: RuleDomainMatchHint[];
    root: RuleDomainMatchHint[];
  };
  testId?: string;
}

interface ProcessedDomain {
  full: string;
  root: string;
  isSubdomain: boolean;
}

interface Props {
  domain: string;
  options: RuleTargetOption[];
  onCancel: () => void;
  onSubmit: (ruleId: string, domain: string, scope: DomainScope) => Promise<void>;
  emptyMessage?: string;
  testIdPrefix?: string;
}

const EMPTY_DOMAIN: ProcessedDomain = {
  full: "",
  root: "",
  isSubdomain: false,
};

function resolveProcessedDomain(rawDomain: string): { processed: ProcessedDomain; valid: boolean } {
  const normalized = normalizeDomain(rawDomain);
  if (!normalized) {
    return { processed: EMPTY_DOMAIN, valid: false };
  }
  const root = getRootDomain(normalized);
  return {
    processed: {
      full: normalized,
      root,
      isSubdomain: isSubdomain(normalized),
    },
    valid: true,
  };
}

export function RuleTargetPicker({
  domain,
  options,
  onCancel,
  onSubmit,
  emptyMessage = "Нет включенных правил в Quick Actions.",
  testIdPrefix = "rule-picker",
}: Props) {
  const [selectedScope, setSelectedScope] = useState<DomainScope>("full");
  const [busyRuleId, setBusyRuleId] = useState("");
  const [error, setError] = useState("");
  const domainState = useMemo(() => resolveProcessedDomain(domain), [domain]);
  const invalidDomain = !domainState.valid;
  const processedDomain = domainState.processed;
  const selectedDomain = selectedScope === "full" ? processedDomain.full : processedDomain.root;

  useEffect(() => {
    setBusyRuleId("");
    setSelectedScope("full");
    setError("");
  }, [processedDomain.full]);

  const visibleOptions = useMemo(() => options, [options]);

  function selectScope(scope: DomainScope) {
    if (invalidDomain) return;
    if (scope === "root") {
      setSelectedScope("root");
      return;
    }
    setSelectedScope("full");
  }

  async function handleSelectRule(ruleId: string) {
    if (!selectedDomain) {
      setError("Не удалось определить домен.");
      return;
    }

    setBusyRuleId(ruleId);
    setError("");
    try {
      await onSubmit(ruleId, selectedDomain, selectedScope);
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить домен в буфер изменений.");
    } finally {
      setBusyRuleId("");
    }
  }

  return (
    <div className="m-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/95">
      <div className="border-b border-zinc-800 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-100">Быстрое правило</h2>
          <button
            onClick={onCancel}
            className="h-8 rounded-lg border border-zinc-700 px-3 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
          >
            Отмена
          </button>
        </div>
        <div className="mt-2 truncate rounded-lg border border-zinc-700 bg-zinc-800/70 px-2.5 py-2 font-mono text-[11px] text-zinc-300">
          {selectedDomain || processedDomain.full || domain}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {invalidDomain ? (
          <div className="space-y-3 rounded-lg border border-rose-500/30 bg-rose-950/20 p-3">
            <p className="text-xs text-rose-300">{error || "Некорректный URL или домен."}</p>
            <button
              onClick={onCancel}
              className="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 text-xs text-zinc-200"
            >
              Закрыть
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Тип правила</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  data-testid={`${testIdPrefix}-scope-full`}
                  onClick={() => selectScope("full")}
                  className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                    selectedScope === "full"
                      ? "border-blue-500/40 bg-blue-500/10"
                      : "border-zinc-700 bg-zinc-800/70 hover:border-zinc-500"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-400">
                      <CornerDownRight size={14} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-semibold text-zinc-100">{processedDomain.full}</div>
                      <div className="text-[10px] text-zinc-500">
                        {processedDomain.isSubdomain ? "Только поддомен" : "Только этот домен"}
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  data-testid={`${testIdPrefix}-scope-root`}
                  onClick={() => selectScope("root")}
                  className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                    selectedScope === "root"
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-zinc-700 bg-zinc-800/70 hover:border-zinc-500"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-400">
                      <Globe size={14} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-semibold text-zinc-100">*.{processedDomain.root}</div>
                      <div className="text-[10px] text-zinc-500">Домен и поддомены</div>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Выберите правило</p>
              {visibleOptions.map((option) => {
                const outboundClass = option.outboundClass || "unknown";
                const outboundLabel = option.outboundLabel || routeClassLabel(outboundClass);
                const hintsByScope = option.matchHintsByScope ?? { full: [], root: [] };
                const hints = selectedScope === "root" ? hintsByScope.root : hintsByScope.full;
                const hasHints = hints.length > 0;
                const visibleHints = hints.slice(0, 2);
                const hiddenHints = Math.max(0, hints.length - visibleHints.length);

                return (
                  <div
                    key={option.id}
                    className="overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 hover:border-zinc-500"
                  >
                    <button
                      onClick={() => {
                        void handleSelectRule(option.id);
                      }}
                      data-testid={option.testId}
                      className={`w-full px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60 ${
                        hasHints ? "border-b border-zinc-700 bg-zinc-800" : "bg-zinc-800"
                      }`}
                      disabled={busyRuleId === option.id}
                    >
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">
                          {busyRuleId === option.id ? "Добавление..." : option.label}
                        </div>
                        <Badge color={routeClassToBadgeColor(outboundClass)} className="shrink-0 whitespace-nowrap">
                          {outboundLabel}
                        </Badge>
                      </div>
                    </button>

                    {hasHints ? (
                      <div
                        className="bg-zinc-900 px-2.5 py-1.5"
                        data-testid={option.testId ? `${option.testId}-matches` : undefined}
                      >
                        <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-500">Совпадение</div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {visibleHints.map((hint) => (
                            <span
                              key={`${option.id}:${hint.key}:${hint.value}`}
                              className="inline-flex max-w-full items-center rounded-md border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] leading-none text-zinc-300"
                              title={`${hint.label}: ${hint.value}`}
                            >
                              <span className="truncate">
                                <span className="text-zinc-500">{hint.label}:</span> {hint.value}
                              </span>
                            </span>
                          ))}
                          {hiddenHints ? (
                            <span className="rounded-md border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] leading-none text-zinc-500">
                              +{hiddenHints}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {!visibleOptions.length ? (
                <div className="rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-center text-xs text-zinc-500">
                  {emptyMessage}
                </div>
              ) : null}
            </div>

            {error ? (
              <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">
                {error}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
