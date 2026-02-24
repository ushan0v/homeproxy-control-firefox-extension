import type { QuickActionConfig, StoredSettings } from "../types/homeproxy";
import { normalizeBaseUrlInput } from "./api";
import { storageLocalGet, storageLocalSet } from "./webext";

const SETTINGS_KEY = "homeproxy.settings";
const QUICK_ACTIONS_KEY = "homeproxy.quick_actions";

export interface QuickActionsLoadResult {
  actions: QuickActionConfig[];
  hasSavedConfig: boolean;
}

function normalizeQuickActions(list: unknown): QuickActionConfig[] {
  if (!Array.isArray(list)) return [];
  const out: QuickActionConfig[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<QuickActionConfig>;
    if (!record.ruleId || typeof record.ruleId !== "string") continue;

    out.push({
      ruleId: record.ruleId,
      enabled: Boolean(record.enabled),
    });
  }

  return out;
}

export async function loadSettings(): Promise<StoredSettings | null> {
  const raw = await storageLocalGet<StoredSettings>(SETTINGS_KEY);
  if (!raw || typeof raw !== "object") return null;
  if (!raw.baseUrl || typeof raw.baseUrl !== "string") return null;

  const normalizedBaseUrl = normalizeBaseUrlInput(raw.baseUrl);
  if (!normalizedBaseUrl) return null;

  const out: StoredSettings = {
    baseUrl: normalizedBaseUrl,
  };
  if (typeof raw.token === "string" && raw.token.trim()) {
    out.token = raw.token.trim();
  }
  return out;
}

export async function saveSettings(settings: StoredSettings): Promise<void> {
  const normalizedBaseUrl = normalizeBaseUrlInput(settings.baseUrl);
  if (!normalizedBaseUrl) {
    throw new Error("Invalid baseUrl");
  }

  const value: StoredSettings = {
    baseUrl: normalizedBaseUrl,
    token: settings.token?.trim() || undefined,
  };
  await storageLocalSet({ [SETTINGS_KEY]: value });
}

export async function clearSettings(): Promise<void> {
  await storageLocalSet({ [SETTINGS_KEY]: null });
}

export async function loadQuickActions(): Promise<QuickActionsLoadResult> {
  const value = await storageLocalGet<QuickActionConfig[]>(QUICK_ACTIONS_KEY);
  return {
    actions: normalizeQuickActions(value),
    hasSavedConfig: value !== undefined && value !== null,
  };
}

export async function saveQuickActions(config: QuickActionConfig[]): Promise<void> {
  await storageLocalSet({
    [QUICK_ACTIONS_KEY]: normalizeQuickActions(config),
  });
}
