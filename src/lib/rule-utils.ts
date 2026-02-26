import type {
  CheckResult,
  RouteClass,
  RoutingRuleView,
  RulesUpdateConfig,
  SnifferPrimaryStatus,
} from "../types/homeproxy";
import { getRootDomain, isSubdomain, normalizeDomain, uniqSorted } from "./domain";

export type DomainScope = "full" | "root";
export type RuleDomainMatchKey = "domain" | "domainSuffix" | "domainKeyword" | "domainRegex" | "ruleSet";

export interface RuleDomainMatchHint {
  key: RuleDomainMatchKey;
  label: string;
  value: string;
}

const RULE_DOMAIN_MATCH_LABELS: Record<RuleDomainMatchKey, string> = {
  domain: "Домен",
  domainSuffix: "Домен и поддомен",
  domainKeyword: "Ключевое слово",
  domainRegex: "Регулярное выражение",
  ruleSet: "Rule Set",
};

const RULE_DOMAIN_MATCH_ORDER: RuleDomainMatchKey[] = ["domain", "domainSuffix", "ruleSet", "domainKeyword", "domainRegex"];

function normalizeRuleValue(value: string): string {
  return value.trim().toLowerCase();
}

function matchesSuffix(domain: string, suffix: string): boolean {
  return domain === suffix || domain.endsWith(`.${suffix}`);
}

function matchesDomainRegex(domain: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(domain);
  } catch {
    return false;
  }
}

function uniqueOrderedHints(hints: RuleDomainMatchHint[]): RuleDomainMatchHint[] {
  const seen = new Set<string>();
  const ordered = [...hints].sort((left, right) => {
    const leftIndex = RULE_DOMAIN_MATCH_ORDER.indexOf(left.key);
    const rightIndex = RULE_DOMAIN_MATCH_ORDER.indexOf(right.key);
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.value.localeCompare(right.value);
  });
  const result: RuleDomainMatchHint[] = [];

  for (const hint of ordered) {
    const token = `${hint.key}:${hint.value.toLowerCase()}`;
    if (seen.has(token)) continue;
    seen.add(token);
    result.push(hint);
  }

  return result;
}

export function findRuleByCheckResult(check: CheckResult | null, rules: RoutingRuleView[]): RoutingRuleView | null {
  if (!check) return null;

  const ruleName = check.ruleName?.trim() || "";
  if (ruleName) {
    const direct = rules.find((rule) => rule.name === ruleName || rule.id === ruleName || rule.tag === ruleName);
    if (direct) return direct;

    const normalized = ruleName.toLowerCase();
    const caseInsensitive = rules.find((rule) => {
      const name = rule.name.trim().toLowerCase();
      const id = rule.id.trim().toLowerCase();
      const tag = rule.tag.trim().toLowerCase();
      return name === normalized || id === normalized || tag === normalized;
    });
    if (caseInsensitive) return caseInsensitive;
  }

  if (check.ruleIndex >= 0) {
    const byIndex = rules[check.ruleIndex];
    if (byIndex) return byIndex;
  }

  return null;
}

export function detectRuleMatchKeyFromExpr(ruleExpr?: string): RuleDomainMatchKey | null {
  const expr = String(ruleExpr || "")
    .trim()
    .toLowerCase();
  if (!expr) return null;
  if (expr.includes("rule_set") || expr.includes("ruleset")) return "ruleSet";
  if (expr.includes("domain_suffix")) return "domainSuffix";
  if (expr.includes("domain_keyword")) return "domainKeyword";
  if (expr.includes("domain_regex")) return "domainRegex";
  if (expr === "domain" || expr.includes("domain")) return "domain";
  return null;
}

export function filterHintsByMatchKey(hints: RuleDomainMatchHint[], preferredKey: RuleDomainMatchKey | null): RuleDomainMatchHint[] {
  if (!preferredKey) {
    return hints;
  }
  const filtered = hints.filter((hint) => hint.key === preferredKey);
  return filtered.length ? filtered : hints;
}

