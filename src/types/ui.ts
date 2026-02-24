import type { QuickActionConfig, RoutingRuleView } from "./homeproxy";

export type AppTab = "dashboard" | "sniffer" | "rules" | "settings";

export interface ResolvedQuickAction {
  config: QuickActionConfig;
  rule: RoutingRuleView;
}
