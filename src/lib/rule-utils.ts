import type {
  CheckResult,
  RouteClass,
  RoutingRuleView,
  RulesUpdateConfig,
  SnifferPrimaryStatus,
} from "../types/homeproxy";
import { getRootDomain, isSubdomain, uniqSorted } from "./domain";

export type DomainScope = "full" | "root";

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