export function collectRuleDomainMatchHints(
  rule: RoutingRuleView,
  rawDomain: string,
  matchedRuleSetKeys: ReadonlySet<string> = new Set<string>(),
): RuleDomainMatchHint[] {
  const domain = normalizeDomain(rawDomain);
  if (!domain) {
    return [];
  }

  const hints: RuleDomainMatchHint[] = [];
  const appendHint = (key: RuleDomainMatchKey, value: string) => {
    const clean = String(value || "").trim();
    if (!clean) return;
    hints.push({
      key,
      label: RULE_DOMAIN_MATCH_LABELS[key],
      value: clean,
    });
  };

  for (const value of rule.hostIp.domain) {
    const normalized = normalizeRuleValue(value);
    if (!normalized) continue;
    if (normalized === domain) {
      appendHint("domain", normalized);
    }
  }

  for (const value of rule.hostIp.domainSuffix) {
    const normalized = normalizeRuleValue(value);
    if (!normalized) continue;
    if (matchesSuffix(domain, normalized)) {
      appendHint("domainSuffix", normalized);
    }
  }

  for (const value of rule.hostIp.domainKeyword) {
    const normalized = normalizeRuleValue(value);
    if (!normalized) continue;
    if (domain.includes(normalized)) {
      appendHint("domainKeyword", normalized);
    }
  }

  for (const value of rule.hostIp.domainRegex) {
    const pattern = String(value || "").trim();
    if (!pattern) continue;
    if (matchesDomainRegex(domain, pattern)) {
      appendHint("domainRegex", pattern);
    }
  }

  if (matchedRuleSetKeys.size) {
    for (const item of rule.ruleSet) {
      const id = String(item.id || "").trim();
      const tag = String(item.tag || "").trim();
      if (!id && !tag) continue;
      if (matchedRuleSetKeys.has(id) || matchedRuleSetKeys.has(tag)) {
        appendHint("ruleSet", item.name || id || tag);
      }
    }
  }

  return uniqueOrderedHints(hints);
}

export function toRuleUpdateConfig(rule: RoutingRuleView): RulesUpdateConfig {
  return {
    ruleSet: rule.ruleSet.map((item) => item.id),
    domain: [...rule.hostIp.domain],
    domainSuffix: [...rule.hostIp.domainSuffix],
    domainKeyword: [...rule.hostIp.domainKeyword],
    domainRegex: [...rule.hostIp.domainRegex],
    ipCidr: [...rule.hostIp.ipCidr],
    sourceIpCidr: [...rule.hostIp.sourceIpCidr],
    sourcePort: [...rule.port.sourcePort],
    sourcePortRange: [...rule.port.sourcePortRange],
    port: [...rule.port.port],
    portRange: [...rule.port.portRange],
  };
}

export function hasRuleChanged(base: RoutingRuleView, draft: RoutingRuleView): boolean {
  return JSON.stringify(toRuleUpdateConfig(base)) !== JSON.stringify(toRuleUpdateConfig(draft));
}

export function addDomainToRule(rule: RoutingRuleView, rawDomain: string, scope: DomainScope): RoutingRuleView {
  const domain = rawDomain.trim().toLowerCase();
  if (!domain) return rule;

  const next: RoutingRuleView = {
    ...rule,
    hostIp: {
      ...rule.hostIp,
      domain: [...rule.hostIp.domain],
      domainSuffix: [...rule.hostIp.domainSuffix],
    },
  };

  if (scope === "full") {
    next.hostIp.domain = uniqSorted([...next.hostIp.domain, domain]);
    return next;
  }

  const suffix = isSubdomain(domain) ? getRootDomain(domain) : domain;
  next.hostIp.domainSuffix = uniqSorted([...next.hostIp.domainSuffix, suffix]);
  return next;
}

export function removeHostEntry(
  rule: RoutingRuleView,
  field: "domain" | "domainSuffix",
  value: string,
): RoutingRuleView {
  const next: RoutingRuleView = {
    ...rule,
    hostIp: {
      ...rule.hostIp,
      domain: [...rule.hostIp.domain],
      domainSuffix: [...rule.hostIp.domainSuffix],
    },
  };

  if (field === "domain") {
    next.hostIp.domain = next.hostIp.domain.filter((item) => item !== value);
  } else {
    next.hostIp.domainSuffix = next.hostIp.domainSuffix.filter((item) => item !== value);
  }
  return next;
}

export function routeClassLabel(routeClass: RouteClass | string): string {
  switch (routeClass) {
    case "proxy":
      return "Proxy";
    case "direct":
      return "Direct";
    case "block":
      return "Block";
    default:
      return "Unknown";
  }
}

export function routeClassToBadgeColor(routeClass: RouteClass | string): "amber" | "emerald" | "rose" | "zinc" {
  switch (routeClass) {
    case "proxy":
      return "amber";
    case "direct":
      return "emerald";
    case "block":
      return "rose";
    default:
      return "zinc";
  }
}

export function checkToSnifferStatus(check: CheckResult): SnifferPrimaryStatus {
  switch (check.class) {
    case "proxy":
      return "Proxy";
    case "direct":
      return "Direct";
    case "block":
      return "Block";
    default:
      return "Unknown";
  }
}
