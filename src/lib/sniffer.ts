import type { CheckResult, SnifferActiveResponse, SnifferDomainItem, SnifferItem } from "../types/homeproxy";
import { extractDomainFromUrl } from "./domain";
import { checkToSnifferStatus } from "./rule-utils";
import { runtimeSendMessage } from "./webext";

interface MutableSnifferDomainItem {
  id: string;
  domain: string;
  url: string;
  method: string;
  type: string;
  statusCode: number;
  durationMs: number;
  timestamp: number;
  requestCount: number;
  error: string;
}

function domainFromSnifferItem(item: SnifferItem): string {
  const domain = (item.domain || extractDomainFromUrl(item.url)).trim().toLowerCase();
  return domain;
}

function errorFromSnifferItem(item: SnifferItem): string {
  return (item.error || "").trim();
}

function toCheckMap(checks: CheckResult[]): Map<string, CheckResult> {
  const map = new Map<string, CheckResult>();
  for (const check of checks) {
    const key = (check.normalized || check.input || "").trim().toLowerCase();
    if (!key) continue;
    map.set(key, check);
  }
  return map;
}

export function collectSnifferDomains(items: SnifferItem[]): string[] {
  const domains = new Set<string>();
  for (const item of items) {
    const domain = domainFromSnifferItem(item);
    if (!domain) continue;
    domains.add(domain);
  }
  return [...domains];
}

export function buildSnifferDomainItems(items: SnifferItem[], checks: CheckResult[]): SnifferDomainItem[] {
  const byDomain = new Map<string, MutableSnifferDomainItem>();

  for (const item of items) {
    const domain = domainFromSnifferItem(item);
    if (!domain) continue;

    const known = byDomain.get(domain);
    const timestamp = Number.isFinite(item.timestamp) ? item.timestamp : Date.now();

    if (!known) {
      const statusCode = item.statusCode || 0;
      byDomain.set(domain, {
        id: domain,
        domain,
        url: item.url,
        method: item.method || "GET",
        type: item.type || "other",
        statusCode,
        durationMs: item.durationMs || 0,
        timestamp,
        requestCount: 1,
        error: errorFromSnifferItem(item),
      });
      continue;
    }

    known.requestCount += 1;

    if (timestamp >= known.timestamp) {
      known.timestamp = timestamp;
      known.url = item.url;
      known.method = item.method || known.method;
      known.type = item.type || known.type;
      known.statusCode = item.statusCode || 0;
      known.durationMs = item.durationMs || 0;
      known.error = errorFromSnifferItem(item);
    }
  }

  const checkMap = toCheckMap(checks);
  const resolved: SnifferDomainItem[] = [];

  for (const entry of byDomain.values()) {
    const check = checkMap.get(entry.domain);
    const status = check ? checkToSnifferStatus(check) : "Unknown";

    resolved.push({
      id: entry.id,
      domain: entry.domain,
      url: entry.url,
      method: entry.method,
      type: entry.type,
      status,
      outbound: check?.outbound,
      statusCode: entry.statusCode,
      durationMs: entry.durationMs,
      timestamp: entry.timestamp,
      requestCount: entry.requestCount,
      error: entry.error,
    });
  }

  resolved.sort((a, b) => b.timestamp - a.timestamp);
  return resolved;
}

export async function fetchActiveSnifferData(): Promise<SnifferActiveResponse> {
  const response = (await runtimeSendMessage<SnifferActiveResponse>({
    type: "sniffer:get-active",
  })) as SnifferActiveResponse;

  if (!response || typeof response !== "object") {
    return {
      ok: false,
      tabId: null,
      url: "",
      items: [],
      error: "Invalid response from background",
    };
  }

  return response;
}

export async function clearSnifferTab(tabId: number): Promise<void> {
  await runtimeSendMessage({ type: "sniffer:clear-tab", tabId });
}
