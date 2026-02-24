function isIpv4Address(domain: string): boolean {
  const parts = domain.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const value = Number.parseInt(part, 10);
    return value >= 0 && value <= 255;
  });
}

export function normalizeDomain(input: string): string | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;

  if (!/^https?:\/\//.test(value)) {
    value = `https://${value}`;
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.trim().toLowerCase();
    if (!host || !host.includes(".")) return null;
    return host;
  } catch {
    return null;
  }
}

export function extractDomainFromUrl(rawUrl: string): string {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isSubdomain(domain: string): boolean {
  if (isIpv4Address(domain)) return false;
  const parts = domain.split(".").filter(Boolean);
  return parts.length > 2;
}

export function getRootDomain(domain: string): string {
  if (isIpv4Address(domain)) return domain;
  const parts = domain.split(".").filter(Boolean);
  if (parts.length <= 2) return domain;
  return parts.slice(-2).join(".");
}

export function uniqSorted(values: string[]): string[] {
  const unique = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  return unique.sort((a, b) => a.localeCompare(b));
}
