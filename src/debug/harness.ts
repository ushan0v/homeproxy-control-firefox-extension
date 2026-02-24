import type { SnifferItem } from "../types/homeproxy";

interface ApiProxyPayload {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface RuntimeMessage {
  type?: string;
  payload?: Record<string, unknown>;
  tabId?: number;
  taskId?: string;
}

interface HarnessState {
  activeTabUrl: string;
  snifferItems: SnifferItem[];
}

interface HarnessController {
  clearSniffer: () => void;
  getState: () => HarnessState;
  pushSnifferItem: (item: Partial<SnifferItem>) => SnifferItem;
  setActiveTabUrl: (url: string) => void;
}

interface HarnessStorageLocal {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
}

interface HarnessTabs {
  query: () => Promise<Array<{ id: number; url: string }>>;
}

interface HarnessRuntime {
  id: string;
  sendMessage: (message: RuntimeMessage) => Promise<unknown>;
}

interface HarnessPermissions {
  contains: () => Promise<boolean>;
  request: () => Promise<boolean>;
}

interface HarnessExtensionApi {
  storage: {
    local: HarnessStorageLocal;
  };
  tabs: HarnessTabs;
  runtime: HarnessRuntime;
  permissions: HarnessPermissions;
}

declare global {
  interface Window {
    __HOMEPROXY_HARNESS__?: HarnessController;
  }
}

type HarnessServiceToggleAction = "start" | "stop";
type HarnessServiceToggleState = "pending" | "success" | "error";

interface HarnessServiceToggleTask {
  id: string;
  state: HarnessServiceToggleState;
  action: HarnessServiceToggleAction;
  startedAt: number;
  finishedAt?: number;
  running?: boolean;
  error: string;
}

const HARNESS_QUERY_PARAM = "harness";
const HARNESS_ACTIVE_URL_PARAM = "tabUrl";
const HARNESS_TAB_ID = 1;
const MAX_SNIFFER_ITEMS = 5000;
const DEFAULT_ACTIVE_TAB_URL = "https://youtube.com/watch?v=homeproxy";
const SERVICE_TOGGLE_PENDING_TIMEOUT_MS = 45000;

function parseDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}

function nowMs(): number {
  return Date.now();
}

function normalizeSnifferItem(input: Partial<SnifferItem>, tabId: number): SnifferItem {
  const resolvedUrl = typeof input.url === "string" && input.url ? input.url : "https://example.com";
  const resolvedTimestamp = Number.isFinite(input.timestamp) ? Number(input.timestamp) : nowMs();

  return {
    id: typeof input.id === "string" && input.id ? input.id : `${resolvedTimestamp}-${Math.random().toString(36).slice(2)}`,
    tabId: Number.isFinite(input.tabId) ? Number(input.tabId) : tabId,
    url: resolvedUrl,
    domain: typeof input.domain === "string" && input.domain ? input.domain : parseDomain(resolvedUrl),
    method: typeof input.method === "string" && input.method ? input.method : "GET",
    type: typeof input.type === "string" && input.type ? input.type : "xmlhttprequest",
    status: typeof input.status === "string" && input.status ? input.status : "Unknown",
    statusCode: Number.isFinite(input.statusCode) ? Number(input.statusCode) : 200,
    durationMs: Number.isFinite(input.durationMs) ? Number(input.durationMs) : 12,
    timestamp: resolvedTimestamp,
    error: typeof input.error === "string" ? input.error : "",
  };
}

function shouldEnableHarness(): boolean {
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get(HARNESS_QUERY_PARAM) || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

function extractActiveUrlFromQuery(): string {
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get(HARNESS_ACTIVE_URL_PARAM) || "").trim();
  if (!raw) return DEFAULT_ACTIVE_TAB_URL;
  try {
    return new URL(raw).toString();
  } catch {
    return DEFAULT_ACTIVE_TAB_URL;
  }
}

