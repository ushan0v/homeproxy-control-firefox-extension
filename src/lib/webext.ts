type AnyFn = (...args: unknown[]) => unknown;

type ExtensionApi = {
  storage?: {
    local?: {
      get?: AnyFn;
      set?: AnyFn;
    };
  };
  tabs?: {
    query?: AnyFn;
  };
  runtime?: {
    id?: string;
    sendMessage?: AnyFn;
  };
  permissions?: {
    contains?: AnyFn;
    request?: AnyFn;
  };
};

const extensionApi: ExtensionApi | null =
  (globalThis as { browser?: ExtensionApi }).browser ??
  (globalThis as { chrome?: ExtensionApi }).chrome ??
  null;

function isPromiseLike<T = unknown>(value: unknown): value is Promise<T> {
  return Boolean(value && typeof value === "object" && "then" in (value as Record<string, unknown>));
}

function callbackToPromise<T>(executor: (cb: (value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      executor((value) => {
        const runtime = (globalThis as { chrome?: { runtime?: { lastError?: { message?: string } } } }).chrome;
        const lastError = runtime?.runtime?.lastError;
        if (lastError?.message) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(value);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function hasExtensionRuntime(): boolean {
  return Boolean(extensionApi?.runtime?.sendMessage);
}

export async function storageLocalGet<T>(key: string): Promise<T | undefined> {
  const get = extensionApi?.storage?.local?.get;
  if (!get) {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  }

  const maybePromise = get.call(extensionApi.storage?.local, key);
  const result = isPromiseLike<Record<string, T>>(maybePromise)
    ? await maybePromise
    : await callbackToPromise<Record<string, T>>((cb) => get.call(extensionApi.storage?.local, key, cb));

  return result?.[key];
}

export async function storageLocalSet(values: Record<string, unknown>): Promise<void> {
  const set = extensionApi?.storage?.local?.set;
  if (!set) {
    for (const [key, value] of Object.entries(values)) {
      localStorage.setItem(key, JSON.stringify(value));
    }
    return;
  }

  const maybePromise = set.call(extensionApi.storage?.local, values);
  if (isPromiseLike(maybePromise)) {
    await maybePromise;
    return;
  }

  await callbackToPromise<void>((cb) => set.call(extensionApi.storage?.local, values, cb));
}

export async function tabsQueryActive(): Promise<Array<{ id?: number; url?: string }>> {
  const query = extensionApi?.tabs?.query;
  if (!query) {
    return [{ id: 0, url: window.location.href }];
  }

  const input = { active: true, currentWindow: true };
  const maybePromise = query.call(extensionApi.tabs, input);
  if (isPromiseLike(maybePromise)) {
    return (await maybePromise) as Array<{ id?: number; url?: string }>;
  }

  return callbackToPromise<Array<{ id?: number; url?: string }>>((cb) => query.call(extensionApi.tabs, input, cb));
}

export async function runtimeSendMessage<T>(message: unknown): Promise<T> {
  const sendMessage = extensionApi?.runtime?.sendMessage;
  if (!sendMessage) {
    const payload = message as { type?: string };
    if (payload.type === "sniffer:get-active") {
      return {
        ok: true,
        tabId: 0,
        url: window.location.href,
        items: [],
      } as T;
    }
    return { ok: true } as T;
  }

  const maybePromise = sendMessage.call(extensionApi.runtime, message);
  if (isPromiseLike<T>(maybePromise)) {
    return await maybePromise;
  }

  return callbackToPromise<T>((cb) => sendMessage.call(extensionApi.runtime, message, cb));
}

async function permissionsCall(method: "contains" | "request", pattern: string): Promise<boolean> {
  const fn = extensionApi?.permissions?.[method];
  if (!fn) return true;

  const payload = { origins: [pattern] };
  const maybePromise = fn.call(extensionApi.permissions, payload);
  if (isPromiseLike<boolean>(maybePromise)) {
    return await maybePromise;
  }

  return callbackToPromise<boolean>((cb) => fn.call(extensionApi.permissions, payload, cb));
}

export async function ensureOriginPermission(apiBaseUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(apiBaseUrl);
    const pattern = `${parsed.protocol}//${parsed.host}/*`;
    const hasPermission = await permissionsCall("contains", pattern).catch(() => true);
    if (hasPermission) return true;

    const requested = await permissionsCall("request", pattern).catch(() => true);
    if (!requested) return false;

    const confirmed = await permissionsCall("contains", pattern).catch(() => true);
    return confirmed || requested;
  } catch {
    return true;
  }
}
