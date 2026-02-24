import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  LayoutDashboard,
  List,
  RotateCcw,
  Save,
  Power,
  RefreshCw,
  Settings,
  Shield,
} from "lucide-react";
import { NavButton } from "./components/NavButton";
import { RuleTargetPicker } from "./components/rule/RuleTargetPicker";
import { SetupScreen } from "./components/SetupScreen";
import { DashboardTab } from "./components/tabs/DashboardTab";
import {
  RulesTab,
  type RulesWorkspaceApplyPayload,
  type RulesWorkspaceController,
  type RulesWorkspaceSummary,
} from "./components/tabs/RulesTab";
import { SettingsTab } from "./components/tabs/SettingsTab";
import { SnifferTab } from "./components/tabs/SnifferTab";
import { Button } from "./components/ui/Button";
import { ApiError, HomeProxyApi } from "./lib/api";
import { extractDomainFromUrl } from "./lib/domain";
import {
  buildSnifferDomainItems,
  clearSnifferTab,
  collectSnifferDomains,
  fetchActiveSnifferData,
} from "./lib/sniffer";
import {
  type DomainScope,
  routeClassLabel,
} from "./lib/rule-utils";
import { clearSettings, loadQuickActions, loadSettings, saveQuickActions, saveSettings } from "./lib/storage";
import { ensureOriginPermission, hasExtensionRuntime, runtimeSendMessage, tabsQueryActive } from "./lib/webext";
import type {
  CheckResult,
  DeviceLeaseView,
  QuickActionConfig,
  RoutingNodeView,
  RoutingRuleView,
  RuleSetListItem,
  SnifferDomainItem,
  StoredSettings,
} from "./types/homeproxy";
import type { AppTab, ResolvedQuickAction } from "./types/ui";

type ConnectionState = "loading" | "missing" | "connected" | "error";
const POPUP_MAX_HEIGHT = 580;
const CHECK_BATCH_SIZE = 250;
const EMPTY_WORKSPACE_SUMMARY: RulesWorkspaceSummary = {
  totalChanges: 0,
  rulesChangeCount: 0,
  nodesChangeCount: 0,
  ruleSetsChangeCount: 0,
};

type ServiceToggleAction = "start" | "stop";
type ServiceToggleTaskState = "pending" | "success" | "error";

interface ServiceToggleTask {
  id: string;
  state: ServiceToggleTaskState;
  action: ServiceToggleAction;
  startedAt: number;
  finishedAt?: number;
  running?: boolean;
  error?: string;
}

interface ServiceToggleResponseEnvelope {
  ok: boolean;
  task?: ServiceToggleTask | null;
  error?: string;
}

function humanizeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    const raw = `${error.message} ${error.body}`.toLowerCase();
    if (error.status === 401) {
      return "Токен неверный или отсутствует. Проверьте Access token.";
    }
    if (raw.includes("ssl_error_rx_record_too_long") || raw.includes("ns_error_generate_failure")) {
      return "Firefox пытается установить HTTPS к HTTP API. Отключите HTTPS-Only для 192.168.1.1 или добавьте исключение для http://192.168.1.1:7878, затем повторите.";
    }
    if (error.status === 0) {
      return `NetworkError: ${error.message}`;
    }
    return `API ошибка (${error.status}): ${error.body || error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Неизвестная ошибка API";
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("dashboard");
  const [connectionState, setConnectionState] = useState<ConnectionState>("loading");
  const [connectionError, setConnectionError] = useState("");
  const [settings, setSettings] = useState<StoredSettings | null>(null);

  const [rules, setRules] = useState<RoutingRuleView[]>([]);
  const [routingNodes, setRoutingNodes] = useState<RoutingNodeView[]>([]);
  const [ruleSets, setRuleSets] = useState<RuleSetListItem[]>([]);
  const [devices, setDevices] = useState<DeviceLeaseView[]>([]);
  const [quickActions, setQuickActions] = useState<QuickActionConfig[]>([]);
  const [hasSavedQuickActionsConfig, setHasSavedQuickActionsConfig] = useState(false);

  const [serviceRunning, setServiceRunning] = useState(false);
  const [serviceBusy, setServiceBusy] = useState(false);
  const [servicePendingAction, setServicePendingAction] = useState<"start" | "stop" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshIconSpinTick, setRefreshIconSpinTick] = useState(0);

  const [currentDomain, setCurrentDomain] = useState("");
  const [currentCheck, setCurrentCheck] = useState<CheckResult | null>(null);
  const [loadingCurrentSite, setLoadingCurrentSite] = useState(false);

  const [snifferTabId, setSnifferTabId] = useState<number | null>(null);
  const [snifferItems, setSnifferItems] = useState<SnifferDomainItem[]>([]);

  const [savingRules, setSavingRules] = useState(false);
  const [workspaceSummary, setWorkspaceSummary] = useState<RulesWorkspaceSummary>(EMPTY_WORKSPACE_SUMMARY);
  const [toolbarError, setToolbarError] = useState("");
  const [quickFlow, setQuickFlow] = useState<{ domain: string; testIdPrefix: string } | null>(null);
  const [frameHeight, setFrameHeight] = useState<number | null>(null);
  const [contentExceedsMaxHeight, setContentExceedsMaxHeight] = useState(false);

  const headerRef = useRef<HTMLElement | null>(null);
  const toolbarErrorTimerRef = useRef<number | null>(null);
  const handledServiceTaskIdRef = useRef<string>("");
  const mainRef = useRef<HTMLElement | null>(null);
  const applyBarRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rulesTabRef = useRef<RulesWorkspaceController | null>(null);

  const api = useMemo(() => (settings ? new HomeProxyApi(settings) : null), [settings]);

  const recalculateFrameHeight = useCallback(() => {
    const main = mainRef.current;
    const headerHeight = headerRef.current?.offsetHeight ?? 0;
    const applyBarHeight = applyBarRef.current?.offsetHeight ?? 0;
    const navHeight = navRef.current?.offsetHeight ?? 0;
    const frameVerticalBorder = frameRef.current ? frameRef.current.offsetHeight - frameRef.current.clientHeight : 0;
    const contentNodes = main ? (Array.from(main.children) as HTMLElement[]) : [];
    let mainHeight = 0;

    for (const node of contentNodes) {
      const style = window.getComputedStyle(node);
      if (style.display === "none") continue;
      const marginTop = Number.parseFloat(style.marginTop) || 0;
      const marginBottom = Number.parseFloat(style.marginBottom) || 0;
      const nodeHeight =
        Math.max(node.scrollHeight, node.offsetHeight, Math.ceil(node.getBoundingClientRect().height)) +
        marginTop +
        marginBottom;
      if (nodeHeight > mainHeight) {
        mainHeight = nodeHeight;
      }
    }

    const desiredHeight = headerHeight + mainHeight + applyBarHeight + navHeight + frameVerticalBorder;
    if (!Number.isFinite(desiredHeight) || desiredHeight <= 0) {
      setFrameHeight((previous) => (typeof previous === "number" && previous > 0 ? previous : null));
      setContentExceedsMaxHeight(false);
      return;
    }

    const exceedsMax = desiredHeight > POPUP_MAX_HEIGHT + 0.5;
    setContentExceedsMaxHeight((previous) => (previous === exceedsMax ? previous : exceedsMax));
    const nextHeight = Math.max(1, Math.min(desiredHeight, POPUP_MAX_HEIGHT));
    setFrameHeight((previous) => (previous === nextHeight ? previous : nextHeight));
  }, []);

  const checkDomainsInBatches = useCallback(async (client: HomeProxyApi, domains: string[]) => {
    const checks: CheckResult[] = [];
    for (let index = 0; index < domains.length; index += CHECK_BATCH_SIZE) {
      const chunk = domains.slice(index, index + CHECK_BATCH_SIZE);
      if (!chunk.length) continue;
      const response = await client.checkDomains(chunk);
      checks.push(...response.results);
    }
    return checks;
  }, []);

  const resolvedQuickActions = useMemo<ResolvedQuickAction[]>(() => {
    return quickActions
      .filter((item) => item.enabled)
      .map((item) => {
        const rule = rules.find((entry) => entry.id === item.ruleId);
        if (!rule) return null;
        return { config: item, rule };
      })
      .filter((value): value is ResolvedQuickAction => Boolean(value));
  }, [quickActions, rules]);
  const quickRuleOptions = useMemo(
    () =>
      resolvedQuickActions.map(({ rule }) => {
        const outboundClass: "direct" | "block" | "proxy" | "unknown" =
          rule.outbound.class === "direct" || rule.outbound.class === "block" || rule.outbound.class === "proxy"
            ? (rule.outbound.class as "direct" | "block" | "proxy")
            : "unknown";
        const outboundTarget =
          rule.outbound.name?.trim() || rule.outbound.uciTag?.trim() || rule.outbound.tag?.trim() || "";

        return {
          id: rule.id,
          label: rule.name,
          outboundClass,
          outboundLabel: outboundClass === "proxy" ? `Proxy: ${outboundTarget || "не выбран"}` : routeClassLabel(outboundClass),
        };
      }),
    [resolvedQuickActions],
  );

  const refreshRules = useCallback(
    async (client: HomeProxyApi) => {
      const response = await client.getRules();
      const orderedRules = [...response.rules].sort((left, right) => {
        if (left.priority !== right.priority) {
          return left.priority - right.priority;
        }
        return left.id.localeCompare(right.id);
      });
      setRules(orderedRules);
    },
    [setRules],
  );

  const refreshRoutingNodes = useCallback(
    async (client: HomeProxyApi) => {
      const response = await client.getRoutingNodes();
      setRoutingNodes(response.nodes);
    },
    [setRoutingNodes],
  );

  const refreshRuleSets = useCallback(
    async (client: HomeProxyApi) => {
      const response = await client.getRuleSets();
      setRuleSets(response.ruleSets);
    },
    [setRuleSets],
  );

  const refreshDevices = useCallback(
    async (client: HomeProxyApi) => {
      try {
        const response = await client.getDevices();
        setDevices(response.devices ?? []);
      } catch {
        setDevices([]);
      }
    },
    [setDevices],
  );

  const refreshRulesWorkspace = useCallback(
    async (client: HomeProxyApi) => {
      await Promise.all([refreshRules(client), refreshRoutingNodes(client), refreshRuleSets(client)]);
    },
    [refreshRoutingNodes, refreshRuleSets, refreshRules],
  );

  const refreshServiceStatus = useCallback(
    async (client: HomeProxyApi) => {
      const response = await client.getServiceStatus();
      setServiceRunning(response.running);
    },
    [setServiceRunning],
  );

  const refreshCurrentSite = useCallback(
    async (client: HomeProxyApi) => {
      setLoadingCurrentSite(true);
      try {
        const tabs = await tabsQueryActive();
        const active = tabs[0];
        const domain = extractDomainFromUrl(active?.url ?? "");
        setCurrentDomain(domain);

        if (!domain) {
          setCurrentCheck(null);
          return;
        }

        const check = await client.checkDomains([domain]);
        setCurrentCheck(check.results[0] ?? null);
      } finally {
        setLoadingCurrentSite(false);
      }
    },
    [setCurrentCheck, setCurrentDomain],
  );

  const refreshSniffer = useCallback(
    async (client: HomeProxyApi | null) => {
      try {
        const response = await fetchActiveSnifferData();
        if (!response.ok) return;

        const items = response.items ?? [];
        setSnifferTabId(response.tabId);

        const domains = collectSnifferDomains(items);
        if (!client || !domains.length) {
          setSnifferItems(buildSnifferDomainItems(items, []));
          return;
        }

        const checks = await checkDomainsInBatches(client, domains);
        setSnifferItems(buildSnifferDomainItems(items, checks));
      } catch {
        // ignore polling errors
      }
    },
    [checkDomainsInBatches, setSnifferItems],
  );

  const initializeWithSettings = useCallback(
    async (nextSettings: StoredSettings, persist: boolean) => {
      const client = new HomeProxyApi(nextSettings);
      await client.healthz();

      if (persist) {
        await saveSettings(nextSettings);
      }

      setSettings(nextSettings);
      setConnectionError("");
      setConnectionState("connected");

      await Promise.all([
        refreshRulesWorkspace(client),
        refreshServiceStatus(client),
        refreshCurrentSite(client),
        refreshDevices(client),
      ]);
      await refreshSniffer(client);
    },
    [refreshCurrentSite, refreshDevices, refreshRulesWorkspace, refreshServiceStatus, refreshSniffer],
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [storedSettings, storedQuickActions] = await Promise.all([loadSettings(), loadQuickActions()]);
        if (cancelled) return;

        setQuickActions(storedQuickActions.actions);
        setHasSavedQuickActionsConfig(storedQuickActions.hasSavedConfig);

        if (!storedSettings) {
          setSettings(null);
          setConnectionState("missing");
          return;
        }

        setSettings(storedSettings);

        try {
          await initializeWithSettings(storedSettings, false);
        } catch (error) {
          if (cancelled) return;
          setConnectionState("error");
          setConnectionError(humanizeApiError(error));
        }
      } catch {
        if (cancelled) return;
        setConnectionState("error");
        setConnectionError("Не удалось загрузить локальные настройки расширения.");
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [initializeWithSettings]);

  useEffect(() => {
    if (!rules.length) return;

    const validIds = new Set(rules.map((rule) => rule.id));
    const filtered = quickActions.filter((item) => validIds.has(item.ruleId));

    if (filtered.length !== quickActions.length) {
      setQuickActions(filtered);
      setHasSavedQuickActionsConfig(true);
      void saveQuickActions(filtered);
    }
  }, [quickActions, rules]);

  useEffect(() => {
    if (!rules.length || hasSavedQuickActionsConfig) return;

    const defaults = rules.map((rule) => ({ ruleId: rule.id, enabled: true }));
    setQuickActions(defaults);
    setHasSavedQuickActionsConfig(true);
    void saveQuickActions(defaults);
  }, [hasSavedQuickActionsConfig, rules]);

  useEffect(() => {
    if (connectionState !== "connected" || !api) return;

    let disposed = false;
    let timer: number | undefined;

    const tick = async () => {
      if (disposed) return;
      await refreshSniffer(api);
      if (!disposed) {
        timer = window.setTimeout(tick, 1400);
      }
    };

    void tick();

    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [api, connectionState, refreshSniffer]);

  const showToolbarError = useCallback((message: string) => {
    if (toolbarErrorTimerRef.current) {
      window.clearTimeout(toolbarErrorTimerRef.current);
      toolbarErrorTimerRef.current = null;
    }
    setToolbarError(message);
    toolbarErrorTimerRef.current = window.setTimeout(() => {
      setToolbarError("");
      toolbarErrorTimerRef.current = null;
    }, 3600);
  }, []);

  const syncServiceToggleTask = useCallback(
    async (client: HomeProxyApi | null) => {
      if (!hasExtensionRuntime()) return;

      const response = await runtimeSendMessage<ServiceToggleResponseEnvelope>({
        type: "service:toggle:get",
      });
      if (!response?.ok) {
        return;
      }

      const task = response.task ?? null;
      if (!task) {
        setServiceBusy(false);
        setServicePendingAction(null);
        return;
      }

      if (task.state === "pending") {
        setServiceBusy(true);
        setServicePendingAction(task.action);
        return;
      }

      setServiceBusy(false);
      setServicePendingAction(null);

      if (!task.id || handledServiceTaskIdRef.current === task.id) {
        return;
      }
      handledServiceTaskIdRef.current = task.id;

      if (task.state === "success") {
        if (typeof task.running === "boolean") {
          setServiceRunning(task.running);
        } else if (client) {
          await refreshServiceStatus(client).catch(() => undefined);
        }
        if (client) {
          await refreshCurrentSite(client).catch(() => undefined);
        }
      } else if (task.state === "error") {
        showToolbarError(task.error?.trim() || "Не удалось изменить состояние службы.");
      }

      await runtimeSendMessage<ServiceToggleResponseEnvelope>({
        type: "service:toggle:ack",
        taskId: task.id,
      }).catch(() => undefined);
    },
    [refreshCurrentSite, refreshServiceStatus, showToolbarError],
  );

  useEffect(() => {
    if (connectionState !== "connected") return;
    if (!hasExtensionRuntime()) return;

    let disposed = false;
    let timer: number | undefined;

    const tick = async () => {
      if (disposed) return;
      await syncServiceToggleTask(api).catch(() => undefined);
      if (!disposed) {
        timer = window.setTimeout(tick, serviceBusy ? 320 : 900);
      }
    };

    void tick();

    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [api, connectionState, serviceBusy, syncServiceToggleTask]);

  useEffect(() => {
    return () => {
      if (toolbarErrorTimerRef.current) {
        window.clearTimeout(toolbarErrorTimerRef.current);
        toolbarErrorTimerRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (connectionState !== "connected") return;
    if (quickFlow?.domain) {
      mainRef.current?.scrollTo({ top: 0, behavior: "auto" });
    }
    recalculateFrameHeight();
  }, [
    activeTab,
    connectionState,
    currentCheck,
    currentDomain,
    loadingCurrentSite,
    quickFlow,
    quickActions.length,
    recalculateFrameHeight,
    routingNodes.length,
    ruleSets.length,
    rules.length,
    savingRules,
    snifferItems,
    toolbarError,
    workspaceSummary.totalChanges,
  ]);

  useEffect(() => {
    if (connectionState !== "connected") return;
    const onResize = () => recalculateFrameHeight();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [connectionState, recalculateFrameHeight]);

  useEffect(() => {
    if (connectionState !== "connected") return;
    const main = mainRef.current;
    if (!main || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => recalculateFrameHeight());
    observer.observe(main);
    for (const child of Array.from(main.children)) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  }, [activeTab, connectionState, recalculateFrameHeight]);

  async function handleSaveSettings(nextSettings: StoredSettings) {
    try {
      const allowed = await ensureOriginPermission(nextSettings.baseUrl);
      if (!allowed) {
        throw new Error(
          "Не выдано разрешение на доступ к API-адресу. Разрешите доступ для этого сайта в настройках расширения и повторите.",
        );
      }
      await initializeWithSettings(nextSettings, true);
    } catch (error) {
      setConnectionState("error");
      const message = humanizeApiError(error);
      setConnectionError(message);
      throw new Error(message);
    }
  }

  async function handleResetConnection() {
    await clearSettings();
    setSettings(null);
    setConnectionError("");
    setConnectionState("missing");
    setActiveTab("dashboard");
    setQuickFlow(null);
    setToolbarError("");
    setServiceRunning(false);
    setServiceBusy(false);
    setServicePendingAction(null);
    setRefreshing(false);
    setCurrentDomain("");
    setCurrentCheck(null);
    setLoadingCurrentSite(false);
    setSnifferTabId(null);
    setSnifferItems([]);
    setRules([]);
    setRoutingNodes([]);
    setRuleSets([]);
    setDevices([]);
    setWorkspaceSummary(EMPTY_WORKSPACE_SUMMARY);
  }

  async function handleToggleService() {
    if (!api || !settings || serviceBusy) return;

    const action: ServiceToggleAction = serviceRunning ? "stop" : "start";
    setToolbarError("");
    setServicePendingAction(action);
    setServiceBusy(true);

    if (!hasExtensionRuntime()) {
      try {
        if (action === "stop") {
          const response = await api.stopService();
          setServiceRunning(response.running);
        } else {
          const response = await api.startService();
          setServiceRunning(response.running);
        }
        await refreshCurrentSite(api);
      } catch (error) {
        showToolbarError(humanizeApiError(error));
      } finally {
        setServicePendingAction(null);
        setServiceBusy(false);
      }
      return;
    }

    try {
      const response = await runtimeSendMessage<ServiceToggleResponseEnvelope>({
        type: "service:toggle:start",
        payload: {
          action,
          baseUrl: settings.baseUrl,
          token: settings.token || "",
        },
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Не удалось отправить команду переключения службы.");
      }
      await syncServiceToggleTask(api);
    } catch (error) {
      setServicePendingAction(null);
      setServiceBusy(false);
      showToolbarError(humanizeApiError(error));
    }
  }

  async function handleHardRefresh() {
    if (!api) return;

    setRefreshing(true);
    setToolbarError("");
    try {
      await Promise.all([refreshRulesWorkspace(api), refreshServiceStatus(api), refreshCurrentSite(api), refreshDevices(api)]);
      await refreshSniffer(api);
    } catch (error) {
      showToolbarError(humanizeApiError(error));
    } finally {
      setRefreshing(false);
    }
  }

  function handleOpenQuick(domain: string, testIdPrefix: string) {
    setQuickFlow({ domain, testIdPrefix });
    setToolbarError("");
  }

  async function handleQueueQuickDomain(ruleId: string, domain: string, scope: DomainScope) {
    const controller = rulesTabRef.current;
    if (!controller) {
      throw new Error("Рабочее пространство правил не инициализировано.");
    }
    controller.queueQuickDomain(ruleId, domain, scope);
  }

  function handleResetWorkspace() {
    rulesTabRef.current?.resetWorkspace();
  }

  function handleTabChange(nextTab: AppTab) {
    if (quickFlow) {
      setQuickFlow(null);
    }
    setActiveTab(nextTab);
  }

  async function handleApplyWorkspace() {
    if (savingRules) return;
    try {
      const applied = await rulesTabRef.current?.applyWorkspace();
      if (applied === false) {
        return;
      }
    } catch (error) {
      showToolbarError(humanizeApiError(error));
    }
  }

  async function handleApplyRulesWorkspace(payload: RulesWorkspaceApplyPayload) {
    if (!api) throw new Error("API не настроен.");
    if (!payload.totalChanges) return;

    const remapNodeReference = (value: string, nodeIdMap: Map<string, string>): string => {
      const raw = value.trim();
      if (!raw) return raw;
      if (
        raw === "direct" ||
        raw === "direct-out" ||
        raw === "block" ||
        raw === "block-out" ||
        raw === "reject" ||
        raw === "reject-out"
      ) {
        return raw;
      }
      if (raw.startsWith("cfg-") && raw.endsWith("-out") && raw.length > 8) {
        const sectionId = raw.slice(4, -4);
        const mappedSectionId = nodeIdMap.get(sectionId) ?? sectionId;
        return `cfg-${mappedSectionId}-out`;
      }
      return nodeIdMap.get(raw) ?? raw;
    };

    const remapRuleSetReference = (value: string, ruleSetIdMap: Map<string, string>): string => {
      const raw = value.trim();
      if (!raw) return raw;
      return ruleSetIdMap.get(raw) ?? raw;
    };

    setSavingRules(true);
    try {
      const nodeIdMap = new Map<string, string>();
      for (const request of payload.nodeCreates) {
        const { id: pendingRoutingIdRaw, ...nodeRequest } = request;
        const pendingRoutingId = pendingRoutingIdRaw?.trim() || "";
        const requestedRoutingId = nodeRequest.routingId?.trim() || pendingRoutingId;
        const requestedNodeId = nodeRequest.nodeId?.trim() || "";

        const createdNode = await api.createNode({
          ...nodeRequest,
          ...(nodeRequest.outbound !== undefined
            ? { outbound: remapNodeReference(nodeRequest.outbound, nodeIdMap) }
            : {}),
          ...(requestedRoutingId ? { routingId: requestedRoutingId } : {}),
          ...(!requestedNodeId && requestedRoutingId ? { nodeId: `node_${requestedRoutingId}` } : {}),
        });

        if (pendingRoutingId) {
          nodeIdMap.set(pendingRoutingId, createdNode.routingId);
        }
        if (requestedRoutingId) {
          nodeIdMap.set(requestedRoutingId, createdNode.routingId);
        }
      }

      const ruleSetIdMap = new Map<string, string>();
      for (const request of payload.ruleSetCreates) {
        const pendingRuleSetId = request.id?.trim() || "";
        const createdRuleSet = await api.createRuleSet({
          ...request,
          ...(request.outbound !== undefined
            ? { outbound: remapNodeReference(request.outbound, nodeIdMap) }
            : {}),
        });
        if (pendingRuleSetId) {
          ruleSetIdMap.set(pendingRuleSetId, createdRuleSet.id);
        }
      }

      for (const request of payload.ruleCreates) {
        await api.createRule({
          ...request,
          outbound: request.outbound
            ? {
                ...request.outbound,
                ...(request.outbound.class === "proxy" && request.outbound.node
                  ? { node: remapNodeReference(request.outbound.node, nodeIdMap) }
                  : {}),
              }
            : request.outbound,
          config: {
            ...request.config,
            ruleSet: request.config.ruleSet.map((item) => remapRuleSetReference(item, ruleSetIdMap)),
          },
        });
      }

      const orderedRuleUpdates = [...payload.ruleUpdates].sort((left, right) => {
        const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
        const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }
        return left.id.localeCompare(right.id);
      });

      for (const patch of orderedRuleUpdates) {
        await api.updateRule({
          tag: patch.tag,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          config: {
            ...patch.config,
            ruleSet: patch.config.ruleSet.map((item) => remapRuleSetReference(item, ruleSetIdMap)),
          },
          outbound: {
            ...patch.outbound,
            ...(patch.outbound.class === "proxy" && patch.outbound.node
              ? { node: remapNodeReference(patch.outbound.node, nodeIdMap) }
              : {}),
          },
        });
      }

      for (const ruleId of payload.ruleDeletes) {
        await api.deleteRule({ id: ruleId });
      }

      for (const request of payload.nodeRenames) {
        await api.renameNode(request);
      }

      for (const request of payload.ruleSetUpdates) {
        await api.updateRuleSet({
          ...request,
          ...(request.outbound !== undefined
            ? { outbound: remapNodeReference(request.outbound, nodeIdMap) }
            : {}),
        });
      }

      for (const ruleSetId of payload.ruleSetDeletes) {
        await api.deleteRuleSet({
          id: ruleSetId,
        });
      }

      for (const nodeId of payload.nodeDeletes) {
        await api.deleteNode({
          id: nodeId,
        });
      }

      await api.hotReloadRules();
      await Promise.all([refreshRulesWorkspace(api), refreshCurrentSite(api), refreshDevices(api)]);
    } catch (error) {
      const message = humanizeApiError(error);
      throw new Error(message);
    } finally {
      setSavingRules(false);
    }
  }

  async function handleQuickActionsChange(next: QuickActionConfig[]) {
    setQuickActions(next);
    setHasSavedQuickActionsConfig(true);
    await saveQuickActions(next);
  }

  async function handleClearSniffer(tabId: number) {
    await clearSnifferTab(tabId);
    await refreshSniffer(api);
  }

  const popupMaxHeight = `${POPUP_MAX_HEIGHT}px`;
  const quickMode = Boolean(quickFlow?.domain);
  const hasWorkspaceChanges = workspaceSummary.totalChanges > 0;
  const serviceBusyLabel =
    servicePendingAction === "stop"
      ? "Выключаем..."
      : servicePendingAction === "start"
        ? "Включаем..."
        : serviceRunning
          ? "Выключаем..."
          : "Включаем...";
  const serviceToggleLabel = serviceBusy
    ? `${serviceBusyLabel} службу HomeProxy`
    : serviceRunning
      ? "Выключить службу HomeProxy"
      : "Включить службу HomeProxy";

  if (connectionState === "loading") {
    return (
      <div
        className="relative flex w-[400px] flex-col overflow-hidden border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl"
        style={{ maxHeight: popupMaxHeight }}
      >
        <div className="flex min-h-0 items-center justify-center p-5 text-zinc-300">
          <div className="flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm">
            <RefreshCw size={14} className="animate-spin text-zinc-400" />
            <span>Загрузка...</span>
          </div>
        </div>
      </div>
    );
  }

  if (connectionState !== "connected") {
    return (
      <div
        className="relative flex w-[400px] flex-col overflow-hidden border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl"
        style={{ maxHeight: popupMaxHeight }}
      >
        <div className="min-h-0 overflow-y-auto">
          <SetupScreen initialSettings={settings} errorMessage={connectionError} onSaveSettings={handleSaveSettings} />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={frameRef}
      className="relative flex w-[400px] flex-col overflow-hidden border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl"
      style={{
        ...(frameHeight ? { height: `${frameHeight}px` } : {}),
        maxHeight: popupMaxHeight,
      }}
    >
      <header
        ref={headerRef}
        className="z-30 shrink-0 border-b border-zinc-800 bg-zinc-950/95 px-5 py-2 backdrop-blur-md"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Shield className="text-zinc-100" size={20} />
              <div
                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-950 ${
                  serviceBusy
                    ? "bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.55)]"
                    : serviceRunning
                      ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                      : "bg-zinc-600"
                }`}
              />
            </div>
            <span className="text-sm font-bold tracking-tight">HomeProxy</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={(event) => {
                event.currentTarget.blur();
                if (refreshing) return;
                setRefreshIconSpinTick((tick) => tick + 1);
                void handleHardRefresh();
              }}
              className="gap-1.5 rounded-lg px-2 text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
            >
              <RefreshCw
                key={refreshIconSpinTick}
                size={16}
                className={refreshIconSpinTick > 0 ? "refresh-spin-once" : ""}
              />
              <span className="text-xs">Обновление</span>
            </Button>
            <button
              onClick={() => {
                void handleToggleService();
              }}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                serviceBusy
                  ? "bg-blue-500/15 text-blue-300"
                  : serviceRunning
                  ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                  : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
              }`}
              disabled={serviceBusy}
              aria-label={serviceToggleLabel}
              title={serviceToggleLabel}
              data-testid="service-toggle-button"
            >
              {serviceBusy ? <RefreshCw size={16} className="animate-spin" /> : <Power size={18} />}
            </button>
          </div>
        </div>
        {toolbarError ? <p className="mt-1 text-right text-[10px] leading-tight text-rose-400">{toolbarError}</p> : null}
      </header>

      <main
        ref={mainRef}
        className={`relative min-h-0 flex-1 overflow-x-hidden ${contentExceedsMaxHeight ? "overflow-y-auto" : "overflow-y-hidden"}`}
      >
        <div className={quickMode || activeTab !== "dashboard" ? "hidden" : ""}>
          <DashboardTab
            currentDomain={currentDomain}
            currentCheck={currentCheck}
            loadingCurrentSite={loadingCurrentSite}
            onOpenQuick={(domain) => handleOpenQuick(domain, "dashboard")}
          />
        </div>

        <div className={quickMode || activeTab !== "sniffer" ? "hidden" : ""}>
          <SnifferTab
            items={snifferItems}
            tabId={snifferTabId}
            onOpenQuick={(domain) => handleOpenQuick(domain, "sniffer")}
            onClearSniffer={handleClearSniffer}
          />
        </div>

        <div className={quickMode || activeTab !== "rules" ? "hidden" : ""}>
          <RulesTab
            ref={rulesTabRef}
            rules={rules}
            routingNodes={routingNodes}
            ruleSets={ruleSets}
            devices={devices}
            onApplyChanges={handleApplyRulesWorkspace}
            onSummaryChange={setWorkspaceSummary}
          />
        </div>

        <div className={quickMode || activeTab !== "settings" ? "hidden" : ""}>
          <SettingsTab
            rules={rules}
            quickActions={quickActions}
            onQuickActionsChange={handleQuickActionsChange}
            onResetConnection={handleResetConnection}
          />
        </div>

        <div className={!quickMode ? "hidden" : "flex min-h-0 flex-1"} data-testid="quick-screen">
          <RuleTargetPicker
            domain={quickFlow?.domain || ""}
            options={quickRuleOptions.map((item) => ({
              ...item,
              testId: `${quickFlow?.testIdPrefix || "quick"}-rule-${item.id}`,
            }))}
            onSubmit={handleQueueQuickDomain}
            onCancel={() => setQuickFlow(null)}
            emptyMessage="Нет включенных правил в Quick Actions."
            testIdPrefix={quickFlow?.testIdPrefix || "quick"}
          />
        </div>
      </main>

      {hasWorkspaceChanges ? (
        <div
          ref={applyBarRef}
          className="z-30 shrink-0 border-t border-zinc-800 bg-zinc-950/95 px-3 py-2 backdrop-blur"
          data-testid="workspace-apply-bar"
        >
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-full justify-center px-2 text-zinc-300"
              onClick={handleResetWorkspace}
              disabled={savingRules}
              data-testid="workspace-reset"
            >
              <RotateCcw size={13} className="mr-1" /> Сброс
            </Button>
            <Button
              size="sm"
              className="h-8 w-full justify-center px-2"
              onClick={() => {
                void handleApplyWorkspace();
              }}
              disabled={savingRules}
              data-testid="workspace-apply"
            >
              <Save size={13} className="mr-1" /> {savingRules ? "Применение..." : "Применить"}
            </Button>
          </div>
        </div>
      ) : null}

      <nav ref={navRef} className="z-20 grid h-16 shrink-0 grid-cols-4 gap-1 border-t border-zinc-800 bg-zinc-950 px-2">
        <NavButton
          active={activeTab === "dashboard"}
          onClick={() => handleTabChange("dashboard")}
          icon={LayoutDashboard}
          label="Main"
          testId="nav-dashboard"
        />
        <NavButton
          active={activeTab === "sniffer"}
          onClick={() => handleTabChange("sniffer")}
          icon={Activity}
          label="Sniffer"
          testId="nav-sniffer"
        />
        <NavButton
          active={activeTab === "rules"}
          onClick={() => handleTabChange("rules")}
          icon={List}
          label="Rules"
          testId="nav-rules"
        />
        <NavButton
          active={activeTab === "settings"}
          onClick={() => handleTabChange("settings")}
          icon={Settings}
          label="Settings"
          testId="nav-settings"
        />
      </nav>
    </div>
  );
}
