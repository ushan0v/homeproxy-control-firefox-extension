import type {
  CheckResponse,
  DevicesListResponse,
  HomeproxyServiceActionResponse,
  HomeproxyServiceStatusResponse,
  MatchResponse,
  NodeCreateRequest,
  NodeCreateResponse,
  NodeDeleteRequest,
  NodeDeleteResponse,
  NodeRenameRequest,
  NodeRenameResponse,
  RoutingNodesListResponse,
  RuleSetCreateRequest,
  RuleSetCreateResponse,
  RuleSetDeleteRequest,
  RuleSetDeleteResponse,
  RuleSetsListResponse,
  RuleSetUpdateRequest,
  RuleSetUpdateResponse,
  RulesCreateRequest,
  RulesCreateResponse,
  RulesDeleteRequest,
  RulesDeleteResponse,
  RulesHotReloadResponse,
  RulesListResponse,
  RulesUpdateRequest,
  RulesUpdateResponse,
  StoredSettings,
} from "../types/homeproxy";
import { hasExtensionRuntime, runtimeSendMessage } from "./webext";

export class ApiError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  if (host === "localhost") return true;
  if (host.startsWith("127.")) return true;
  if (host.startsWith("10.")) return true;
  if (host.startsWith("192.168.")) return true;
  if (host.startsWith("172.")) {
    const second = Number.parseInt(host.split(".")[1] || "", 10);
    return Number.isFinite(second) && second >= 16 && second <= 31;
  }
  return false;
}

export function normalizeBaseUrlInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `http://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname) return null;

    if (parsed.protocol === "https:" && isPrivateHostname(parsed.hostname)) {
      parsed.protocol = "http:";
    }

    if (!parsed.port) {
      parsed.port = "7878";
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";

    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export class HomeProxyApi {
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(settings: StoredSettings) {
    this.baseUrl = settings.baseUrl.replace(/\/$/, "");
    this.token = settings.token?.trim() || undefined;
  }

  private headers(includeJson = true): HeadersInit {
    const headers: Record<string, string> = {};
    if (includeJson) {
      headers["Content-Type"] = "application/json";
    }
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
      headers["X-Access-Token"] = this.token;
    }
    return headers;
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    parseAs: "json" | "text" = "json",
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const method = init.method || "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === "string" ? init.body : undefined;

    let status = 0;
    let bodyText = "";

    try {
      if (hasExtensionRuntime()) {
        const proxyResponse = await runtimeSendMessage<{
          ok: boolean;
          status?: number;
          body?: string;
          error?: string;
        }>({
          type: "api:request",
          payload: {
            url,
            method,
            headers,
            body,
          },
        });

        if (!proxyResponse?.ok) {
          throw new ApiError(
            proxyResponse?.error || "Background request failed",
            proxyResponse?.status ?? 0,
            proxyResponse?.error || "",
          );
        }

        status = proxyResponse?.status ?? 0;
        bodyText = proxyResponse?.body ?? "";
      } else {
        const response = await fetch(url, {
          ...init,
          cache: "no-store",
        });
        status = response.status;
        bodyText = await response.text();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(message, 0, "");
    }

    if (status < 200 || status >= 300) {
      const message = bodyText || `HTTP ${status}`;
      throw new ApiError(message, status, bodyText);
    }

    if (parseAs === "text") {
      return bodyText as T;
    }

    if (!bodyText.trim()) {
      return {} as T;
    }

    return JSON.parse(bodyText) as T;
  }

  async healthz(): Promise<string> {
    return this.request<string>(
      "/healthz",
      {
        method: "GET",
        headers: this.headers(false),
      },
      "text",
    );
  }

  async getServiceStatus(): Promise<HomeproxyServiceStatusResponse> {
    return this.request<HomeproxyServiceStatusResponse>("/homeproxy/status", {
      method: "GET",
      headers: this.headers(false),
    });
  }

  async startService(): Promise<HomeproxyServiceActionResponse> {
    return this.request<HomeproxyServiceActionResponse>("/homeproxy/start", {
      method: "POST",
      headers: this.headers(false),
    });
  }

  async stopService(): Promise<HomeproxyServiceActionResponse> {
    return this.request<HomeproxyServiceActionResponse>("/homeproxy/stop", {
      method: "POST",
      headers: this.headers(false),
    });
  }

  async restartService(): Promise<HomeproxyServiceActionResponse> {
    return this.request<HomeproxyServiceActionResponse>("/homeproxy/restart", {
      method: "POST",
      headers: this.headers(false),
    });
  }

  async getRules(): Promise<RulesListResponse> {
    return this.request<RulesListResponse>("/rules", {
      method: "GET",
      headers: this.headers(false),
    });
  }

  async updateRule(request: RulesUpdateRequest): Promise<RulesUpdateResponse> {
    return this.request<RulesUpdateResponse>("/rules/update", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request),
    });
  }

  async createRule(request: RulesCreateRequest): Promise<RulesCreateResponse> {
    return this.request<RulesCreateResponse>("/rules/create", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request),
    });
  }

  async deleteRule(request: RulesDeleteRequest): Promise<RulesDeleteResponse> {
    return this.request<RulesDeleteResponse>("/rules/delete", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request),
    });
  }

  async hotReloadRules(): Promise<RulesHotReloadResponse> {
    return this.request<RulesHotReloadResponse>("/rules/hot-reload", {
      method: "POST",
      headers: this.headers(false),
    });
  }

  async getRoutingNodes(): Promise<RoutingNodesListResponse> {
    return this.request<RoutingNodesListResponse>("/routing/nodes", {
      method: "GET",
      headers: this.headers(false),
    });
  }

  async createNode(request: NodeCreateRequest): Promise<NodeCreateResponse> {
    return this.request<NodeCreateResponse>("/nodes/create", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request),
    });
  }

  async renameNode(request: NodeRenameRequest): Promise<NodeRenameResponse> {
    return this.request<NodeRenameResponse>("/nodes/rename", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request),
    });
  }

  async deleteNode(request: NodeDeleteRequest): Promise<NodeDeleteResponse> {
    return this.request<NodeDeleteResponse>("/nodes/delete", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request),
    });
  }

  async getRuleSets(): Promise<RuleSetsListResponse> {
    return this.request<RuleSetsListResponse>("/rulesets", {
      method: "GET",
      headers: this.headers(false),
    });
  }

  async getDevices(): Promise<DevicesListResponse> {
    return this.request<DevicesListResponse>("/devices", {
      method: "GET",
      headers: this.headers(false),
    });
  }

  async createRuleSet(request: RuleSetCreateRequest): Promise<RuleSetCreateResponse> {
    return this.request<RuleSetCreateResponse>("/rulesets/create", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request),
    });
  }

  async updateRuleSet(request: RuleSetUpdateRequest): Promise<RuleSetUpdateResponse> {
    return this.request<RuleSetUpdateResponse>("/rulesets/update", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request),
    });
  }

  async deleteRuleSet(request: RuleSetDeleteRequest): Promise<RuleSetDeleteResponse> {
    return this.request<RuleSetDeleteResponse>("/rulesets/delete", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request),
    });
  }

  async matchRuleSets(query: string): Promise<MatchResponse> {
    return this.request<MatchResponse>(`/match?q=${encodeURIComponent(query)}`, {
      method: "GET",
      headers: this.headers(false),
    });
  }

  async checkDomains(domains: string[]): Promise<CheckResponse> {
    return this.request<CheckResponse>("/check", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        domains,
        inbound: "redirect-in",
        network: "tcp",
        port: 443,
      }),
    });
  }
}
