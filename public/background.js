const ext = typeof browser !== "undefined" ? browser : chrome;
const hasBrowserNamespace = typeof browser !== "undefined";
const MAX_BUFFER_PER_TAB = 5000;
const STORAGE_KEY = "snifferBuffers";
const SERVICE_TOGGLE_STORAGE_KEY = "serviceToggleTask";
const SERVICE_TOGGLE_PENDING_TIMEOUT_MS = 45000;

const tabBuffers = new Map();
const pendingRequests = new Map();
let flushTimer = null;
let serviceToggleTask = null;
let serviceToggleTaskSerial = 0;

function parseDomain(rawUrl) {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl);
    return url.hostname;
  } catch (_err) {
    return "";
  }
}

function getTabBuffer(tabId) {
  if (!tabBuffers.has(tabId)) {
    tabBuffers.set(tabId, []);
  }
  return tabBuffers.get(tabId);
}

function schedulePersist() {
  if (!ext.storage?.session) return;
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    const obj = Object.create(null);
    for (const [tabId, items] of tabBuffers.entries()) {
      obj[String(tabId)] = items;
    }
    try {
      await ext.storage.session.set({ [STORAGE_KEY]: obj });
    } catch (_err) {
      // Ignore write errors to avoid breaking request capture.
    }
  }, 350);
}

async function hydrateBuffers() {
  if (!ext.storage?.session) return;
  try {
    const stored = await ext.storage.session.get(STORAGE_KEY);
    const raw = stored?.[STORAGE_KEY] ?? {};
    for (const [key, items] of Object.entries(raw)) {
      const tabId = Number.parseInt(key, 10);
      if (Number.isNaN(tabId) || !Array.isArray(items)) continue;
      tabBuffers.set(tabId, items);
    }
  } catch (_err) {
    // Ignore malformed or unavailable session storage.
  }
}

function normalizeServiceToggleTask(raw) {
  if (!raw || typeof raw !== "object") return null;
  const record = raw;
  const state = record.state === "pending" || record.state === "success" || record.state === "error" ? record.state : null;
  const action = record.action === "start" || record.action === "stop" ? record.action : null;
  const id = typeof record.id === "string" && record.id ? record.id : "";
  const startedAt = Number.isFinite(record.startedAt) ? Number(record.startedAt) : Date.now();
  const finishedAt = Number.isFinite(record.finishedAt) ? Number(record.finishedAt) : undefined;
  const running = typeof record.running === "boolean" ? record.running : undefined;
  const error = typeof record.error === "string" ? record.error : "";

  if (!state || !action || !id) return null;

  return {
    id,
    state,
    action,
    startedAt,
    finishedAt,
    running,
    error,
  };
}

async function persistServiceToggleTask() {
  if (!ext.storage?.session) return;
  try {
    await ext.storage.session.set({ [SERVICE_TOGGLE_STORAGE_KEY]: serviceToggleTask });
  } catch (_err) {
    // Ignore write errors to keep service toggle robust.
  }
}

async function hydrateServiceToggleTask() {
  if (!ext.storage?.session) return;
  try {
    const stored = await ext.storage.session.get(SERVICE_TOGGLE_STORAGE_KEY);
    serviceToggleTask = normalizeServiceToggleTask(stored?.[SERVICE_TOGGLE_STORAGE_KEY]);
    if (!serviceToggleTask) return;
    const suffix = Number.parseInt(String(serviceToggleTask.id).split("-")[1] || "", 10);
    if (Number.isFinite(suffix) && suffix > serviceToggleTaskSerial) {
      serviceToggleTaskSerial = suffix;
    }
  } catch (_err) {
    // Ignore malformed or unavailable session storage.
  }
}

function trimTrailingSlash(input) {
  return String(input || "").replace(/\/+$/, "");
}

function parseServiceActionResponse(bodyText, action) {
  const fallbackRunning = action === "start";
  if (!bodyText || !bodyText.trim()) {
    return { running: fallbackRunning, error: "" };
  }
  try {
    const parsed = JSON.parse(bodyText);
    if (typeof parsed?.running === "boolean") {
      return { running: parsed.running, error: "" };
    }
    return { running: fallbackRunning, error: "" };
  } catch {
    return { running: fallbackRunning, error: "" };
  }
}