function toHeaders(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key || value == null) continue;
    out[String(key)] = String(value);
  }
  return out;
}

async function proxyApiRequest(payload: ApiProxyPayload): Promise<{
  body?: string;
  error?: string;
  ok: boolean;
  status: number;
}> {
  const url = typeof payload?.url === "string" ? payload.url : "";
  if (!url) {
    return {
      ok: false,
      status: 0,
      error: "missing url",
    };
  }

  const method = typeof payload?.method === "string" && payload.method ? payload.method : "GET";
  const headers = toHeaders(payload?.headers);
  const body = typeof payload?.body === "string" ? payload.body : undefined;

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      cache: "no-store",
      credentials: "omit",
    });
    return {
      ok: true,
      status: response.status,
      body: await response.text(),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function setupDebugHarnessIfNeeded(): void {
  if (!shouldEnableHarness()) return;
  if (window.__HOMEPROXY_HARNESS__) return;

  const state: HarnessState = {
    activeTabUrl: extractActiveUrlFromQuery(),
    snifferItems: [],
  };
  const storage = new Map<string, unknown>();
  let serviceToggleTask: HarnessServiceToggleTask | null = null;
  let serviceToggleSerial = 0;

  const resolveStaleServiceToggleTask = () => {
    if (!serviceToggleTask || serviceToggleTask.state !== "pending") return;
    const startedAt = Number(serviceToggleTask.startedAt || 0);
    if (!Number.isFinite(startedAt)) return;
    if (nowMs() - startedAt <= SERVICE_TOGGLE_PENDING_TIMEOUT_MS) return;
    serviceToggleTask = {
      ...serviceToggleTask,
      state: "error",
      finishedAt: nowMs(),
      error: "Операция прервана. Повторите действие.",
    };
  };

  const runServiceToggleTask = async (taskId: string, payload: Record<string, unknown>) => {
    const baseUrl = String(payload?.baseUrl || "").replace(/\/+$/, "");
    const action: HarnessServiceToggleAction = payload?.action === "stop" ? "stop" : "start";
    const token = typeof payload?.token === "string" ? payload.token.trim() : "";

    if (!baseUrl) {
      if (serviceToggleTask?.id !== taskId) return;
      serviceToggleTask = {
        ...serviceToggleTask,
        state: "error",
        finishedAt: nowMs(),
        error: "missing baseUrl",
      };
      return;
    }

    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers["X-Access-Token"] = token;
    }

    const result = await proxyApiRequest({
      url: `${baseUrl}/homeproxy/${action}`,
      method: "POST",
      headers,
    });

    if (serviceToggleTask?.id !== taskId) return;

    if (!result.ok) {
      serviceToggleTask = {
        ...serviceToggleTask,
        state: "error",
        finishedAt: nowMs(),
        error: result.error || "service toggle request failed",
      };
      return;
    }

    const status = Number(result.status || 0);
    const bodyText = typeof result.body === "string" ? result.body : "";
    if (status < 200 || status >= 300) {
      serviceToggleTask = {
        ...serviceToggleTask,
        state: "error",
        finishedAt: nowMs(),
        error: bodyText.trim() || `HTTP ${status}`,
      };
      return;
    }

    let running = action === "start";
    if (bodyText.trim()) {
      try {
        const parsed = JSON.parse(bodyText) as { running?: boolean };
        if (typeof parsed.running === "boolean") {
          running = parsed.running;
        }
      } catch {
        // keep fallback running flag
      }
    }

    serviceToggleTask = {
      ...serviceToggleTask,
      state: "success",
      finishedAt: nowMs(),
      running,
      error: "",
    };
  };

  const controller: HarnessController = {
    setActiveTabUrl(url) {
      const trimmed = url.trim();
      if (!trimmed) return;
      try {
        state.activeTabUrl = new URL(trimmed).toString();
      } catch {
        // Ignore invalid URL to keep predictable tab state.
      }
    },
    pushSnifferItem(item) {
      const normalized = normalizeSnifferItem(item, HARNESS_TAB_ID);
      state.snifferItems.push(normalized);
      if (state.snifferItems.length > MAX_SNIFFER_ITEMS) {
        state.snifferItems.splice(0, state.snifferItems.length - MAX_SNIFFER_ITEMS);
      }
      return normalized;
    },
    clearSniffer() {
      state.snifferItems = [];
    },
    getState() {
      return {
        activeTabUrl: state.activeTabUrl,
        snifferItems: [...state.snifferItems],
      };
    },
  };

  const extensionApi: HarnessExtensionApi = {
    storage: {
      local: {
        async get(key: string): Promise<Record<string, unknown>> {
          return { [key]: storage.get(key) };
        },
        async set(values: Record<string, unknown>): Promise<void> {
          for (const [key, value] of Object.entries(values)) {
            storage.set(key, value);
          }
        },
      },
    },
    tabs: {
      async query(): Promise<Array<{ id: number; url: string }>> {
        return [{ id: HARNESS_TAB_ID, url: state.activeTabUrl }];
      },
    },
    runtime: {
      id: "homeproxy-control-harness",
      async sendMessage(message: RuntimeMessage): Promise<unknown> {
        const type = message?.type;

        if (type === "api:request") {
          return proxyApiRequest((message.payload ?? {}) as ApiProxyPayload);
        }

        if (type === "sniffer:get-active") {
          return {
            ok: true,
            tabId: HARNESS_TAB_ID,
            url: state.activeTabUrl,
            items: [...state.snifferItems],
          };
        }

        if (type === "sniffer:clear-tab") {
          const tabId = Number.isFinite(message.tabId) ? Number(message.tabId) : HARNESS_TAB_ID;
          if (tabId === HARNESS_TAB_ID) {
            controller.clearSniffer();
          }
          return { ok: true };
        }

        if (type === "service:toggle:start") {
          resolveStaleServiceToggleTask();
          if (serviceToggleTask?.state === "pending") {
            return { ok: true, task: serviceToggleTask };
          }
          const payload = (message.payload ?? {}) as Record<string, unknown>;
          const action: HarnessServiceToggleAction = payload?.action === "stop" ? "stop" : "start";
          serviceToggleSerial += 1;
          const task: HarnessServiceToggleTask = {
            id: `${Date.now()}-${serviceToggleSerial}`,
            state: "pending",
            action,
            startedAt: nowMs(),
            error: "",
          };
          serviceToggleTask = task;
          runServiceToggleTask(task.id, payload).catch((error) => {
            if (serviceToggleTask?.id !== task.id) return;
            serviceToggleTask = {
              ...serviceToggleTask,
              state: "error",
              finishedAt: nowMs(),
              error: String(error),
            };
          });
          return { ok: true, task };
        }

        if (type === "service:toggle:get") {
          resolveStaleServiceToggleTask();
          return {
            ok: true,
            task: serviceToggleTask,
          };
        }

        if (type === "service:toggle:ack") {
          if (!serviceToggleTask || serviceToggleTask.state === "pending") {
            return { ok: true, task: serviceToggleTask };
          }
          if (typeof message.taskId === "string" && message.taskId && message.taskId !== serviceToggleTask.id) {
            return { ok: true, task: serviceToggleTask };
          }
          serviceToggleTask = null;
          return { ok: true, task: null };
        }

        return { ok: true };
      },
    },
    permissions: {
      async contains(): Promise<boolean> {
        return true;
      },
      async request(): Promise<boolean> {
        return true;
      },
    },
  };

  const globals = globalThis as Record<string, unknown>;

  if (!globals.browser) {
    globals.browser = extensionApi;
  }
  if (!globals.chrome) {
    globals.chrome = extensionApi;
  }

  window.__HOMEPROXY_HARNESS__ = controller;
}
