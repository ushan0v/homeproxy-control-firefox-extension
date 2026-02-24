import { LogOut } from "lucide-react";
import type { QuickActionConfig, RoutingRuleView } from "../../types/homeproxy";
import { routeClassLabel, routeClassToBadgeColor } from "../../lib/rule-utils";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

interface Props {
  rules: RoutingRuleView[];
  quickActions: QuickActionConfig[];
  onQuickActionsChange: (next: QuickActionConfig[]) => Promise<void>;
  onResetConnection: () => Promise<void>;
}

function upsertQuickAction(list: QuickActionConfig[], ruleId: string): QuickActionConfig[] {
  const existing = list.find((item) => item.ruleId === ruleId);
  if (existing) {
    return list.map((item) =>
      item.ruleId === ruleId
        ? {
            ...item,
            enabled: !item.enabled,
          }
        : item,
    );
  }

  return [...list, { ruleId, enabled: true }];
}

export function SettingsTab({
  rules,
  quickActions,
  onQuickActionsChange,
  onResetConnection,
}: Props) {
  function outboundLabel(rule: RoutingRuleView): string {
    const base = routeClassLabel(rule.outbound.class || "unknown");
    if (rule.outbound.class === "proxy" && rule.outbound.name) {
      return `${base}: ${rule.outbound.name}`;
    }
    return base;
  }

  async function toggleRule(ruleId: string) {
    await onQuickActionsChange(upsertQuickAction(quickActions, ruleId));
  }

  return (
    <div className="space-y-3 p-3 pb-4">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Быстрые действия</h2>
        <p className="mt-1 text-[11px] text-zinc-500">Выберите правила, доступные в Main и Sniffer.</p>

        <div className="mt-3 space-y-2">
          {rules.map((rule) => {
            const config = quickActions.find((item) => item.ruleId === rule.id);
            const enabled = Boolean(config?.enabled);
            const badgeColor = routeClassToBadgeColor(rule.outbound.class || "unknown");

            return (
              <div
                key={rule.id}
                className={`overflow-hidden rounded-xl border transition-colors ${
                  enabled ? "border-zinc-700 bg-zinc-900" : "border-zinc-800 bg-zinc-900"
                }`}
              >
                <div className="flex h-[37px] items-center gap-2 pl-2 pr-3">
                  <label
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                    onClick={(event) => event.stopPropagation()}
                    title={enabled ? "Исключить из быстрых действий" : "Добавить в быстрые действия"}
                  >
                    <input
                      data-testid={`settings-toggle-${rule.id}`}
                      type="checkbox"
                      checked={enabled}
                      onChange={() => {
                        void toggleRule(rule.id);
                      }}
                      className="h-3.5 w-3.5 accent-blue-500"
                    />
                  </label>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-zinc-100">{rule.name}</div>
                  </div>

                  <Badge color={badgeColor} className="shrink-0 whitespace-nowrap">
                    {outboundLabel(rule)}
                  </Badge>
                </div>
              </div>
            );
          })}
          {!rules.length ? (
            <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/60 px-3 py-3 text-xs text-zinc-500">
              Правила пока отсутствуют.
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Изменить адрес API сервера</h2>
        <p className="mt-1 text-[11px] text-zinc-500">Сбросит текущую сессию и откроет начальный экран подключения.</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 h-9 w-full justify-center gap-2 border-zinc-700 text-zinc-200"
          onClick={() => {
            void onResetConnection();
          }}
        >
          <LogOut size={14} /> Выйти
        </Button>
      </section>
    </div>
  );
}