async function runServiceToggleTask(taskId, payload) {
  const baseUrl = trimTrailingSlash(payload?.baseUrl || "");
  const action = payload?.action === "stop" ? "stop" : "start";
  const token = typeof payload?.token === "string" ? payload.token.trim() : "";

  if (!baseUrl) {
    if (serviceToggleTask?.id === taskId) {
      serviceToggleTask = {
        ...serviceToggleTask,
        state: "error",
        finishedAt: Date.now(),
        error: "missing baseUrl",
      };
      await persistServiceToggleTask();
    }
    return;
  }

  const headers = {};
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

  const now = Date.now();
  if (!result?.ok) {
    serviceToggleTask = {
      ...serviceToggleTask,
      state: "error",
      finishedAt: now,
      error: result?.error || "service toggle request failed",
    };
    await persistServiceToggleTask();
    return;
  }

  const status = Number(result?.status || 0);
  const bodyText = typeof result?.body === "string" ? result.body : "";
  if (status < 200 || status >= 300) {
    const bodyMessage = bodyText.trim();
    serviceToggleTask = {
      ...serviceToggleTask,
      state: "error",
      finishedAt: now,
      error: bodyMessage || `HTTP ${status || 0}`,
    };
    await persistServiceToggleTask();
    return;
  }

  const parsed = parseServiceActionResponse(bodyText, action);
  serviceToggleTask = {
    ...serviceToggleTask,
    state: "success",
    finishedAt: now,
    running: parsed.running,
    error: "",
  };
  await persistServiceToggleTask();
}

function resolveStaleServiceToggleTask() {
  if (!serviceToggleTask || serviceToggleTask.state !== "pending") {
    return false;
  }
  const startedAt = Number(serviceToggleTask.startedAt || 0);
  if (!Number.isFinite(startedAt)) {
    return false;
  }
  if (Date.now() - startedAt <= SERVICE_TOGGLE_PENDING_TIMEOUT_MS) {
    return false;
  }
  serviceToggleTask = {
    ...serviceToggleTask,
    state: "error",
    finishedAt: Date.now(),
    error: "Операция прервана. Повторите действие.",
  };
  persistServiceToggleTask();
  return true;
}

async function startServiceToggle(payload) {
  resolveStaleServiceToggleTask();
  if (serviceToggleTask?.state === "pending") {
    return {
      ok: true,
      task: serviceToggleTask,
    };
  }

  const action = payload?.action === "stop" ? "stop" : "start";
  serviceToggleTaskSerial += 1;
  const task = {
    id: `${Date.now()}-${serviceToggleTaskSerial}`,
    state: "pending",
    action,
    startedAt: Date.now(),
    error: "",
  };
  serviceToggleTask = task;
  await persistServiceToggleTask();
  runServiceToggleTask(task.id, payload).catch(async (error) => {
    if (serviceToggleTask?.id !== task.id) return;
    serviceToggleTask = {
      ...serviceToggleTask,
      state: "error",
      finishedAt: Date.now(),
      error: String(error),
    };
    await persistServiceToggleTask();
  });

  return {
    ok: true,
    task,
  };
}

async function ackServiceToggle(taskId) {
  if (!serviceToggleTask || serviceToggleTask.state === "pending") {
    return { ok: true, task: serviceToggleTask };
  }
  if (typeof taskId === "string" && taskId && taskId !== serviceToggleTask.id) {
    return { ok: true, task: serviceToggleTask };
  }
  serviceToggleTask = null;
  await persistServiceToggleTask();
  return { ok: true, task: null };
}

function pushSnifferItem(tabId, item) {
  const buffer = getTabBuffer(tabId);
  buffer.push(item);
  if (buffer.length > MAX_BUFFER_PER_TAB) {
    buffer.splice(0, buffer.length - MAX_BUFFER_PER_TAB);
  }
  schedulePersist();
}

function mapStatusClass(statusCode, hasError) {
  if (hasError) return "Error";
  if (statusCode >= 400) return "Block";
  return "Unknown";
}

function isBlockLikeError(rawError) {
  const error = String(rawError || "").trim().toLowerCase();
  if (!error) return false;
  return (
    error.includes("blocked_by_client") ||
    error.includes("err_blocked_by_client") ||
    error.includes("blocked by client") ||
    error.includes("blocked by extension") ||
    error.includes("ns_error_blocked") ||
    error.includes("content blocked") ||
    error.includes("content security policy") ||
    error.includes("content-security-policy") ||
    error.includes("csp")
  );
}

ext.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (!details.url || !details.url.startsWith("http")) return;
    pendingRequests.set(details.requestId, {
      id: `${details.requestId}-${Date.now()}`,
      tabId: details.tabId,
      url: details.url,
      domain: parseDomain(details.url),
      method: details.method || "GET",
      type: details.type || "other",
      startedAt: Date.now(),
    });
  },
  { urls: ["<all_urls>"] },
);

ext.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const pending = pendingRequests.get(details.requestId);
    pendingRequests.delete(details.requestId);
    const startedAt = pending?.startedAt ?? Date.now();
    pushSnifferItem(details.tabId, {
      id: pending?.id ?? `${details.requestId}-${Date.now()}`,
      tabId: details.tabId,
      url: details.url,
      domain: pending?.domain || parseDomain(details.url),
      method: pending?.method || details.method || "GET",
      type: pending?.type || details.type || "other",
      status: mapStatusClass(details.statusCode || 0, false),
      statusCode: details.statusCode || 0,
      durationMs: Math.max(0, Date.now() - startedAt),
      timestamp: Date.now(),
      error: "",
    });
  },
  { urls: ["<all_urls>"] },
);

ext.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const pending = pendingRequests.get(details.requestId);
    pendingRequests.delete(details.requestId);
    const startedAt = pending?.startedAt ?? Date.now();
    const rawError = details.error || "Request failed";
    const status = isBlockLikeError(rawError) ? "Block" : "Error";
    pushSnifferItem(details.tabId, {
      id: pending?.id ?? `${details.requestId}-${Date.now()}`,
      tabId: details.tabId,
      url: details.url,
      domain: pending?.domain || parseDomain(details.url),
      method: pending?.method || details.method || "GET",
      type: pending?.type || details.type || "other",
      status,
      statusCode: 0,
      durationMs: Math.max(0, Date.now() - startedAt),
      timestamp: Date.now(),
      error: rawError,
    });
  },
  { urls: ["<all_urls>"] },
);

ext.tabs.onRemoved.addListener((tabId) => {
  tabBuffers.delete(tabId);
  schedulePersist();
});

function normalizeHeaders(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key || value == null) continue;
    out[String(key)] = String(value);
  }
  return out;
}

function requestWithXHR(url, method, headers, body) {
  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.timeout = 12000;
      for (const [key, value] of Object.entries(headers)) {
        xhr.setRequestHeader(key, value);
      }
      xhr.onload = () => {
        resolve({
          ok: true,
          status: xhr.status || 0,
          body: xhr.responseText || "",
        });
      };
      xhr.onerror = () => {
        resolve({
          ok: false,
          status: 0,
          error: "XMLHttpRequest network error",
        });
      };
      xhr.ontimeout = () => {
        resolve({
          ok: false,
          status: 0,
          error: "XMLHttpRequest timeout",
        });
      };
      xhr.send(body ?? null);
    } catch (err) {
      resolve({
        ok: false,
        status: 0,
        error: String(err),
      });
    }
  });
}

async function proxyApiRequest(payload) {
  const url = typeof payload?.url === "string" ? payload.url : "";
  const method = typeof payload?.method === "string" ? payload.method : "GET";
  const headers = normalizeHeaders(payload?.headers);
  const body = typeof payload?.body === "string" ? payload.body : undefined;

  if (!url) {
    return { ok: false, status: 0, error: "missing url" };
  }

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
  } catch (fetchErr) {
    const xhrResult = await requestWithXHR(url, method, headers, body);
    if (xhrResult.ok) {
      return xhrResult;
    }
    return {
      ok: false,
      status: 0,
      error: `url=${url}; fetch failed: ${String(fetchErr)}; xhr failed: ${xhrResult.error || "unknown"}`,
    };
  }
}

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;

  if (type === "api:request") {
    const task = proxyApiRequest(message?.payload);
    if (hasBrowserNamespace) {
      return task;
    }
    task.then(sendResponse).catch((err) => {
      sendResponse({
        ok: false,
        status: 0,
        error: String(err),
      });
    });
    return true;
  }

  if (type === "sniffer:get-active") {
    const task = (async () => {
      const tabs = await ext.tabs.query({ active: true, currentWindow: true });
      const active = tabs?.[0];
      const tabId = active?.id;
      const items = typeof tabId === "number" ? getTabBuffer(tabId) : [];
      return {
        ok: true,
        tabId: typeof tabId === "number" ? tabId : null,
        url: active?.url || "",
        items,
      };
    })();

    if (hasBrowserNamespace) {
      return task;
    }

    task.then(sendResponse).catch((err) => {
      sendResponse({ ok: false, error: String(err) });
    });
    return true;
  }

  if (type === "sniffer:clear-tab") {
    const tabId = message?.tabId;
    if (typeof tabId === "number") {
      tabBuffers.set(tabId, []);
      schedulePersist();
    }
    if (hasBrowserNamespace) {
      return Promise.resolve({ ok: true });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (type === "service:toggle:start") {
    const task = startServiceToggle(message?.payload);
    if (hasBrowserNamespace) {
      return task;
    }
    task.then(sendResponse).catch((err) => {
      sendResponse({
        ok: false,
        error: String(err),
      });
    });
    return true;
  }

  if (type === "service:toggle:get") {
    resolveStaleServiceToggleTask();
    const payload = Promise.resolve({
      ok: true,
      task: serviceToggleTask,
    });
    if (hasBrowserNamespace) {
      return payload;
    }
    payload.then(sendResponse).catch((err) => {
      sendResponse({
        ok: false,
        error: String(err),
      });
    });
    return true;
  }

  if (type === "service:toggle:ack") {
    const task = ackServiceToggle(message?.taskId);
    if (hasBrowserNamespace) {
      return task;
    }
    task.then(sendResponse).catch((err) => {
      sendResponse({
        ok: false,
        error: String(err),
      });
    });
    return true;
  }

  return hasBrowserNamespace ? undefined : false;
});

hydrateBuffers();
hydrateServiceToggleTask();
