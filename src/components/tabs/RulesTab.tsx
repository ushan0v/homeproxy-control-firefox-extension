import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Database,
  ListTree,
  Menu,
  Network,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { normalizeDomain } from "../../lib/domain";
import { routeClassLabel, routeClassToBadgeColor, toRuleUpdateConfig, type DomainScope } from "../../lib/rule-utils";
import type {
  DeviceLeaseView,
  NodeCreateRequest,
  RouteEditClass,
  RuleEditPatch,
  RulesCreateRequest,
  RuleSetCreateRequest,
  RuleSetListItem,
  RuleSetUpdateRequest,
  RoutingNodeView,
  RoutingRuleView,
  RulesUpdateConfig,
} from "../../types/homeproxy";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

interface Props {
  rules: RoutingRuleView[];
  routingNodes: RoutingNodeView[];
  ruleSets: RuleSetListItem[];
  devices: DeviceLeaseView[];
  onApplyChanges: (payload: RulesWorkspaceApplyPayload) => Promise<void>;
  onMatchRuleSets: (query: string) => Promise<string[]>;
  onSummaryChange?: (summary: RulesWorkspaceSummary) => void;
}

export interface RulesWorkspaceApplyPayload {
  totalChanges: number;
  ruleCreates: RulesCreateRequest[];
  ruleUpdates: RuleEditPatch[];
  ruleDeletes: string[];
  nodeCreates: NodeCreateRequest[];
  nodeRenames: Array<{ id: string; name: string }>;
  nodeDeletes: string[];
  ruleSetCreates: RuleSetCreateRequest[];
  ruleSetUpdates: RuleSetUpdateRequest[];
  ruleSetDeletes: string[];
}

export interface RulesWorkspaceSummary {
  totalChanges: number;
  rulesChangeCount: number;
  nodesChangeCount: number;
  ruleSetsChangeCount: number;
  pendingRuleDeleteIds: string[];
}

export interface RulesWorkspaceController {
  queueQuickDomain: (ruleId: string, domain: string, scope: DomainScope) => { status: "added" | "duplicate" };
  applyWorkspace: () => Promise<boolean>;
  resetWorkspace: () => void;
}

type WorkspaceSection = "rules" | "nodes" | "ruleSets";
type RuleFieldKey = keyof RulesUpdateConfig;

interface RuleFieldDefinition {
  key: RuleFieldKey;
  label: string;
  helper: string;
  placeholder: string;
}

interface RuleDraft {
  id: string;
  tag: string;
  name: string;
  enabled: boolean;
  priority: number;
  config: RulesUpdateConfig;
  outboundClass: RouteEditClass;
  outboundNode: string;
}

interface RuleCreateDraft {
  tempId: string;
  id: string;
  name: string;
  enabled: boolean;
  outboundClass: RouteEditClass;
  outboundNode: string;
  config: RulesUpdateConfig;
}

interface NewRuleValueDraft {
  field: RuleFieldKey;
  value: string;
}

interface RuleDragSession {
  activeId: string;
  activeNode: HTMLDivElement;
  pointerId: number;
  startY: number;
  latestClientY: number;
  framePending: boolean;
  minOffset: number;
  maxOffset: number;
  previewOrder: string[];
}

type RuleListItem =
  | {
      kind: "existing";
      key: string;
      rule: RoutingRuleView;
    }
  | {
      kind: "pending";
      key: string;
      draft: RuleCreateDraft;
    };

interface NodeCreateDraft {
  name: string;
  key: string;
  outbound: string;
}

interface PendingNodeCreateDraft {
  tempId: string;
  id: string;
  name: string;
  key: string;
  outbound: string;
}

interface RuleSetDraft {
  id: string;
  name: string;
  format: string;
  url: string;
  outbound: string;
  updateInterval: string;
}

interface RuleSetCreateDraft {
  tempId: string;
  id: string;
  name: string;
  format: string;
  url: string;
  outbound: string;
  updateInterval: string;
}

type FieldErrorMap = Record<string, string>;

const INPUT_CLASS =
  "h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900/90 px-2 text-xs text-zinc-100 placeholder:text-zinc-500/70 focus:border-blue-500/40 focus:outline-none";
const SELECT_CLASS =
  "h-9 rounded-lg border border-zinc-700 bg-zinc-900/90 px-2 text-xs text-zinc-100 focus:border-blue-500/40 focus:outline-none";
const INLINE_ERROR_CLASS = "mt-1 text-[11px] leading-tight text-rose-400";

const RULE_FIELD_DEFINITIONS: RuleFieldDefinition[] = [
  {
    key: "domain",
    label: "Точный домен",
    helper: "Только один конкретный домен (example.com)",
    placeholder: "example.com",
  },
  {
    key: "domainSuffix",
    label: "Домен и поддомены",
    helper: "Весь домен со всеми поддоменами (example.com)",
    placeholder: "example.com",
  },
  {
    key: "domainKeyword",
    label: "Ключевое слово домена",
    helper: "Совпадение по части домена",
    placeholder: "stream",
  },
  {
    key: "domainRegex",
    label: "Regex домена",
    helper: "Регулярное выражение для домена",
    placeholder: "^([a-z0-9-]+\\.)?example\\.com$",
  },
  {
    key: "ruleSet",
    label: "Rule Set",
    helper: "Ссылка на внешний набор правил",
    placeholder: "Выберите Rule Set",
  },
  {
    key: "ipCidr",
    label: "CIDR назначения",
    helper: "IP подсеть назначения",
    placeholder: "8.8.8.0/24",
  },
  {
    key: "sourceIpCidr",
    label: "CIDR источника",
    helper: "IP подсеть источника",
    placeholder: "192.168.1.0/24",
  },
  {
    key: "port",
    label: "Порт назначения",
    helper: "Один порт назначения",
    placeholder: "443",
  },
  {
    key: "portRange",
    label: "Диапазон портов назначения",
    helper: "Формат: 1000:2000",
    placeholder: "1000:2000",
  },
  {
    key: "sourcePort",
    label: "Порт источника",
    helper: "Один порт источника",
    placeholder: "5353",
  },
  {
    key: "sourcePortRange",
    label: "Диапазон портов источника",
    helper: "Формат: 3000:4000",
    placeholder: "3000:4000",
  },
];

const RULE_FIELD_ORDER = RULE_FIELD_DEFINITIONS.map((item) => item.key);
const RULE_FIELD_BY_KEY = new Map(RULE_FIELD_DEFINITIONS.map((item) => [item.key, item]));

const EMPTY_CONFIG_TEMPLATE: RulesUpdateConfig = {
  ruleSet: [],
  domain: [],
  domainSuffix: [],
  domainKeyword: [],
  domainRegex: [],
  ipCidr: [],
  sourceIpCidr: [],
  sourcePort: [],
  sourcePortRange: [],
  port: [],
  portRange: [],
};

const DEFAULT_NEW_ENTRY: NewRuleValueDraft = {
  field: "domainSuffix",
  value: "",
};

function cloneConfig(config: RulesUpdateConfig): RulesUpdateConfig {
  return {
    ruleSet: [...config.ruleSet],
    domain: [...config.domain],
    domainSuffix: [...config.domainSuffix],
    domainKeyword: [...config.domainKeyword],
    domainRegex: [...config.domainRegex],
    ipCidr: [...config.ipCidr],
    sourceIpCidr: [...config.sourceIpCidr],
    sourcePort: [...config.sourcePort],
    sourcePortRange: [...config.sourcePortRange],
    port: [...config.port],
    portRange: [...config.portRange],
  };
}

function toRouteEditClass(value: string): RouteEditClass {
  if (value === "direct" || value === "block") {
    return value;
  }
  return "proxy";
}

function toOutboundNodeFromTag(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("cfg-") && trimmed.endsWith("-out") && trimmed.length > 8) {
    return trimmed.slice(4, -4);
  }
  if (trimmed.endsWith("-out") && trimmed.length > 4) {
    return trimmed.slice(0, -4);
  }
  return trimmed;
}

function createRuleDraft(rule: RoutingRuleView): RuleDraft {
  const config = cloneConfig(toRuleUpdateConfig(rule));
  const outboundClass = toRouteEditClass(rule.outbound.class || "proxy");
  const outboundNode =
    outboundClass === "proxy"
      ? (rule.outbound.uciTag || toOutboundNodeFromTag(rule.outbound.tag || "")).trim()
      : "";

  return {
    id: rule.id,
    tag: rule.tag,
    name: rule.name,
    enabled: Boolean(rule.enabled),
    priority: Number.isFinite(rule.priority) ? Number(rule.priority) : 0,
    config,
    outboundClass,
    outboundNode,
  };
}

function createRuleSetDraft(item: RuleSetListItem): RuleSetDraft {
  return {
    id: item.id,
    name: item.name,
    format: item.format || "binary",
    url: item.url || "",
    outbound: normalizeOutboundTarget(item.outbound || "direct"),
    updateInterval: item.updateInterval || "1d",
  };
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function listDiffCount(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let diff = 0;
  for (const item of leftSet) {
    if (!rightSet.has(item)) diff += 1;
  }
  for (const item of rightSet) {
    if (!leftSet.has(item)) diff += 1;
  }
  return diff;
}

function configsEqual(left: RulesUpdateConfig, right: RulesUpdateConfig): boolean {
  return RULE_FIELD_ORDER.every((key) => arraysEqual(left[key], right[key]));
}

function countRuleDraftBaseChanges(base: RuleDraft, draft: RuleDraft): number {
  let diff = 0;
  if (base.name !== draft.name) {
    diff += 1;
  }
  if (base.enabled !== draft.enabled) {
    diff += 1;
  }
  for (const key of RULE_FIELD_ORDER) {
    diff += listDiffCount(base.config[key], draft.config[key]);
  }
  if (base.outboundClass !== draft.outboundClass || base.outboundNode !== draft.outboundNode) {
    diff += 1;
  }
  return diff;
}

function countRuleDraftChanges(base: RuleDraft, draft: RuleDraft, draftPriority: number): number {
  let diff = countRuleDraftBaseChanges(base, draft);
  if (base.priority !== draftPriority) {
    diff += 1;
  }
  return diff;
}

function countRuleSetDraftChanges(base: RuleSetDraft, draft: RuleSetDraft): number {
  let diff = 0;
  if (base.name !== draft.name) diff += 1;
  if (base.format !== draft.format) diff += 1;
  if (base.url !== draft.url) diff += 1;
  if (normalizeOutboundTarget(base.outbound) !== normalizeOutboundTarget(draft.outbound)) diff += 1;
  if (base.updateInterval !== draft.updateInterval) diff += 1;
  return diff;
}

function isValidPortValue(value: string): boolean {
  if (!/^\d{1,5}$/.test(value)) return false;
  const parsed = Number.parseInt(value, 10);
  return parsed >= 1 && parsed <= 65535;
}

function normalizePortRange(value: string): string | null {
  const clean = value.replace(/\s+/g, "").replace(/-/g, ":");
  const parts = clean.split(":");
  if (parts.length !== 2) return null;

  const [from, to] = parts;
  if (!isValidPortValue(from) || !isValidPortValue(to)) return null;

  const fromNum = Number.parseInt(from, 10);
  const toNum = Number.parseInt(to, 10);
  if (fromNum > toNum) return null;

  return `${fromNum}:${toNum}`;
}

function normalizeIpOrCidr(value: string): string | null {
  const clean = value.trim();
  if (!clean) return null;
  if (/^[-.:%0-9a-fA-F]+\/\d{1,3}$/.test(clean)) {
    return clean;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(clean)) {
    const parts = clean.split(".").map((part) => Number.parseInt(part, 10));
    if (parts.length === 4 && parts.every((part) => Number.isFinite(part) && part >= 0 && part <= 255)) {
      return `${parts.join(".")}/32`;
    }
    return null;
  }

  if (/^[0-9a-fA-F:]+$/.test(clean) && clean.includes(":")) {
    return `${clean}/128`;
  }

  return null;
}

function normalizeRuleFieldValue(
  field: RuleFieldKey,
  rawValue: string,
  ruleSetIds: Set<string>,
): { value: string | null; error: string } {
  const value = rawValue.trim();

  if (field === "ruleSet") {
    if (!value) return { value: null, error: "Выберите Rule Set." };
    if (!ruleSetIds.has(value)) return { value: null, error: "Rule Set не найден." };
    return { value, error: "" };
  }

  if (!value) return { value: null, error: "Значение не может быть пустым." };

  if (field === "domain" || field === "domainSuffix") {
    const normalized = normalizeDomain(field === "domainSuffix" ? value.replace(/^\*\./, "") : value);
    if (!normalized) return { value: null, error: "Некорректный домен." };
    return { value: normalized, error: "" };
  }

  if (field === "domainRegex") {
    try {
      // eslint-disable-next-line no-new
      new RegExp(value);
      return { value, error: "" };
    } catch {
      return { value: null, error: "Некорректное регулярное выражение." };
    }
  }

  if (field === "ipCidr" || field === "sourceIpCidr") {
    const normalized = normalizeIpOrCidr(value);
    if (!normalized) return { value: null, error: "Некорректный IP/CIDR." };
    return { value: normalized, error: "" };
  }

  if (field === "port" || field === "sourcePort") {
    if (!isValidPortValue(value)) {
      return { value: null, error: "Порт должен быть в диапазоне 1-65535." };
    }
    return { value: String(Number.parseInt(value, 10)), error: "" };
  }

  if (field === "portRange" || field === "sourcePortRange") {
    const normalized = normalizePortRange(value);
    if (!normalized) {
      return { value: null, error: "Диапазон должен быть в формате 1000:2000." };
    }
    return { value: normalized, error: "" };
  }

  return { value, error: "" };
}

function normalizeOutboundTarget(value: string): string {
  const clean = value.trim();
  if (!clean || clean === "direct" || clean === "direct-out") return "direct";
  if (clean === "block" || clean === "block-out") return "block";
  if (clean.startsWith("cfg-") && clean.endsWith("-out") && clean.length > 8) {
    return clean.slice(4, -4);
  }
  return clean;
}

function toRuleSetOutboundValue(value: string): string {
  const normalized = normalizeOutboundTarget(value);
  if (normalized === "direct") return "direct";
  if (normalized === "block") return "block";
  return normalized;
}

function sanitizeIdentifier(value: string, fallback = "item"): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function nextUniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    return base;
  }
  let index = 2;
  while (used.has(`${base}_${index}`)) {
    index += 1;
  }
  return `${base}_${index}`;
}

function sortValues(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatRuleValue(field: RuleFieldKey, value: string, ruleSetNames: Map<string, string>): string {
  if (field === "ruleSet") {
    const name = ruleSetNames.get(value);
    return name || value;
  }
  return value;
}

function pendingRuleKey(tempId: string): string {
  return `new:${tempId}`;
}

function pendingRuleTempId(itemKey: string): string {
  return itemKey.slice(4);
}

function isPendingRuleItemKey(itemKey: string): boolean {
  return itemKey.startsWith("new:");
}

export const RulesTab = forwardRef<RulesWorkspaceController, Props>(function RulesTab(
  {
    rules,
    routingNodes,
    ruleSets,
    devices,
    onApplyChanges,
    onMatchRuleSets,
    onSummaryChange,
  }: Props,
  ref,
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const ruleSetMatchRequestRef = useRef(0);
  const [section, setSection] = useState<WorkspaceSection>("rules");
  const [expandedRuleId, setExpandedRuleId] = useState("");
  const [expandedRuleSetId, setExpandedRuleSetId] = useState("");
  const [expandedNodeId, setExpandedNodeId] = useState("");

  const [ruleDrafts, setRuleDrafts] = useState<Record<string, RuleDraft>>({});
  const [ruleOrder, setRuleOrder] = useState<string[]>([]);
  const [ruleVisualOrder, setRuleVisualOrder] = useState<string[]>([]);
  const [newRuleEntries, setNewRuleEntries] = useState<Record<string, NewRuleValueDraft>>({});
  const [pendingRuleCreates, setPendingRuleCreates] = useState<RuleCreateDraft[]>([]);
  const [newPendingRuleEntries, setNewPendingRuleEntries] = useState<Record<string, NewRuleValueDraft>>({});
  const [pendingRuleDeletes, setPendingRuleDeletes] = useState<Set<string>>(new Set());
  const [showRuleCreateForm, setShowRuleCreateForm] = useState(false);
  const [activeDragRuleId, setActiveDragRuleId] = useState("");
  const [dragPreviewOrder, setDragPreviewOrder] = useState<string[] | null>(null);
  const [priorityDraggedRuleIds, setPriorityDraggedRuleIds] = useState<Set<string>>(new Set());
  const rulesListRef = useRef<HTMLDivElement | null>(null);
  const ruleItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const ruleReorderAnimationsRef = useRef<Record<string, Animation | null>>({});
  const pendingFlipPositionsRef = useRef<Map<string, number> | null>(null);
  const pendingActiveTopRef = useRef<number | null>(null);
  const dragSessionRef = useRef<RuleDragSession | null>(null);

  const [nodeRenameDrafts, setNodeRenameDrafts] = useState<Record<string, string>>({});
  const [showNodeCreateForm, setShowNodeCreateForm] = useState(false);
  const [pendingNodeCreates, setPendingNodeCreates] = useState<PendingNodeCreateDraft[]>([]);
  const [pendingNodeDeletes, setPendingNodeDeletes] = useState<Set<string>>(new Set());

  const [ruleSetDrafts, setRuleSetDrafts] = useState<Record<string, RuleSetDraft>>({});
  const [pendingRuleSetCreates, setPendingRuleSetCreates] = useState<RuleSetCreateDraft[]>([]);
  const [pendingRuleSetDeletes, setPendingRuleSetDeletes] = useState<Set<string>>(new Set());
  const [showRuleSetCreateForm, setShowRuleSetCreateForm] = useState(false);
  const [showRuleSetMatchForm, setShowRuleSetMatchForm] = useState(false);
  const [ruleSetMatchQuery, setRuleSetMatchQuery] = useState("");
  const [ruleSetMatchBusy, setRuleSetMatchBusy] = useState(false);
  const [ruleSetMatchedIds, setRuleSetMatchedIds] = useState<Set<string> | null>(null);

  const [ruleCreateDraft, setRuleCreateDraft] = useState<RuleCreateDraft>({
    tempId: "",
    id: "",
    name: "",
    enabled: true,
    outboundClass: "direct",
    outboundNode: "",
    config: cloneConfig(EMPTY_CONFIG_TEMPLATE),
  });
  const [ruleCreateEntryDraft, setRuleCreateEntryDraft] = useState<NewRuleValueDraft>(DEFAULT_NEW_ENTRY);
  const [nodeCreateDraft, setNodeCreateDraft] = useState<NodeCreateDraft>({ name: "", key: "", outbound: "direct" });
  const [ruleSetCreateDraft, setRuleSetCreateDraft] = useState<RuleSetCreateDraft>({
    tempId: "",
    id: "",
    name: "",
    format: "binary",
    url: "",
    outbound: "direct",
    updateInterval: "1d",
  });

  const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({});

  const rulesById = useMemo(() => new Map(rules.map((rule) => [rule.id, rule])), [rules]);

  const orderedRules = useMemo(() => {
    const ordered: RoutingRuleView[] = [];
    const appended = new Set<string>();

    for (const ruleId of ruleOrder) {
      const rule = rulesById.get(ruleId);
      if (!rule) continue;
      ordered.push(rule);
      appended.add(ruleId);
    }

    for (const rule of rules) {
      if (appended.has(rule.id)) continue;
      ordered.push(rule);
    }

    return ordered;
  }, [ruleOrder, rules, rulesById]);

  const sortedNodes = useMemo(
    () => [...routingNodes].sort((a, b) => a.name.localeCompare(b.name)),
    [routingNodes],
  );

  const sortedRuleSets = useMemo(
    () => [...ruleSets].sort((a, b) => a.name.localeCompare(b.name)),
    [ruleSets],
  );

  const visibleRules = useMemo(
    () => orderedRules.filter((rule) => !pendingRuleDeletes.has(rule.id)),
    [orderedRules, pendingRuleDeletes],
  );

  const visibleRuleItems = useMemo<RuleListItem[]>(() => {
    const pendingMap = new Map(pendingRuleCreates.map((draft) => [pendingRuleKey(draft.tempId), draft]));
    const existingMap = new Map(visibleRules.map((rule) => [rule.id, rule]));
    const ordered: RuleListItem[] = [];
    const added = new Set<string>();

    const appendByKey = (itemKey: string) => {
      if (added.has(itemKey)) return;

      const pendingDraft = pendingMap.get(itemKey);
      if (pendingDraft) {
        ordered.push({
          kind: "pending",
          key: itemKey,
          draft: pendingDraft,
        });
        added.add(itemKey);
        return;
      }

      const rule = existingMap.get(itemKey);
      if (!rule) return;
      ordered.push({
        kind: "existing",
        key: itemKey,
        rule,
      });
      added.add(itemKey);
    };

    for (const itemKey of ruleVisualOrder) {
      appendByKey(itemKey);
    }
    for (const draft of pendingRuleCreates) {
      appendByKey(pendingRuleKey(draft.tempId));
    }
    for (const rule of visibleRules) {
      appendByKey(rule.id);
    }

    return ordered;
  }, [pendingRuleCreates, ruleVisualOrder, visibleRules]);

  const renderedVisibleRuleItems = useMemo(() => {
    if (!dragPreviewOrder?.length) {
      return visibleRuleItems;
    }

    const itemsMap = new Map(visibleRuleItems.map((item) => [item.key, item]));
    const ordered: RuleListItem[] = [];
    const added = new Set<string>();

    for (const itemKey of dragPreviewOrder) {
      const item = itemsMap.get(itemKey);
      if (!item) continue;
      ordered.push(item);
      added.add(itemKey);
    }

    for (const item of visibleRuleItems) {
      if (added.has(item.key)) continue;
      ordered.push(item);
    }

    return ordered;
  }, [dragPreviewOrder, visibleRuleItems]);

  const rulePriorityMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let index = 0; index < visibleRuleItems.length; index += 1) {
      map.set(visibleRuleItems[index].key, index);
    }
    return map;
  }, [visibleRuleItems]);

  const renderedPendingRuleCreates = useMemo(
    () => renderedVisibleRuleItems.filter((item): item is Extract<RuleListItem, { kind: "pending" }> => item.kind === "pending"),
    [renderedVisibleRuleItems],
  );

  const renderedVisibleRules = useMemo(
    () => renderedVisibleRuleItems.filter((item): item is Extract<RuleListItem, { kind: "existing" }> => item.kind === "existing"),
    [renderedVisibleRuleItems],
  );
  const renderedRuleOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    renderedVisibleRuleItems.forEach((item, index) => {
      map.set(item.key, index);
    });
    return map;
  }, [renderedVisibleRuleItems]);

  const visibleNodes = useMemo(
    () => sortedNodes.filter((node) => !pendingNodeDeletes.has(node.id)),
    [pendingNodeDeletes, sortedNodes],
  );

  const visibleRuleSets = useMemo(
    () => sortedRuleSets.filter((item) => !pendingRuleSetDeletes.has(item.id)),
    [pendingRuleSetDeletes, sortedRuleSets],
  );
  const filteredPendingRuleSetCreates = useMemo(() => {
    if (!ruleSetMatchedIds) {
      return pendingRuleSetCreates;
    }
    return pendingRuleSetCreates.filter((item) => ruleSetMatchedIds.has(item.id));
  }, [pendingRuleSetCreates, ruleSetMatchedIds]);
  const filteredVisibleRuleSets = useMemo(() => {
    if (!ruleSetMatchedIds) {
      return visibleRuleSets;
    }
    return visibleRuleSets.filter((item) => ruleSetMatchedIds.has(item.id));
  }, [ruleSetMatchedIds, visibleRuleSets]);
  const hasAnyRuleSetCards = visibleRuleSets.length > 0 || pendingRuleSetCreates.length > 0;

  const baseRuleDrafts = useMemo(() => {
    const map: Record<string, RuleDraft> = {};
    for (const rule of rules) {
      map[rule.id] = createRuleDraft(rule);
    }
    return map;
  }, [rules]);

  const baseRuleSetDrafts = useMemo(() => {
    const map: Record<string, RuleSetDraft> = {};
    for (const item of ruleSets) {
      map[item.id] = createRuleSetDraft(item);
    }
    return map;
  }, [ruleSets]);

  const activeRuleSets = useMemo(() => {
    const list = sortedRuleSets
      .filter((item) => !pendingRuleSetDeletes.has(item.id))
      .map((item) => ({ id: item.id, name: item.name }));

    for (const created of pendingRuleSetCreates) {
      list.push({ id: created.id, name: created.name });
    }

    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [pendingRuleSetCreates, pendingRuleSetDeletes, sortedRuleSets]);

  const activeRuleSetIdSet = useMemo(() => new Set(activeRuleSets.map((item) => item.id)), [activeRuleSets]);

  const ruleSetNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of sortedRuleSets) {
      map.set(item.id, item.name);
    }
    for (const item of pendingRuleSetCreates) {
      map.set(item.id, item.name);
    }
    return map;
  }, [pendingRuleSetCreates, sortedRuleSets]);

  const activeNodeOptions = useMemo(() => {
    const list = sortedNodes
      .filter((item) => !pendingNodeDeletes.has(item.id))
      .map((item) => ({
        id: item.id,
        name: (nodeRenameDrafts[item.id] ?? item.name).trim() || item.name,
      }));

    for (const created of pendingNodeCreates) {
      list.push({ id: created.id, name: created.name });
    }

    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [nodeRenameDrafts, pendingNodeCreates, pendingNodeDeletes, sortedNodes]);

  const activeNodeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of activeNodeOptions) {
      map.set(item.id, item.name);
    }
    return map;
  }, [activeNodeOptions]);

  const activeNodeIdSet = useMemo(() => new Set(activeNodeOptions.map((item) => item.id)), [activeNodeOptions]);
  const sourceIpDevices = useMemo(
    () =>
      devices
        .filter((device) => Boolean(device.ip?.trim()) && !device.expired)
        .sort((left, right) => {
          const byName = left.name.localeCompare(right.name);
          if (byName !== 0) return byName;
          return left.ip.localeCompare(right.ip, undefined, { numeric: true });
        }),
    [devices],
  );

  function applyVisibleRuleOrder(nextVisibleOrder: string[]) {
    setRuleVisualOrder((prev) => (arraysEqual(prev, nextVisibleOrder) ? prev : nextVisibleOrder));

    setRuleOrder((prev) => {
      const normalized = prev.filter((id) => rulesById.has(id));
      const visibleCurrent = normalized.filter((id) => !pendingRuleDeletes.has(id));
      const targetVisible = nextVisibleOrder.filter((id) => !isPendingRuleItemKey(id) && visibleCurrent.includes(id));

      if (targetVisible.length !== visibleCurrent.length || arraysEqual(visibleCurrent, targetVisible)) {
        return prev;
      }

      const visibleSet = new Set(visibleCurrent);
      let cursor = 0;
      const next = normalized.map((id) => {
        if (!visibleSet.has(id)) return id;
        const replacement = targetVisible[cursor];
        cursor += 1;
        return replacement;
      });

      if (arraysEqual(normalized, next)) {
        return prev;
      }
      return next;
    });

    setPendingRuleCreates((prev) => {
      const map = new Map(prev.map((item) => [item.tempId, item]));
      const reordered: RuleCreateDraft[] = [];
      const added = new Set<string>();

      for (const itemKey of nextVisibleOrder) {
        if (!isPendingRuleItemKey(itemKey)) continue;
        const tempId = pendingRuleTempId(itemKey);
        const draft = map.get(tempId);
        if (!draft || added.has(tempId)) continue;
        reordered.push(draft);
        added.add(tempId);
      }

      for (const item of prev) {
        if (added.has(item.tempId)) continue;
        reordered.push(item);
      }

      if (
        reordered.length === prev.length &&
        reordered.every((item, index) => item.tempId === prev[index]?.tempId)
      ) {
        return prev;
      }
      return reordered;
    });
  }

  function registerRulesListRef(node: HTMLDivElement | null) {
    rulesListRef.current = node;
  }

  function registerRuleItemRef(ruleId: string, node: HTMLDivElement | null) {
    ruleItemRefs.current[ruleId] = node;
  }

  function captureRuleTopPositions(ruleIds: string[]): Map<string, number> {
    const positions = new Map<string, number>();
    for (const ruleId of ruleIds) {
      const node = ruleItemRefs.current[ruleId];
      if (!node) continue;
      positions.set(ruleId, node.getBoundingClientRect().top);
    }
    return positions;
  }

  function clearActiveRuleDragStyles(session: RuleDragSession | null) {
    if (!session?.activeNode) return;
    session.activeNode.style.transform = "";
    session.activeNode.style.willChange = "";
  }

  function stopRulePointerDrag(commit = false) {
    const session = dragSessionRef.current;
    if (commit && session) {
      applyVisibleRuleOrder(session.previewOrder);
      if (!isPendingRuleItemKey(session.activeId)) {
        setPriorityDraggedRuleIds((prev) => {
          if (prev.has(session.activeId)) return prev;
          const next = new Set(prev);
          next.add(session.activeId);
          return next;
        });
      }
    }

    clearActiveRuleDragStyles(session);
    dragSessionRef.current = null;
    pendingFlipPositionsRef.current = null;
    pendingActiveTopRef.current = null;
    setActiveDragRuleId("");
    setDragPreviewOrder(null);
  }

  function updateRulePreviewFromPointer(session: RuleDragSession) {
    const clampedOffset = clampValue(session.latestClientY - session.startY, session.minOffset, session.maxOffset);
    session.activeNode.style.transform = `translate3d(0, ${clampedOffset}px, 0)`;
    session.activeNode.style.willChange = "transform";

    const activeIndex = session.previewOrder.indexOf(session.activeId);
    if (activeIndex < 0) return;

    const activeRect = session.activeNode.getBoundingClientRect();
    const OVERLAP_TRIGGER = 0.9;
    let swapWithId = "";

    if (clampedOffset > 0 && activeIndex < session.previewOrder.length - 1) {
      const nextId = session.previewOrder[activeIndex + 1];
      const nextNode = ruleItemRefs.current[nextId];
      if (nextNode) {
        const nextRect = nextNode.getBoundingClientRect();
        const overlapRatio = (activeRect.bottom - nextRect.top) / Math.max(nextRect.height, 1);
        if (overlapRatio >= OVERLAP_TRIGGER) {
          swapWithId = nextId;
        }
      }
    }

    if (!swapWithId && clampedOffset < 0 && activeIndex > 0) {
      const prevId = session.previewOrder[activeIndex - 1];
      const prevNode = ruleItemRefs.current[prevId];
      if (prevNode) {
        const prevRect = prevNode.getBoundingClientRect();
        const overlapRatio = (prevRect.bottom - activeRect.top) / Math.max(prevRect.height, 1);
        if (overlapRatio >= OVERLAP_TRIGGER) {
          swapWithId = prevId;
        }
      }
    }

    if (!swapWithId) return;

    const nextPreview = [...session.previewOrder];
    const fromIndex = nextPreview.indexOf(session.activeId);
    const toIndex = nextPreview.indexOf(swapWithId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    nextPreview[fromIndex] = swapWithId;
    nextPreview[toIndex] = session.activeId;

    const siblings = session.previewOrder.filter((id) => id !== session.activeId);
    pendingFlipPositionsRef.current = captureRuleTopPositions(siblings);
    pendingActiveTopRef.current = activeRect.top;
    session.previewOrder = nextPreview;
    setDragPreviewOrder(nextPreview);
  }

  function scheduleRulePointerMove(pointerId: number, clientY: number) {
    const session = dragSessionRef.current;
    if (!session || pointerId !== session.pointerId) return;

    session.latestClientY = clientY;
    if (session.framePending) return;

    session.framePending = true;
    requestAnimationFrame(() => {
      const live = dragSessionRef.current;
      if (!live || live.pointerId !== pointerId) return;
      live.framePending = false;
      updateRulePreviewFromPointer(live);
    });
  }

  function completeRulePointerDrag(pointerId: number, commit: boolean): boolean {
    const session = dragSessionRef.current;
    if (!session || pointerId !== session.pointerId) return false;
    stopRulePointerDrag(commit);
    return true;
  }

  function handleRuleHandlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = dragSessionRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    if (event.buttons === 0) {
      completeRulePointerDrag(event.pointerId, true);
      return;
    }

    event.preventDefault();
    scheduleRulePointerMove(event.pointerId, event.clientY);
  }

  function handleRuleHandlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = dragSessionRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    completeRulePointerDrag(event.pointerId, true);
  }

  function handleRuleHandlePointerDown(ruleId: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    if (dragSessionRef.current) {
      stopRulePointerDrag(false);
    }

    const listNode = rulesListRef.current;
    const itemNode = ruleItemRefs.current[ruleId];
    if (!listNode || !itemNode) return;

    const previewOrder = renderedVisibleRuleItems.map((item) => item.key);
    const itemRect = itemNode.getBoundingClientRect();
    const listRect = listNode.getBoundingClientRect();

    dragSessionRef.current = {
      activeId: ruleId,
      activeNode: itemNode,
      pointerId: event.pointerId,
      startY: event.clientY,
      latestClientY: event.clientY,
      framePending: false,
      minOffset: listRect.top - itemRect.top,
      maxOffset: listRect.bottom - itemRect.bottom,
      previewOrder,
    };

    setActiveDragRuleId(ruleId);
    setDragPreviewOrder(previewOrder);
    clearError();

    event.preventDefault();
    event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
  }

  useEffect(() => {
    if (activeDragRuleId && !visibleRuleItems.some((item) => item.key === activeDragRuleId)) {
      stopRulePointerDrag(false);
    }
  }, [activeDragRuleId, visibleRuleItems]);

  useEffect(() => {
    if (!activeDragRuleId) return;

    const handleWindowPointerMove = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      if (event.buttons === 0) {
        completeRulePointerDrag(event.pointerId, true);
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }
      scheduleRulePointerMove(event.pointerId, event.clientY);
    };

    const handleWindowPointerUp = (event: PointerEvent) => {
      completeRulePointerDrag(event.pointerId, true);
    };

    const handleWindowPointerCancel = (event: PointerEvent) => {
      completeRulePointerDrag(event.pointerId, true);
    };

    const handleWindowBlur = () => {
      if (dragSessionRef.current) {
        stopRulePointerDrag(true);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" && dragSessionRef.current) {
        stopRulePointerDrag(true);
      }
    };

    window.addEventListener("pointermove", handleWindowPointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", handleWindowPointerUp, true);
    window.addEventListener("pointercancel", handleWindowPointerCancel, true);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove, true);
      window.removeEventListener("pointerup", handleWindowPointerUp, true);
      window.removeEventListener("pointercancel", handleWindowPointerCancel, true);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeDragRuleId]);

  useEffect(() => {
    if (!activeDragRuleId) {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      return;
    }

    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [activeDragRuleId]);

  useLayoutEffect(() => {
    const beforePositions = pendingFlipPositionsRef.current;
    const activeTopBefore = pendingActiveTopRef.current;
    pendingFlipPositionsRef.current = null;
    pendingActiveTopRef.current = null;

    if (beforePositions) {
      for (const [ruleId, beforeTop] of beforePositions) {
        const node = ruleItemRefs.current[ruleId];
        if (!node) continue;

        const afterTop = node.getBoundingClientRect().top;
        const deltaY = beforeTop - afterTop;
        if (Math.abs(deltaY) < 0.5) continue;

        const activeAnimation = ruleReorderAnimationsRef.current[ruleId];
        if (activeAnimation) {
          activeAnimation.cancel();
        }

        const animation = node.animate(
          [{ transform: `translate3d(0, ${deltaY}px, 0)` }, { transform: "translate3d(0, 0, 0)" }],
          {
            duration: 145,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          },
        );

        ruleReorderAnimationsRef.current[ruleId] = animation;
        animation.onfinish = () => {
          if (ruleReorderAnimationsRef.current[ruleId] === animation) {
            ruleReorderAnimationsRef.current[ruleId] = null;
          }
        };
        animation.oncancel = () => {
          if (ruleReorderAnimationsRef.current[ruleId] === animation) {
            ruleReorderAnimationsRef.current[ruleId] = null;
          }
        };
      }
    }

    const session = dragSessionRef.current;
    if (!session || activeTopBefore === null) return;

    const activeTopAfter = session.activeNode.getBoundingClientRect().top;
    const topShift = activeTopAfter - activeTopBefore;
    if (Math.abs(topShift) < 0.5) return;

    session.startY += topShift;
    session.minOffset -= topShift;
    session.maxOffset -= topShift;
    const compensatedOffset = clampValue(session.latestClientY - session.startY, session.minOffset, session.maxOffset);
    session.activeNode.style.transform = `translate3d(0, ${compensatedOffset}px, 0)`;
  }, [dragPreviewOrder]);

  useEffect(() => {
    return () => {
      clearActiveRuleDragStyles(dragSessionRef.current);
      dragSessionRef.current = null;
      for (const animation of Object.values(ruleReorderAnimationsRef.current)) {
        animation?.cancel();
      }
      ruleReorderAnimationsRef.current = {};
    };
  }, []);

  useEffect(() => {
    setRuleDrafts(baseRuleDrafts);
    setRuleOrder(rules.map((rule) => rule.id));
    setRuleVisualOrder(rules.map((rule) => rule.id));
    setNewRuleEntries({});
    setPendingRuleCreates([]);
    setNewPendingRuleEntries({});
    setPendingRuleDeletes(new Set());
    setActiveDragRuleId("");
    setDragPreviewOrder(null);
    setPriorityDraggedRuleIds(new Set());
    setExpandedRuleId("");
    setRuleCreateDraft({
      tempId: "",
      id: "",
      name: "",
      enabled: true,
      outboundClass: "direct",
      outboundNode: activeNodeOptions[0]?.id || "",
      config: cloneConfig(EMPTY_CONFIG_TEMPLATE),
    });
  }, [activeNodeOptions, baseRuleDrafts, rules]);

  useEffect(() => {
    const map: Record<string, string> = {};
    for (const node of routingNodes) {
      map[node.id] = node.name;
    }
    setNodeRenameDrafts(map);
    setPendingNodeCreates([]);
    setPendingNodeDeletes(new Set());
    setExpandedNodeId("");
    setNodeCreateDraft({ name: "", key: "", outbound: "direct" });
  }, [routingNodes]);

  useEffect(() => {
    setRuleSetDrafts(baseRuleSetDrafts);
    setPendingRuleSetCreates([]);
    setPendingRuleSetDeletes(new Set());
    setExpandedRuleSetId("");
    setRuleSetCreateDraft({
      tempId: "",
      id: "",
      name: "",
      format: "binary",
      url: "",
      outbound: "direct",
      updateInterval: "1d",
    });
  }, [baseRuleSetDrafts]);

  useEffect(() => {
    if (!ruleSetMatchedIds) return;

    const available = new Set<string>([
      ...sortedRuleSets.map((item) => item.id),
      ...pendingRuleSetCreates.map((item) => item.id),
    ]);
    const next = new Set<string>();
    for (const id of ruleSetMatchedIds) {
      if (available.has(id)) {
        next.add(id);
      }
    }
    if (next.size === ruleSetMatchedIds.size) {
      return;
    }
    setRuleSetMatchedIds(next);
  }, [pendingRuleSetCreates, ruleSetMatchedIds, sortedRuleSets]);

  useEffect(() => {
    setRuleVisualOrder((prev) => {
      const available = new Set<string>([
        ...visibleRules.map((rule) => rule.id),
        ...pendingRuleCreates.map((draft) => pendingRuleKey(draft.tempId)),
      ]);
      const next = prev.filter((itemKey) => available.has(itemKey));
      const seen = new Set(next);

      for (const rule of visibleRules) {
        if (seen.has(rule.id)) continue;
        next.push(rule.id);
        seen.add(rule.id);
      }
      for (const draft of pendingRuleCreates) {
        const itemKey = pendingRuleKey(draft.tempId);
        if (seen.has(itemKey)) continue;
        next.push(itemKey);
        seen.add(itemKey);
      }

      return arraysEqual(prev, next) ? prev : next;
    });
  }, [pendingRuleCreates, visibleRules]);

  useEffect(() => {
    const scrollHost = rootRef.current?.parentElement;
    if (scrollHost) {
      scrollHost.scrollTo({ top: 0, behavior: "auto" });
    }

    if (section !== "rules") {
      setShowRuleCreateForm(false);
    }
    if (section !== "nodes") {
      setShowNodeCreateForm(false);
    }
    if (section !== "ruleSets") {
      setShowRuleSetCreateForm(false);
    }
  }, [section]);

  useEffect(() => {
    if (expandedRuleId && pendingRuleDeletes.has(expandedRuleId)) {
      setExpandedRuleId("");
    }
  }, [expandedRuleId, pendingRuleDeletes]);

  useEffect(() => {
    if (!expandedRuleId.startsWith("new:")) return;
    const tempId = expandedRuleId.slice(4);
    const exists = pendingRuleCreates.some((item) => item.tempId === tempId);
    if (!exists) {
      setExpandedRuleId("");
    }
  }, [expandedRuleId, pendingRuleCreates]);

  useEffect(() => {
    if (expandedRuleSetId && !expandedRuleSetId.startsWith("new:") && pendingRuleSetDeletes.has(expandedRuleSetId)) {
      setExpandedRuleSetId("");
    }
  }, [expandedRuleSetId, pendingRuleSetDeletes]);

  useEffect(() => {
    if (expandedNodeId && !expandedNodeId.startsWith("new:") && pendingNodeDeletes.has(expandedNodeId)) {
      setExpandedNodeId("");
    }
  }, [expandedNodeId, pendingNodeDeletes]);

  function clearError(key?: string) {
    if (!key) {
      setFieldErrors((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function readFieldError(key: string): string {
    return fieldErrors[key] || "";
  }

  function reportError(message: string, key = "global") {
    setFieldErrors({ [key]: message });
  }

  function ruleNameErrorKey(ruleId: string): string {
    return `rule:${ruleId}:name`;
  }

  function ruleOutboundErrorKey(ruleId: string): string {
    return `rule:${ruleId}:outbound`;
  }

  function ruleEntryErrorKey(ruleId: string): string {
    return `rule:${ruleId}:entry`;
  }

  function pendingRuleNameErrorKey(tempId: string): string {
    return `pending-rule:${tempId}:name`;
  }

  function pendingRuleOutboundErrorKey(tempId: string): string {
    return `pending-rule:${tempId}:outbound`;
  }

  function pendingRuleEntryErrorKey(tempId: string): string {
    return `pending-rule:${tempId}:entry`;
  }

  function nodeRenameErrorKey(nodeId: string): string {
    return `node:${nodeId}:name`;
  }

  function pendingNodeNameErrorKey(tempId: string): string {
    return `pending-node:${tempId}:name`;
  }

  function pendingNodeKeyErrorKey(tempId: string): string {
    return `pending-node:${tempId}:key`;
  }

  function ruleSetNameErrorKey(ruleSetId: string): string {
    return `ruleset:${ruleSetId}:name`;
  }

  function ruleSetUrlErrorKey(ruleSetId: string): string {
    return `ruleset:${ruleSetId}:url`;
  }

  function ruleSetMatchQueryErrorKey(): string {
    return "ruleset-match:query";
  }

  function ruleSetMatchSubmitErrorKey(): string {
    return "ruleset-match:submit";
  }

  function updateRuleDraft(ruleId: string, updater: (prev: RuleDraft) => RuleDraft) {
    setRuleDrafts((prev) => {
      const current = prev[ruleId];
      if (!current) return prev;
      return {
        ...prev,
        [ruleId]: updater(current),
      };
    });
  }

  function addRuleValue(ruleId: string) {
    const draft = ruleDrafts[ruleId];
    if (!draft) return;

    const entry = newRuleEntries[ruleId] ?? DEFAULT_NEW_ENTRY;
    const rawValue =
      entry.field === "ruleSet" && !entry.value.trim() ? activeRuleSets[0]?.id || "" : entry.value;
    const normalized = normalizeRuleFieldValue(entry.field, rawValue, activeRuleSetIdSet);

    if (!normalized.value) {
      reportError(normalized.error || "Некорректное значение.", ruleEntryErrorKey(ruleId));
      return;
    }

    clearError();
    updateRuleDraft(ruleId, (prev) => {
      const values = prev.config[entry.field];
      if (values.includes(normalized.value!)) {
        return prev;
      }
      return {
        ...prev,
        config: {
          ...prev.config,
          [entry.field]: [...values, normalized.value!],
        },
      };
    });

    setNewRuleEntries((prev) => ({
      ...prev,
      [ruleId]: {
        ...entry,
        value: entry.field === "ruleSet" ? rawValue : "",
      },
    }));
  }

  function removeRuleValue(ruleId: string, field: RuleFieldKey, value: string) {
    clearError();
    updateRuleDraft(ruleId, (prev) => ({
      ...prev,
      config: {
        ...prev.config,
        [field]: prev.config[field].filter((item) => item !== value),
      },
    }));
  }

  function addRuleCreateValue() {
    const rawValue =
      ruleCreateEntryDraft.field === "ruleSet" && !ruleCreateEntryDraft.value.trim()
        ? activeRuleSets[0]?.id || ""
        : ruleCreateEntryDraft.value;
    const normalized = normalizeRuleFieldValue(ruleCreateEntryDraft.field, rawValue, activeRuleSetIdSet);

    if (!normalized.value) {
      reportError(normalized.error || "Некорректное значение.", "rule-create:entry");
      return;
    }

    clearError();
    setRuleCreateDraft((prev) => {
      const values = prev.config[ruleCreateEntryDraft.field];
      if (values.includes(normalized.value!)) {
        return prev;
      }
      return {
        ...prev,
        config: {
          ...prev.config,
          [ruleCreateEntryDraft.field]: [...values, normalized.value!],
        },
      };
    });

    setRuleCreateEntryDraft((prev) => ({
      ...prev,
      value: prev.field === "ruleSet" ? rawValue : "",
    }));
  }

  function removeRuleCreateValue(field: RuleFieldKey, value: string) {
    clearError();
    setRuleCreateDraft((prev) => ({
      ...prev,
      config: {
        ...prev.config,
        [field]: prev.config[field].filter((item) => item !== value),
      },
    }));
  }

  function updatePendingRuleCreateDraft(tempId: string, updater: (prev: RuleCreateDraft) => RuleCreateDraft) {
    setPendingRuleCreates((prev) => prev.map((item) => (item.tempId === tempId ? updater(item) : item)));
  }

  function addPendingRuleValue(tempId: string) {
    const draft = pendingRuleCreates.find((item) => item.tempId === tempId);
    if (!draft) return;

    const entry = newPendingRuleEntries[tempId] ?? DEFAULT_NEW_ENTRY;
    const rawValue =
      entry.field === "ruleSet" && !entry.value.trim() ? activeRuleSets[0]?.id || "" : entry.value;
    const normalized = normalizeRuleFieldValue(entry.field, rawValue, activeRuleSetIdSet);

    if (!normalized.value) {
      reportError(normalized.error || "Некорректное значение.", pendingRuleEntryErrorKey(tempId));
      return;
    }

    clearError();
    updatePendingRuleCreateDraft(tempId, (prev) => {
      const values = prev.config[entry.field];
      if (values.includes(normalized.value!)) {
        return prev;
      }
      return {
        ...prev,
        config: {
          ...prev.config,
          [entry.field]: [...values, normalized.value!],
        },
      };
    });

    setNewPendingRuleEntries((prev) => ({
      ...prev,
      [tempId]: {
        ...entry,
        value: entry.field === "ruleSet" ? rawValue : "",
      },
    }));
  }

  function removePendingRuleValue(tempId: string, field: RuleFieldKey, value: string) {
    clearError();
    updatePendingRuleCreateDraft(tempId, (prev) => ({
      ...prev,
      config: {
        ...prev.config,
        [field]: prev.config[field].filter((item) => item !== value),
      },
    }));
  }

  const changedRulePatches = useMemo(() => {
    const patches: RuleEditPatch[] = [];
    for (const rule of rules) {
      if (pendingRuleDeletes.has(rule.id)) continue;
      const base = baseRuleDrafts[rule.id];
      const draft = ruleDrafts[rule.id];
      if (!base || !draft) continue;
      const hasNameChange = base.name.trim() !== draft.name.trim();
      const hasEnabledChange = base.enabled !== draft.enabled;
      const draftPriority = rulePriorityMap.get(rule.id) ?? draft.priority;
      const hasPriorityChange = priorityDraggedRuleIds.has(rule.id) && base.priority !== draftPriority;
      if (
        !hasNameChange &&
        !hasEnabledChange &&
        !hasPriorityChange &&
        configsEqual(base.config, draft.config) &&
        base.outboundClass === draft.outboundClass &&
        base.outboundNode === draft.outboundNode
      ) {
        continue;
      }
      patches.push({
        id: draft.id,
        tag: draft.tag,
        ...(hasNameChange ? { name: draft.name.trim() } : {}),
        ...(hasEnabledChange ? { enabled: draft.enabled } : {}),
        ...(hasPriorityChange ? { priority: draftPriority } : {}),
        config: cloneConfig(draft.config),
        outbound: {
          class: draft.outboundClass,
          ...(draft.outboundClass === "proxy" ? { node: draft.outboundNode.trim() } : {}),
        },
      });
    }
    return patches;
  }, [baseRuleDrafts, pendingRuleDeletes, priorityDraggedRuleIds, ruleDrafts, rulePriorityMap, rules]);

  const changedRuleCount = useMemo(() => {
    let diff = 0;
    for (const rule of rules) {
      if (pendingRuleDeletes.has(rule.id)) continue;
      const base = baseRuleDrafts[rule.id];
      const draft = ruleDrafts[rule.id];
      if (!base || !draft) continue;
      const currentPriority = rulePriorityMap.get(rule.id) ?? draft.priority;
      const draftPriority = priorityDraggedRuleIds.has(rule.id) ? currentPriority : base.priority;
      diff += countRuleDraftChanges(base, draft, draftPriority);
    }
    return diff;
  }, [baseRuleDrafts, pendingRuleDeletes, priorityDraggedRuleIds, ruleDrafts, rulePriorityMap, rules]);

  const nodeRenameChanges = useMemo(() => {
    const changes: Array<{ id: string; name: string }> = [];
    for (const node of routingNodes) {
      if (pendingNodeDeletes.has(node.id)) continue;
      const draftName = nodeRenameDrafts[node.id] ?? node.name;
      if (draftName === node.name) continue;
      changes.push({ id: node.id, name: draftName });
    }
    return changes;
  }, [nodeRenameDrafts, pendingNodeDeletes, routingNodes]);

  const ruleSetUpdateChanges = useMemo(() => {
    const changes: RuleSetUpdateRequest[] = [];
    for (const item of ruleSets) {
      if (pendingRuleSetDeletes.has(item.id)) continue;
      const base = baseRuleSetDrafts[item.id];
      const draft = ruleSetDrafts[item.id];
      if (!base || !draft) continue;
      if (countRuleSetDraftChanges(base, draft) === 0) continue;
      changes.push({
        id: item.id,
        name: draft.name,
        format: draft.format,
        url: draft.url,
        outbound: toRuleSetOutboundValue(draft.outbound),
        updateInterval: draft.updateInterval,
      });
    }
    return changes;
  }, [baseRuleSetDrafts, pendingRuleSetDeletes, ruleSetDrafts, ruleSets]);

  const ruleSetUpdateCount = useMemo(() => {
    let diff = 0;
    for (const item of ruleSets) {
      if (pendingRuleSetDeletes.has(item.id)) continue;
      const base = baseRuleSetDrafts[item.id];
      const draft = ruleSetDrafts[item.id];
      if (!base || !draft) continue;
      diff += countRuleSetDraftChanges(base, draft);
    }
    return diff;
  }, [baseRuleSetDrafts, pendingRuleSetDeletes, ruleSetDrafts, ruleSets]);

  const rulesChangeCount = changedRuleCount + pendingRuleCreates.length + pendingRuleDeletes.size;
  const nodesChangeCount = pendingNodeCreates.length + nodeRenameChanges.length + pendingNodeDeletes.size;
  const ruleSetsChangeCount = pendingRuleSetCreates.length + ruleSetUpdateCount + pendingRuleSetDeletes.size;
  const totalChanges = rulesChangeCount + nodesChangeCount + ruleSetsChangeCount;
  const pendingRuleDeleteIds = useMemo(() => Array.from(pendingRuleDeletes), [pendingRuleDeletes]);
  const workspaceSummary = useMemo<RulesWorkspaceSummary>(
    () => ({
      totalChanges,
      rulesChangeCount,
      nodesChangeCount,
      ruleSetsChangeCount,
      pendingRuleDeleteIds,
    }),
    [nodesChangeCount, pendingRuleDeleteIds, ruleSetsChangeCount, rulesChangeCount, totalChanges],
  );

  useEffect(() => {
    onSummaryChange?.(workspaceSummary);
  }, [onSummaryChange, workspaceSummary]);

  function ensureProxySelection(): boolean {
    for (const patch of changedRulePatches) {
      if (pendingRuleDeletes.has(patch.id)) continue;
      if (patch.outbound.class === "proxy" && !patch.outbound.node?.trim()) {
        const ruleName = ruleDrafts[patch.id]?.name || patch.id;
        setSection("rules");
        setExpandedRuleId(patch.id);
        reportError(`Для правила «${ruleName}» выберите outbound node.`, ruleOutboundErrorKey(patch.id));
        return false;
      }
      if (patch.outbound.class === "proxy" && patch.outbound.node && !activeNodeIdSet.has(patch.outbound.node)) {
        const ruleName = ruleDrafts[patch.id]?.name || patch.id;
        setSection("rules");
        setExpandedRuleId(patch.id);
        reportError(`Для правила «${ruleName}» выбранная нода не найдена.`, ruleOutboundErrorKey(patch.id));
        return false;
      }
      if (patch.name !== undefined && !patch.name.trim()) {
        const ruleName = ruleDrafts[patch.id]?.name || patch.id;
        setSection("rules");
        setExpandedRuleId(patch.id);
        reportError(`Имя правила «${ruleName}» не может быть пустым.`, ruleNameErrorKey(patch.id));
        return false;
      }
    }

    for (const draft of pendingRuleCreates) {
      if (!draft.name.trim()) {
        setSection("rules");
        setExpandedRuleId(`new:${draft.tempId}`);
        reportError("Имя нового правила не может быть пустым.", pendingRuleNameErrorKey(draft.tempId));
        return false;
      }
      if (draft.outboundClass === "proxy" && !draft.outboundNode.trim()) {
        setSection("rules");
        setExpandedRuleId(`new:${draft.tempId}`);
        reportError(
          `Для нового правила «${draft.name || "без имени"}» выберите outbound node.`,
          pendingRuleOutboundErrorKey(draft.tempId),
        );
        return false;
      }
      if (draft.outboundClass === "proxy" && !activeNodeIdSet.has(draft.outboundNode)) {
        setSection("rules");
        setExpandedRuleId(`new:${draft.tempId}`);
        reportError(
          `Для нового правила «${draft.name || "без имени"}» выбранная нода не найдена.`,
          pendingRuleOutboundErrorKey(draft.tempId),
        );
        return false;
      }
    }

    for (const rename of nodeRenameChanges) {
      if (!rename.name.trim()) {
        setSection("nodes");
        setExpandedNodeId(rename.id);
        reportError("Имя ноды не может быть пустым.", nodeRenameErrorKey(rename.id));
        return false;
      }
    }

    for (const node of pendingNodeCreates) {
      if (!node.name.trim()) {
        setSection("nodes");
        setExpandedNodeId(`new:${node.tempId}`);
        reportError("Имя новой ноды не может быть пустым.", pendingNodeNameErrorKey(node.tempId));
        return false;
      }
      if (!node.key.trim()) {
        setSection("nodes");
        setExpandedNodeId(`new:${node.tempId}`);
        reportError(
          `Для ноды «${node.name || "без имени"}» заполните ключ/ссылку.`,
          pendingNodeKeyErrorKey(node.tempId),
        );
        return false;
      }
    }

    for (const draft of pendingRuleSetCreates) {
      if (!draft.name.trim()) {
        setSection("ruleSets");
        setExpandedRuleSetId(`new:${draft.tempId}`);
        reportError("Имя Rule Set не может быть пустым.", ruleSetNameErrorKey(`new:${draft.tempId}`));
        return false;
      }
      if (!draft.url.trim()) {
        setSection("ruleSets");
        setExpandedRuleSetId(`new:${draft.tempId}`);
        reportError("URL Rule Set не может быть пустым.", ruleSetUrlErrorKey(`new:${draft.tempId}`));
        return false;
      }
    }

    for (const request of ruleSetUpdateChanges) {
      const ruleSetId = request.id?.trim() || "";
      if (!ruleSetId) {
        continue;
      }
      if (request.name !== undefined && !request.name.trim()) {
        setSection("ruleSets");
        setExpandedRuleSetId(ruleSetId);
        reportError("Имя Rule Set не может быть пустым.", ruleSetNameErrorKey(ruleSetId));
        return false;
      }
      if (request.url !== undefined && !request.url.trim()) {
        setSection("ruleSets");
        setExpandedRuleSetId(ruleSetId);
        reportError("URL Rule Set не может быть пустым.", ruleSetUrlErrorKey(ruleSetId));
        return false;
      }
    }

    return true;
  }

  function buildApplyPayload(): RulesWorkspaceApplyPayload {
    const ruleCreates: RulesCreateRequest[] = pendingRuleCreates.map((draft) => {
      const draftPriority = rulePriorityMap.get(pendingRuleKey(draft.tempId));
      return {
        id: draft.id,
        name: draft.name,
        enabled: draft.enabled,
        ...(typeof draftPriority === "number" ? { priority: draftPriority } : {}),
        outbound: {
          class: draft.outboundClass,
          ...(draft.outboundClass === "proxy" ? { node: draft.outboundNode } : {}),
        },
        config: cloneConfig(draft.config),
      };
    });

    const ruleSetCreates: RuleSetCreateRequest[] = pendingRuleSetCreates.map((draft) => ({
      id: draft.id,
      name: draft.name,
      format: draft.format,
      url: draft.url,
      outbound: toRuleSetOutboundValue(draft.outbound),
      updateInterval: draft.updateInterval,
    }));

    return {
      totalChanges,
      ruleCreates,
      ruleUpdates: changedRulePatches,
      ruleDeletes: Array.from(pendingRuleDeletes),
      nodeCreates: pendingNodeCreates.map((node) => ({
        id: node.id,
        name: node.name.trim(),
        key: node.key.trim(),
        outbound: normalizeOutboundTarget(node.outbound),
      })),
      nodeRenames: nodeRenameChanges,
      nodeDeletes: Array.from(pendingNodeDeletes),
      ruleSetCreates,
      ruleSetUpdates: ruleSetUpdateChanges,
      ruleSetDeletes: Array.from(pendingRuleSetDeletes),
    };
  }

  function resetAllChanges() {
    setRuleDrafts(baseRuleDrafts);
    setRuleOrder(rules.map((rule) => rule.id));
    setRuleVisualOrder(rules.map((rule) => rule.id));
    setNewRuleEntries({});
    setPendingRuleCreates([]);
    setNewPendingRuleEntries({});
    setPendingRuleDeletes(new Set());
    setActiveDragRuleId("");
    setDragPreviewOrder(null);
    setPriorityDraggedRuleIds(new Set());

    const renameMap: Record<string, string> = {};
    for (const node of routingNodes) {
      renameMap[node.id] = node.name;
    }
    setNodeRenameDrafts(renameMap);
    setPendingNodeCreates([]);
    setPendingNodeDeletes(new Set());
    setExpandedNodeId("");

    setRuleSetDrafts(baseRuleSetDrafts);
    setPendingRuleSetCreates([]);
    setPendingRuleSetDeletes(new Set());

    setRuleCreateDraft({
      tempId: "",
      id: "",
      name: "",
      enabled: true,
      outboundClass: "direct",
      outboundNode: activeNodeOptions[0]?.id || "",
      config: cloneConfig(EMPTY_CONFIG_TEMPLATE),
    });
    setRuleCreateEntryDraft(DEFAULT_NEW_ENTRY);
    setNodeCreateDraft({ name: "", key: "", outbound: "direct" });
    setRuleSetCreateDraft({
      tempId: "",
      id: "",
      name: "",
      format: "binary",
      url: "",
      outbound: "direct",
      updateInterval: "1d",
    });

    clearError();
  }

  async function applyChanges(): Promise<boolean> {
    if (!totalChanges) return true;
    if (!ensureProxySelection()) return false;

    const payload = buildApplyPayload();

    clearError();
    try {
      await onApplyChanges(payload);
      resetAllChanges();
      setShowRuleCreateForm(false);
      setShowNodeCreateForm(false);
      setShowRuleSetCreateForm(false);
      return true;
    } catch (err) {
      throw err instanceof Error ? err : new Error("Не удалось применить изменения.");
    }
  }

  function queueQuickDomain(ruleId: string, domain: string, scope: DomainScope): { status: "added" | "duplicate" } {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) {
      throw new Error("Некорректный URL или домен.");
    }

    const targetField: RuleFieldKey = scope === "root" ? "domainSuffix" : "domain";
    const baseDraft = ruleDrafts[ruleId] ?? baseRuleDrafts[ruleId];
    if (!baseDraft) {
      throw new Error("Правило не найдено.");
    }

    const value = targetField === "domainSuffix" ? normalizedDomain.replace(/^\*\./, "") : normalizedDomain;
    const alreadyExists = baseDraft.config[targetField].includes(value);
    if (alreadyExists && !pendingRuleDeletes.has(ruleId)) {
      return { status: "duplicate" };
    }

    setRuleDrafts((prev) => {
      const current = prev[ruleId] ?? baseRuleDrafts[ruleId];
      if (!current) return prev;
      const values = current.config[targetField];
      if (values.includes(value)) {
        return prev;
      }
      return {
        ...prev,
        [ruleId]: {
          ...current,
          config: {
            ...current.config,
            [targetField]: [...values, value],
          },
        },
      };
    });
    setPendingRuleDeletes((prev) => {
      if (!prev.has(ruleId)) return prev;
      const next = new Set(prev);
      next.delete(ruleId);
      return next;
    });
    clearError();
    return { status: "added" };
  }

  useImperativeHandle(
    ref,
    () => ({
      queueQuickDomain,
      applyWorkspace: applyChanges,
      resetWorkspace: () => {
        resetAllChanges();
        setShowRuleCreateForm(false);
        setShowNodeCreateForm(false);
        setShowRuleSetCreateForm(false);
      },
    }),
    [
      applyChanges,
      baseRuleDrafts,
      pendingRuleDeletes,
      queueQuickDomain,
      ref,
      resetAllChanges,
      ruleDrafts,
    ],
  );

  function addRuleCreateDraft() {
    const name = ruleCreateDraft.name.trim();
    if (!name) {
      reportError("Введите имя нового правила.", "rule-create:name");
      return;
    }

    if (ruleCreateDraft.outboundClass === "proxy" && !ruleCreateDraft.outboundNode.trim()) {
      reportError("Для proxy-правила выберите outbound node.", "rule-create:outbound");
      return;
    }

    const usedIds = new Set<string>([
      ...rules.map((item) => item.id),
      ...pendingRuleCreates.map((item) => item.id),
    ]);

    const baseId = sanitizeIdentifier(ruleCreateDraft.name || "rule", "rule");
    const id = nextUniqueId(baseId, usedIds);

    const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const itemKey = pendingRuleKey(tempId);

    setPendingRuleCreates((prev) => [
      ...prev,
      {
        tempId,
        id,
        name,
        enabled: ruleCreateDraft.enabled,
        outboundClass: ruleCreateDraft.outboundClass,
        outboundNode: ruleCreateDraft.outboundNode,
        config: cloneConfig(ruleCreateDraft.config),
      },
    ]);
    setRuleVisualOrder((prev) => [itemKey, ...prev.filter((entry) => entry !== itemKey)]);
    setExpandedRuleId("");

    setRuleCreateDraft({
      tempId: "",
      id: "",
      name: "",
      enabled: true,
      outboundClass: "direct",
      outboundNode: activeNodeOptions[0]?.id || "",
      config: cloneConfig(EMPTY_CONFIG_TEMPLATE),
    });
    setRuleCreateEntryDraft(DEFAULT_NEW_ENTRY);
    setShowRuleCreateForm(false);
    clearError();
  }

  function removePendingRuleCreateDraft(tempId: string) {
    setPendingRuleCreates((prev) => prev.filter((item) => item.tempId !== tempId));
    setRuleVisualOrder((prev) => prev.filter((itemKey) => itemKey !== pendingRuleKey(tempId)));
    setNewPendingRuleEntries((prev) => {
      if (!(tempId in prev)) return prev;
      const next = { ...prev };
      delete next[tempId];
      return next;
    });
    setExpandedRuleId((prev) => (prev === `new:${tempId}` ? "" : prev));
    clearError();
  }

  function addNodeCreateDraft() {
    const name = nodeCreateDraft.name.trim();
    const key = nodeCreateDraft.key.trim();
    if (!name) {
      reportError("Введите имя ноды.", "node-create:name");
      return;
    }
    if (!key) {
      reportError("Введите ключ/ссылку ноды.", "node-create:key");
      return;
    }

    const usedIds = new Set<string>([
      ...routingNodes.map((item) => item.id),
      ...pendingNodeCreates.map((item) => item.id),
    ]);
    const id = nextUniqueId(sanitizeIdentifier(name, "node"), usedIds);
    const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    clearError();
    setPendingNodeCreates((prev) => [
      ...prev,
      {
        tempId,
        id,
        name,
        key,
        outbound: normalizeOutboundTarget(nodeCreateDraft.outbound),
      },
    ]);

    setNodeCreateDraft({ name: "", key: "", outbound: "direct" });
    setShowNodeCreateForm(false);
    setExpandedNodeId("");
  }

  function updatePendingNodeCreateDraft(tempId: string, updater: (prev: PendingNodeCreateDraft) => PendingNodeCreateDraft) {
    setPendingNodeCreates((prev) => prev.map((item) => (item.tempId === tempId ? updater(item) : item)));
  }

  function removePendingNodeCreateDraft(tempId: string) {
    setPendingNodeCreates((prev) => prev.filter((item) => item.tempId !== tempId));
    clearError();
  }

  function toggleNodeDelete(nodeId: string) {
    setPendingNodeDeletes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
    clearError();
  }

  function addRuleSetCreateDraft() {
    const name = ruleSetCreateDraft.name.trim();
    const url = ruleSetCreateDraft.url.trim();
    if (!name) {
      reportError("Введите имя Rule Set.", "ruleset-create:name");
      return;
    }
    if (!url) {
      reportError("Введите URL Rule Set.", "ruleset-create:url");
      return;
    }

    const usedIds = new Set<string>([
      ...ruleSets.map((item) => item.id),
      ...pendingRuleSetCreates.map((item) => item.id),
    ]);

    const id = nextUniqueId(sanitizeIdentifier(name || "ruleset", "ruleset"), usedIds);

    const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    setPendingRuleSetCreates((prev) => [
      ...prev,
      {
        tempId,
        id,
        name,
        format: ruleSetCreateDraft.format || "binary",
        url,
        outbound: normalizeOutboundTarget(ruleSetCreateDraft.outbound),
        updateInterval: ruleSetCreateDraft.updateInterval.trim() || "1d",
      },
    ]);

    setRuleSetCreateDraft({
      tempId: "",
      id: "",
      name: "",
      format: "binary",
      url: "",
      outbound: "direct",
      updateInterval: "1d",
    });
    setShowRuleSetCreateForm(false);
    setExpandedRuleSetId("");
    clearError();
  }

  const outboundOptions = useMemo(
    () => [
      { value: "direct", label: "Direct" },
      { value: "block", label: "Block" },
      ...activeNodeOptions.map((node) => ({ value: node.id, label: `Node: ${node.name}` })),
    ],
    [activeNodeOptions],
  );

  const createRuleGroups = useMemo(
    () =>
      RULE_FIELD_ORDER.map((field) => {
        const values = sortValues(ruleCreateDraft.config[field]);
        const definition = RULE_FIELD_BY_KEY.get(field);
        return {
          field,
          values,
          label: definition?.label || field,
        };
      }).filter((group) => group.values.length > 0),
    [ruleCreateDraft.config],
  );

  function toggleRuleDelete(ruleId: string) {
    setPendingRuleDeletes((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) {
        next.delete(ruleId);
      } else {
        next.add(ruleId);
      }
      return next;
    });
    clearError();
  }

  function toggleRuleSetDelete(ruleSetId: string) {
    setPendingRuleSetDeletes((prev) => {
      const next = new Set(prev);
      if (next.has(ruleSetId)) {
        next.delete(ruleSetId);
      } else {
        next.add(ruleSetId);
      }
      return next;
    });
    clearError();
  }

  function resetRuleCreateComposer() {
    setRuleCreateDraft({
      tempId: "",
      id: "",
      name: "",
      enabled: true,
      outboundClass: "direct",
      outboundNode: activeNodeOptions[0]?.id || "",
      config: cloneConfig(EMPTY_CONFIG_TEMPLATE),
    });
    setRuleCreateEntryDraft(DEFAULT_NEW_ENTRY);
  }

  function resetNodeCreateComposer() {
    setNodeCreateDraft({ name: "", key: "", outbound: "direct" });
  }

  function resetRuleSetCreateComposer() {
    setRuleSetCreateDraft({
      tempId: "",
      id: "",
      name: "",
      format: "binary",
      url: "",
      outbound: "direct",
      updateInterval: "1d",
    });
  }

  function toggleRuleCreateComposer() {
    if (showRuleCreateForm) {
      resetRuleCreateComposer();
      setShowRuleCreateForm(false);
      clearError();
      return;
    }
    setShowRuleCreateForm(true);
    clearError();
  }

  function toggleNodeCreateComposer() {
    if (showNodeCreateForm) {
      resetNodeCreateComposer();
      setShowNodeCreateForm(false);
      clearError();
      return;
    }
    setShowNodeCreateForm(true);
    clearError();
  }

  function toggleRuleSetCreateComposer() {
    if (showRuleSetCreateForm) {
      resetRuleSetCreateComposer();
      setShowRuleSetCreateForm(false);
      clearError();
      return;
    }
    setShowRuleSetCreateForm(true);
    clearError();
  }

  function resetRuleSetMatchComposer() {
    ruleSetMatchRequestRef.current += 1;
    setShowRuleSetMatchForm(false);
    setRuleSetMatchQuery("");
    setRuleSetMatchBusy(false);
    setRuleSetMatchedIds(null);
    clearError(ruleSetMatchQueryErrorKey());
    clearError(ruleSetMatchSubmitErrorKey());
  }

  function toggleRuleSetMatchComposer() {
    if (showRuleSetMatchForm || ruleSetMatchedIds) {
      resetRuleSetMatchComposer();
      return;
    }
    setShowRuleSetMatchForm(true);
    clearError(ruleSetMatchQueryErrorKey());
    clearError(ruleSetMatchSubmitErrorKey());
  }

  async function applyRuleSetMatch() {
    const query = ruleSetMatchQuery.trim();
    if (!query) {
      reportError("Введите домен или ссылку.", ruleSetMatchQueryErrorKey());
      return;
    }

    clearError(ruleSetMatchQueryErrorKey());
    clearError(ruleSetMatchSubmitErrorKey());
    const requestId = ruleSetMatchRequestRef.current + 1;
    ruleSetMatchRequestRef.current = requestId;
    setRuleSetMatchBusy(true);
    try {
      const matchedIds = await onMatchRuleSets(query);
      if (ruleSetMatchRequestRef.current !== requestId) {
        return;
      }
      setRuleSetMatchedIds(new Set(matchedIds));
      setShowRuleSetMatchForm(true);
    } catch (error) {
      if (ruleSetMatchRequestRef.current !== requestId) {
        return;
      }
      const message = error instanceof Error ? error.message : "Не удалось выполнить Match.";
      reportError(message, ruleSetMatchSubmitErrorKey());
    } finally {
      if (ruleSetMatchRequestRef.current === requestId) {
        setRuleSetMatchBusy(false);
      }
    }
  }

  return (
    <div ref={rootRef} className="flex min-h-0 flex-col">
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-zinc-800 bg-zinc-950/85 p-3 backdrop-blur">
        <div className="min-w-0 flex-1 overflow-x-auto no-scrollbar">
          <div className="flex w-max items-center gap-2 pr-1">
            <button
              className={`inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors ${
                section === "rules"
                  ? "border-zinc-100 bg-zinc-100 text-zinc-900"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
              onClick={() => {
                setSection("rules");
                clearError();
              }}
            >
              <ListTree size={14} /> Rules
            </button>
            <button
              className={`inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors ${
                section === "nodes"
                  ? "border-zinc-100 bg-zinc-100 text-zinc-900"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
              onClick={() => {
                setSection("nodes");
                clearError();
              }}
            >
              <Network size={14} /> Nodes
            </button>
            <button
              className={`inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors ${
                section === "ruleSets"
                  ? "border-zinc-100 bg-zinc-100 text-zinc-900"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
              onClick={() => {
                setSection("ruleSets");
                clearError();
              }}
            >
              <Database size={14} /> Rule Set
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-3 pb-3">
        {section === "rules" ? (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Правила</h3>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 px-2"
                onClick={(event) => {
                  event.currentTarget.blur();
                  toggleRuleCreateComposer();
                }}
              >
                {showRuleCreateForm ? (
                  <>
                    <X size={13} className="mr-1" /> Отменить
                  </>
                ) : (
                  <>
                    <Plus size={13} className="mr-1" /> Добавить правило
                  </>
                )}
              </Button>
            </div>

            {showRuleCreateForm ? (
              <div className="rounded-xl border border-zinc-700/80 bg-gradient-to-b from-zinc-900 to-zinc-900/70 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Новое правило</div>
                  <input
                    value={ruleCreateDraft.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      setRuleCreateDraft((prev) => ({
                        ...prev,
                        name,
                      }));
                      clearError("rule-create:name");
                    }}
                    placeholder="Имя нового правила"
                    className={INPUT_CLASS}
                  />
                  {readFieldError("rule-create:name") ? (
                    <p className={INLINE_ERROR_CLASS}>{readFieldError("rule-create:name")}</p>
                  ) : null}

                  <div className="grid grid-cols-3 gap-1.5">
                    {(["direct", "proxy", "block"] as RouteEditClass[]).map((className) => (
                      <button
                        key={className}
                        className={`h-8 rounded-lg border text-xs ${
                          ruleCreateDraft.outboundClass === className
                            ? "border-blue-500/40 bg-blue-500/15 text-blue-300"
                            : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                        }`}
                        onClick={() => {
                          setRuleCreateDraft((prev) => ({
                            ...prev,
                            outboundClass: className,
                            outboundNode: className === "proxy" ? prev.outboundNode || activeNodeOptions[0]?.id || "" : "",
                          }));
                          clearError("rule-create:outbound");
                        }}
                      >
                        {routeClassLabel(className)}
                      </button>
                    ))}
                  </div>

                  {ruleCreateDraft.outboundClass === "proxy" ? (
                    <select
                      value={ruleCreateDraft.outboundNode}
                      onChange={(event) => {
                        setRuleCreateDraft((prev) => ({ ...prev, outboundNode: event.target.value }));
                        clearError("rule-create:outbound");
                      }}
                      className={`${SELECT_CLASS} w-full`}
                    >
                      {activeNodeOptions.length ? null : <option value="">Нет доступных nodes</option>}
                      {activeNodeOptions.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {readFieldError("rule-create:outbound") ? (
                    <p className={INLINE_ERROR_CLASS}>{readFieldError("rule-create:outbound")}</p>
                  ) : null}

                  <div className="space-y-2">
                    {createRuleGroups.length ? (
                      createRuleGroups.map((group) => (
                        <div key={group.field} className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
                          <div className="mb-2 flex items-center justify-between">
                            <div className="text-[11px] font-medium text-zinc-300">{group.label}</div>
                            <div className="text-[10px] text-zinc-500">{group.values.length}</div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {group.values.map((value) => (
                              <span
                                key={`new-rule-${group.field}:${value}`}
                                className="inline-flex items-center rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300"
                              >
                                {formatRuleValue(group.field, value, ruleSetNameMap)}
                                <button
                                  className="ml-1.5 text-zinc-500 hover:text-rose-400"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    removeRuleCreateValue(group.field, value);
                                  }}
                                >
                                  <X size={12} />
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-500">
                        Условий пока нет.
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Добавить условие</div>
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <select
                        value={ruleCreateEntryDraft.field}
                        onChange={(event) => {
                          const nextField = event.target.value as RuleFieldKey;
                          setRuleCreateEntryDraft({
                            field: nextField,
                            value: nextField === "ruleSet" ? activeRuleSets[0]?.id || "" : "",
                          });
                          clearError("rule-create:entry");
                        }}
                        className={SELECT_CLASS}
                      >
                        {RULE_FIELD_DEFINITIONS.map((item) => (
                          <option key={`new-rule-field-${item.key}`} value={item.key}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" variant="secondary" className="h-9 px-2" onClick={addRuleCreateValue}>
                        <Plus size={13} className="mr-1" /> Добавить
                      </Button>
                    </div>

                    <div className="mt-2">
                      {ruleCreateEntryDraft.field === "ruleSet" ? (
                        <select
                          value={ruleCreateEntryDraft.value || activeRuleSets[0]?.id || ""}
                          onChange={(event) => {
                            setRuleCreateEntryDraft((prev) => ({ ...prev, value: event.target.value }));
                            clearError("rule-create:entry");
                          }}
                          className={`${SELECT_CLASS} w-full`}
                        >
                          {activeRuleSets.map((item) => (
                            <option key={`new-rule-rs-${item.id}`} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      ) : ruleCreateEntryDraft.field === "sourceIpCidr" ? (
                        <div className="space-y-2">
                          <select
                            value={sourceIpDevices.some((device) => device.ip === ruleCreateEntryDraft.value) ? ruleCreateEntryDraft.value : ""}
                            onChange={(event) => {
                              setRuleCreateEntryDraft((prev) => ({ ...prev, value: event.target.value }));
                              clearError("rule-create:entry");
                            }}
                            className={`${SELECT_CLASS} w-full`}
                          >
                            <option value="">Выбрать устройство из локальной сети</option>
                            {sourceIpDevices.map((device) => (
                              <option key={`source-ip-device-create-${device.mac}-${device.ip}`} value={device.ip}>
                                {device.name} · {device.ip}
                              </option>
                            ))}
                          </select>
                          <input
                            value={ruleCreateEntryDraft.value}
                            onChange={(event) => {
                              setRuleCreateEntryDraft((prev) => ({ ...prev, value: event.target.value }));
                              clearError("rule-create:entry");
                            }}
                            placeholder="192.168.1.25 или 192.168.1.0/24"
                            className={INPUT_CLASS}
                          />
                        </div>
                      ) : (
                        <input
                          value={ruleCreateEntryDraft.value}
                          onChange={(event) => {
                            setRuleCreateEntryDraft((prev) => ({ ...prev, value: event.target.value }));
                            clearError("rule-create:entry");
                          }}
                          placeholder={RULE_FIELD_BY_KEY.get(ruleCreateEntryDraft.field)?.placeholder || "value"}
                          className={INPUT_CLASS}
                        />
                      )}
                    </div>

                    <p className="mt-1 text-[10px] text-zinc-500">
                      {RULE_FIELD_BY_KEY.get(ruleCreateEntryDraft.field)?.helper || ""}
                    </p>
                    {readFieldError("rule-create:entry") ? (
                      <p className={INLINE_ERROR_CLASS}>{readFieldError("rule-create:entry")}</p>
                    ) : null}
                  </div>

                  <div className="pt-1">
                    <Button size="sm" className="h-9 w-full justify-center" onClick={addRuleCreateDraft}>
                      Добавить
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-2" ref={registerRulesListRef}>
              {renderedPendingRuleCreates.map(({ draft, key: draftKey }) => {
              const expanded = expandedRuleId === draftKey;
              const isDragging = activeDragRuleId === draftKey;
              const ruleEntryDraft = newPendingRuleEntries[draft.tempId] ?? DEFAULT_NEW_ENTRY;
              const nameError = readFieldError(pendingRuleNameErrorKey(draft.tempId));
              const entryError = readFieldError(pendingRuleEntryErrorKey(draft.tempId));
              const outboundError = readFieldError(pendingRuleOutboundErrorKey(draft.tempId));

              const grouped = RULE_FIELD_ORDER.map((field) => {
                const values = sortValues(draft.config[field]);
                const definition = RULE_FIELD_BY_KEY.get(field);
                return {
                  field,
                  values,
                  label: definition?.label || field,
                };
              }).filter((group) => group.values.length > 0);

              const outboundLabel =
                draft.outboundClass === "proxy"
                  ? `Proxy: ${activeNodeNameMap.get(draft.outboundNode) || draft.outboundNode || "не выбран"}`
                  : routeClassLabel(draft.outboundClass);

              return (
                <div
                  key={draftKey}
                  ref={(node) => registerRuleItemRef(draftKey, node)}
                  style={{ order: renderedRuleOrderMap.get(draftKey) ?? Number.MAX_SAFE_INTEGER }}
                  className={`group overflow-hidden rounded-xl border border-blue-500/40 bg-zinc-900 transition-[transform,box-shadow,border-color] duration-200 ${
                    isDragging ? "relative z-40 transition-none ring-1 ring-blue-500/55 shadow-[0_14px_28px_rgba(15,23,42,0.5)]" : ""
                  }`}
                >
                  <div className="flex h-[37px] items-center gap-2 pl-2 pr-3">
                    <label
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                      onClick={(event) => event.stopPropagation()}
                      title={draft.enabled ? "Отключить правило" : "Включить правило"}
                    >
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(event) => {
                          const next = event.target.checked;
                          updatePendingRuleCreateDraft(draft.tempId, (prev) => ({ ...prev, enabled: next }));
                          clearError();
                        }}
                        className="h-3.5 w-3.5 accent-blue-500"
                      />
                    </label>
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        setExpandedRuleId(expanded ? "" : draftKey);
                        clearError();
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100">
                          {draft.name || "Новое правило"}
                        </span>
                        <Badge color={routeClassToBadgeColor(draft.outboundClass)} className="shrink-0 whitespace-nowrap">
                          {outboundLabel}
                        </Badge>
                      </div>
                    </button>

                    <button
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/90 text-zinc-400 hover:text-rose-300"
                      onClick={(event) => {
                        event.stopPropagation();
                        removePendingRuleCreateDraft(draft.tempId);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>

                    <button
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200"
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedRuleId(expanded ? "" : draftKey);
                        clearError();
                      }}
                    >
                      {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>

                    <button
                      type="button"
                      className={`inline-flex h-6 w-6 shrink-0 touch-none items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/90 text-zinc-400 ${
                        isDragging || activeDragRuleId === draftKey
                          ? "cursor-grabbing text-zinc-100"
                          : "cursor-grab active:cursor-grabbing hover:text-zinc-200"
                      }`}
                      style={{ touchAction: "none" }}
                      onPointerDown={(event) => {
                        handleRuleHandlePointerDown(draftKey, event);
                      }}
                      onPointerMove={handleRuleHandlePointerMove}
                      onPointerUp={handleRuleHandlePointerUp}
                      onPointerCancel={handleRuleHandlePointerUp}
                      aria-label="Изменить порядок правила"
                      title="Перетащите для изменения приоритета"
                    >
                      <Menu size={13} />
                    </button>
                  </div>

                  {expanded ? (
                    <div className="space-y-3 border-t border-zinc-800 px-3 pb-3 pt-3">
                      <div className="space-y-2">
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Имя правила</label>
                        <input
                          value={draft.name}
                          onChange={(event) => {
                            const next = event.target.value;
                            updatePendingRuleCreateDraft(draft.tempId, (prev) => ({ ...prev, name: next }));
                            clearError(pendingRuleNameErrorKey(draft.tempId));
                          }}
                          className={INPUT_CLASS}
                          placeholder="Имя правила"
                        />
                        {nameError ? <p className={INLINE_ERROR_CLASS}>{nameError}</p> : null}
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-2">
                          {grouped.length ? (
                            grouped.map((group) => (
                              <div key={group.field} className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
                                <div className="mb-2 flex items-center justify-between">
                                  <div className="text-[11px] font-medium text-zinc-300">{group.label}</div>
                                  <div className="text-[10px] text-zinc-500">{group.values.length}</div>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {group.values.map((value) => (
                                    <span
                                      key={`new:${draft.tempId}:${group.field}:${value}`}
                                      className="inline-flex items-center rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300"
                                    >
                                      {formatRuleValue(group.field, value, ruleSetNameMap)}
                                      <button
                                        className="ml-1.5 text-zinc-500 hover:text-rose-400"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          removePendingRuleValue(draft.tempId, group.field, value);
                                        }}
                                      >
                                        <X size={12} />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-500">
                              Условий пока нет.
                            </div>
                          )}
                        </div>

                        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
                          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Добавить условие</div>
                          <div className="grid grid-cols-[1fr_auto] gap-2">
                            <select
                              value={ruleEntryDraft.field}
                              onChange={(event) => {
                                const nextField = event.target.value as RuleFieldKey;
                                setNewPendingRuleEntries((prev) => ({
                                  ...prev,
                                  [draft.tempId]: {
                                    field: nextField,
                                    value: nextField === "ruleSet" ? activeRuleSets[0]?.id || "" : "",
                                  },
                                }));
                                clearError(pendingRuleEntryErrorKey(draft.tempId));
                              }}
                              className={SELECT_CLASS}
                            >
                              {RULE_FIELD_DEFINITIONS.map((item) => (
                                <option key={`new-pending-${draft.tempId}-${item.key}`} value={item.key}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                            <Button size="sm" variant="secondary" className="h-9 px-2" onClick={() => addPendingRuleValue(draft.tempId)}>
                              <Plus size={13} className="mr-1" /> Добавить
                            </Button>
                          </div>

                          <div className="mt-2">
                            {ruleEntryDraft.field === "ruleSet" ? (
                              <select
                                value={ruleEntryDraft.value || activeRuleSets[0]?.id || ""}
                                onChange={(event) => {
                                  const nextValue = event.target.value;
                                  setNewPendingRuleEntries((prev) => ({
                                    ...prev,
                                    [draft.tempId]: {
                                      ...ruleEntryDraft,
                                      value: nextValue,
                                    },
                                  }));
                                  clearError(pendingRuleEntryErrorKey(draft.tempId));
                                }}
                                className={`${SELECT_CLASS} w-full`}
                              >
                                {activeRuleSets.map((item) => (
                                  <option key={`new-pending-rs-${draft.tempId}-${item.id}`} value={item.id}>
                                    {item.name}
                                  </option>
                                ))}
                              </select>
                            ) : ruleEntryDraft.field === "sourceIpCidr" ? (
                              <div className="space-y-2">
                                <select
                                  value={sourceIpDevices.some((device) => device.ip === ruleEntryDraft.value) ? ruleEntryDraft.value : ""}
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setNewPendingRuleEntries((prev) => ({
                                      ...prev,
                                      [draft.tempId]: {
                                        ...ruleEntryDraft,
                                        value: nextValue,
                                      },
                                    }));
                                    clearError(pendingRuleEntryErrorKey(draft.tempId));
                                  }}
                                  className={`${SELECT_CLASS} w-full`}
                                >
                                  <option value="">Выбрать устройство из локальной сети</option>
                                  {sourceIpDevices.map((device) => (
                                    <option key={`source-ip-device-pending-${draft.tempId}-${device.mac}-${device.ip}`} value={device.ip}>
                                      {device.name} · {device.ip}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  value={ruleEntryDraft.value}
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setNewPendingRuleEntries((prev) => ({
                                      ...prev,
                                      [draft.tempId]: {
                                        ...ruleEntryDraft,
                                        value: nextValue,
                                      },
                                    }));
                                    clearError(pendingRuleEntryErrorKey(draft.tempId));
                                  }}
                                  placeholder="192.168.1.25 или 192.168.1.0/24"
                                  className={INPUT_CLASS}
                                />
                              </div>
                            ) : (
                              <input
                                value={ruleEntryDraft.value}
                                onChange={(event) => {
                                  const nextValue = event.target.value;
                                  setNewPendingRuleEntries((prev) => ({
                                    ...prev,
                                    [draft.tempId]: {
                                      ...ruleEntryDraft,
                                      value: nextValue,
                                    },
                                  }));
                                  clearError(pendingRuleEntryErrorKey(draft.tempId));
                                }}
                                placeholder={RULE_FIELD_BY_KEY.get(ruleEntryDraft.field)?.placeholder || "value"}
                                className={INPUT_CLASS}
                              />
                            )}
                          </div>

                          <p className="mt-1 text-[10px] text-zinc-500">{RULE_FIELD_BY_KEY.get(ruleEntryDraft.field)?.helper || ""}</p>
                          {entryError ? <p className={INLINE_ERROR_CLASS}>{entryError}</p> : null}
                        </div>

                        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
                          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Outbound</div>
                          <div className="grid grid-cols-3 gap-1.5">
                            {(["direct", "proxy", "block"] as RouteEditClass[]).map((className) => (
                              <button
                                key={className}
                                className={`h-8 rounded-lg border text-xs ${
                                  draft.outboundClass === className
                                    ? "border-blue-500/40 bg-blue-500/15 text-blue-300"
                                    : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                                }`}
                                onClick={() => {
                                  updatePendingRuleCreateDraft(draft.tempId, (prev) => ({
                                    ...prev,
                                    outboundClass: className,
                                    outboundNode: className === "proxy" ? prev.outboundNode || activeNodeOptions[0]?.id || "" : "",
                                  }));
                                  clearError(pendingRuleOutboundErrorKey(draft.tempId));
                                }}
                              >
                                {routeClassLabel(className)}
                              </button>
                            ))}
                          </div>

                          {draft.outboundClass === "proxy" ? (
                            <select
                              value={draft.outboundNode}
                              onChange={(event) => {
                                const next = event.target.value;
                                updatePendingRuleCreateDraft(draft.tempId, (prev) => ({ ...prev, outboundNode: next }));
                                clearError(pendingRuleOutboundErrorKey(draft.tempId));
                              }}
                              className={`${SELECT_CLASS} mt-2 w-full`}
                            >
                              {activeNodeOptions.length ? null : <option value="">Нет доступных nodes</option>}
                              {activeNodeOptions.map((node) => (
                                <option key={`new-pending-node-${draft.tempId}-${node.id}`} value={node.id}>
                                  {node.name}
                                </option>
                              ))}
                            </select>
                          ) : null}
                          {outboundError ? <p className={INLINE_ERROR_CLASS}>{outboundError}</p> : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}

              {renderedVisibleRules.map(({ rule }) => {
              const draft = ruleDrafts[rule.id] ?? createRuleDraft(rule);
              const base = baseRuleDrafts[rule.id] ?? createRuleDraft(rule);
              const ruleEntryDraft = newRuleEntries[rule.id] ?? DEFAULT_NEW_ENTRY;
              const expanded = expandedRuleId === rule.id;
              const isDragging = activeDragRuleId === rule.id;
              const markedDelete = pendingRuleDeletes.has(rule.id);
              const draftPriority = rulePriorityMap.get(rule.id) ?? draft.priority;
              const nonPriorityDiffCount = countRuleDraftBaseChanges(base, draft);
              const hasPriorityChange = base.priority !== draftPriority;
              const hasDirectPriorityChange = hasPriorityChange && priorityDraggedRuleIds.has(rule.id);
              const showChangedHighlight = nonPriorityDiffCount > 0 || hasDirectPriorityChange;
              const nameError = readFieldError(ruleNameErrorKey(rule.id));
              const entryError = readFieldError(ruleEntryErrorKey(rule.id));
              const outboundError = readFieldError(ruleOutboundErrorKey(rule.id));

              const grouped = RULE_FIELD_ORDER.map((field) => {
                const values = sortValues(draft.config[field]);
                const definition = RULE_FIELD_BY_KEY.get(field);
                return {
                  field,
                  values,
                  label: definition?.label || field,
                };
              }).filter((group) => group.values.length > 0);

              const outboundLabel =
                draft.outboundClass === "proxy"
                  ? `Proxy: ${activeNodeNameMap.get(draft.outboundNode) || draft.outboundNode || "не выбран"}`
                  : routeClassLabel(draft.outboundClass);

              return (
                <div
                  key={rule.id}
                  ref={(node) => registerRuleItemRef(rule.id, node)}
                  style={{ order: renderedRuleOrderMap.get(rule.id) ?? Number.MAX_SAFE_INTEGER }}
                  className={`group overflow-hidden rounded-xl border transition-[transform,box-shadow,border-color] duration-200 ${
                    markedDelete
                      ? "border-rose-500/40 bg-rose-950/15"
                      : showChangedHighlight
                        ? "border-blue-500/40 bg-zinc-900"
                        : "border-zinc-800 bg-zinc-900"
                  } ${
                    isDragging ? "relative z-40 transition-none ring-1 ring-blue-500/55 shadow-[0_14px_28px_rgba(15,23,42,0.5)]" : ""
                  }`}
                >
                  <>
                  <div className="flex h-[37px] items-center gap-2 pl-2 pr-3">
                    <label
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                      onClick={(event) => event.stopPropagation()}
                      title={draft.enabled ? "Отключить правило" : "Включить правило"}
                    >
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(event) => {
                          const next = event.target.checked;
                          updateRuleDraft(rule.id, (prev) => ({ ...prev, enabled: next }));
                          clearError();
                        }}
                        className="h-3.5 w-3.5 accent-blue-500"
                        disabled={markedDelete}
                      />
                    </label>

                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        setExpandedRuleId(expanded ? "" : rule.id);
                        clearError();
                      }}
                    >
                      <div className="truncate text-sm font-semibold text-zinc-100">{draft.name || rule.name}</div>
                      {markedDelete ? <div className="mt-1 text-[11px] text-rose-400">Будет удалено</div> : null}
                    </button>

                    <Badge color={routeClassToBadgeColor(draft.outboundClass)} className="shrink-0 whitespace-nowrap">
                      {outboundLabel}
                    </Badge>

                    <button
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-md border ${
                        markedDelete
                          ? "border-rose-400/50 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                          : "border-zinc-700 bg-zinc-900/90 text-zinc-400 hover:text-rose-300"
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleRuleDelete(rule.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>

                    <button
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200"
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedRuleId(expanded ? "" : rule.id);
                        clearError();
                      }}
                    >
                      {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>

                    <button
                      type="button"
                      className={`inline-flex h-6 w-6 shrink-0 touch-none items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/90 text-zinc-400 ${
                        markedDelete
                          ? "cursor-not-allowed opacity-40"
                          : isDragging || activeDragRuleId === rule.id
                            ? "cursor-grabbing text-zinc-100"
                            : "cursor-grab active:cursor-grabbing hover:text-zinc-200"
                      }`}
                      style={{ touchAction: "none" }}
                      onPointerDown={(event) => {
                        if (markedDelete) return;
                        handleRuleHandlePointerDown(rule.id, event);
                      }}
                      onPointerMove={handleRuleHandlePointerMove}
                      onPointerUp={handleRuleHandlePointerUp}
                      onPointerCancel={handleRuleHandlePointerUp}
                      aria-label="Изменить порядок правила"
                      title="Перетащите для изменения приоритета"
                    >
                      <Menu size={13} />
                    </button>
                  </div>

                  {expanded ? (
                    <div className="space-y-3 border-t border-zinc-800 px-3 pb-3 pt-3">
                      <div className="space-y-2">
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Имя правила</label>
                        <input
                          value={draft.name}
                          onChange={(event) => {
                            const next = event.target.value;
                            updateRuleDraft(rule.id, (prev) => ({ ...prev, name: next }));
                            clearError(ruleNameErrorKey(rule.id));
                          }}
                          className={INPUT_CLASS}
                          placeholder="Имя правила"
                          disabled={markedDelete}
                        />
                        {nameError ? <p className={INLINE_ERROR_CLASS}>{nameError}</p> : null}
                      </div>

                      <div className={markedDelete ? "pointer-events-none space-y-3 opacity-55" : "space-y-3"}>
                        <div className="space-y-2">
                          {grouped.length ? (
                            grouped.map((group) => (
                              <div key={group.field} className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
                                <div className="mb-2 flex items-center justify-between">
                                  <div className="text-[11px] font-medium text-zinc-300">{group.label}</div>
                                  <div className="text-[10px] text-zinc-500">{group.values.length}</div>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {group.values.map((value) => (
                                    <span
                                      key={`${group.field}:${value}`}
                                      className="inline-flex items-center rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300"
                                    >
                                      {formatRuleValue(group.field, value, ruleSetNameMap)}
                                      <button
                                        className="ml-1.5 text-zinc-500 hover:text-rose-400"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          removeRuleValue(rule.id, group.field, value);
                                        }}
                                      >
                                        <X size={12} />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-500">
                              Условий пока нет.
                            </div>
                          )}
                        </div>

                        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
                          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Добавить условие</div>
                          <div className="grid grid-cols-[1fr_auto] gap-2">
                            <select
                              value={ruleEntryDraft.field}
                              onChange={(event) => {
                                const nextField = event.target.value as RuleFieldKey;
                                setNewRuleEntries((prev) => ({
                                  ...prev,
                                  [rule.id]: {
                                    field: nextField,
                                    value: nextField === "ruleSet" ? activeRuleSets[0]?.id || "" : "",
                                  },
                                }));
                                clearError(ruleEntryErrorKey(rule.id));
                              }}
                              className={SELECT_CLASS}
                            >
                              {RULE_FIELD_DEFINITIONS.map((item) => (
                                <option key={item.key} value={item.key}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                            <Button size="sm" variant="secondary" className="h-9 px-2" onClick={() => addRuleValue(rule.id)}>
                              <Plus size={13} className="mr-1" /> Добавить
                            </Button>
                          </div>

                          <div className="mt-2">
                            {ruleEntryDraft.field === "ruleSet" ? (
                              <select
                                value={ruleEntryDraft.value || activeRuleSets[0]?.id || ""}
                                onChange={(event) => {
                                  const nextValue = event.target.value;
                                  setNewRuleEntries((prev) => ({
                                    ...prev,
                                    [rule.id]: {
                                      ...ruleEntryDraft,
                                      value: nextValue,
                                    },
                                  }));
                                  clearError(ruleEntryErrorKey(rule.id));
                                }}
                                className={`${SELECT_CLASS} w-full`}
                              >
                                {activeRuleSets.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.name}
                                  </option>
                                ))}
                              </select>
                            ) : ruleEntryDraft.field === "sourceIpCidr" ? (
                              <div className="space-y-2">
                                <select
                                  value={sourceIpDevices.some((device) => device.ip === ruleEntryDraft.value) ? ruleEntryDraft.value : ""}
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setNewRuleEntries((prev) => ({
                                      ...prev,
                                      [rule.id]: {
                                        ...ruleEntryDraft,
                                        value: nextValue,
                                      },
                                    }));
                                    clearError(ruleEntryErrorKey(rule.id));
                                  }}
                                  className={`${SELECT_CLASS} w-full`}
                                >
                                  <option value="">Выбрать устройство из локальной сети</option>
                                  {sourceIpDevices.map((device) => (
                                    <option key={`source-ip-device-rule-${rule.id}-${device.mac}-${device.ip}`} value={device.ip}>
                                      {device.name} · {device.ip}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  value={ruleEntryDraft.value}
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setNewRuleEntries((prev) => ({
                                      ...prev,
                                      [rule.id]: {
                                        ...ruleEntryDraft,
                                        value: nextValue,
                                      },
                                    }));
                                    clearError(ruleEntryErrorKey(rule.id));
                                  }}
                                  placeholder="192.168.1.25 или 192.168.1.0/24"
                                  className={INPUT_CLASS}
                                />
                              </div>
                            ) : (
                              <input
                                value={ruleEntryDraft.value}
                                onChange={(event) => {
                                  const nextValue = event.target.value;
                                  setNewRuleEntries((prev) => ({
                                    ...prev,
                                    [rule.id]: {
                                      ...ruleEntryDraft,
                                      value: nextValue,
                                    },
                                  }));
                                  clearError(ruleEntryErrorKey(rule.id));
                                }}
                                placeholder={RULE_FIELD_BY_KEY.get(ruleEntryDraft.field)?.placeholder || "value"}
                                className={INPUT_CLASS}
                              />
                            )}
                          </div>

                          <p className="mt-1 text-[10px] text-zinc-500">{RULE_FIELD_BY_KEY.get(ruleEntryDraft.field)?.helper || ""}</p>
                          {entryError ? <p className={INLINE_ERROR_CLASS}>{entryError}</p> : null}
                        </div>

                        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
                          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Outbound</div>
                          <div className="grid grid-cols-3 gap-1.5">
                            {(["direct", "proxy", "block"] as RouteEditClass[]).map((className) => (
                              <button
                                key={className}
                                className={`h-8 rounded-lg border text-xs ${
                                  draft.outboundClass === className
                                    ? "border-blue-500/40 bg-blue-500/15 text-blue-300"
                                    : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                                }`}
                                onClick={() => {
                                  updateRuleDraft(rule.id, (prev) => ({
                                    ...prev,
                                    outboundClass: className,
                                    outboundNode: className === "proxy" ? prev.outboundNode || activeNodeOptions[0]?.id || "" : "",
                                  }));
                                  clearError(ruleOutboundErrorKey(rule.id));
                                }}
                              >
                                {routeClassLabel(className)}
                              </button>
                            ))}
                          </div>

                          {draft.outboundClass === "proxy" ? (
                            <select
                              value={draft.outboundNode}
                              onChange={(event) => {
                                const next = event.target.value;
                                updateRuleDraft(rule.id, (prev) => ({ ...prev, outboundNode: next }));
                                clearError(ruleOutboundErrorKey(rule.id));
                              }}
                              className={`${SELECT_CLASS} mt-2 w-full`}
                            >
                              {activeNodeOptions.length ? null : <option value="">Нет доступных nodes</option>}
                              {activeNodeOptions.map((node) => (
                                <option key={node.id} value={node.id}>
                                  {node.name}
                                </option>
                              ))}
                            </select>
                          ) : null}
                          {outboundError ? <p className={INLINE_ERROR_CLASS}>{outboundError}</p> : null}
                        </div>
                      </div>

                    </div>
                  ) : null}
                  </>
                </div>
              );
            })}

              {!visibleRules.length && !pendingRuleCreates.length ? (
                <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/60 px-3 py-3 text-xs text-zinc-500">
                  Правила пока отсутствуют.
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {section === "nodes" ? (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Ноды</h3>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 px-2"
                onClick={(event) => {
                  event.currentTarget.blur();
                  toggleNodeCreateComposer();
                }}
              >
                {showNodeCreateForm ? (
                  <>
                    <X size={13} className="mr-1" /> Отменить
                  </>
                ) : (
                  <>
                    <Plus size={13} className="mr-1" /> Добавить ноду
                  </>
                )}
              </Button>
            </div>

            {showNodeCreateForm ? (
              <div className="rounded-xl border border-zinc-700/80 bg-gradient-to-b from-zinc-900 to-zinc-900/70 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Новая нода</div>
                  <input
                    value={nodeCreateDraft.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      setNodeCreateDraft((prev) => ({ ...prev, name }));
                      clearError("node-create:name");
                    }}
                    placeholder="Название ноды"
                    className={INPUT_CLASS}
                  />
                  {readFieldError("node-create:name") ? (
                    <p className={INLINE_ERROR_CLASS}>{readFieldError("node-create:name")}</p>
                  ) : null}
                  <input
                    value={nodeCreateDraft.key}
                    onChange={(event) => {
                      setNodeCreateDraft((prev) => ({ ...prev, key: event.target.value }));
                      clearError("node-create:key");
                    }}
                    placeholder="Ключ / share-ссылка"
                    className={INPUT_CLASS}
                  />
                  {readFieldError("node-create:key") ? (
                    <p className={INLINE_ERROR_CLASS}>{readFieldError("node-create:key")}</p>
                  ) : null}

                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <select
                      value={nodeCreateDraft.outbound}
                      onChange={(event) => setNodeCreateDraft((prev) => ({ ...prev, outbound: event.target.value }))}
                      className={SELECT_CLASS}
                    >
                      {outboundOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" className="h-9 px-2" onClick={addNodeCreateDraft}>
                      Добавить
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {pendingNodeCreates.map((draft) => {
              const expanded = expandedNodeId === `new:${draft.tempId}`;
              const nameError = readFieldError(pendingNodeNameErrorKey(draft.tempId));
              const keyError = readFieldError(pendingNodeKeyErrorKey(draft.tempId));
              return (
                <div key={draft.tempId} className="overflow-hidden rounded-xl border border-blue-500/40 bg-zinc-900">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        setExpandedNodeId(expanded ? "" : `new:${draft.tempId}`);
                        clearError();
                      }}
                    >
                      <div className="truncate text-sm font-semibold text-zinc-100">{draft.name || "Новая нода"}</div>
                      <div className="mt-1 text-[11px] text-zinc-500">Новая нода</div>
                    </button>

                    <button
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/90 text-zinc-400 hover:text-rose-300"
                      onClick={(event) => {
                        event.stopPropagation();
                        removePendingNodeCreateDraft(draft.tempId);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>

                    <button
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200"
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedNodeId(expanded ? "" : `new:${draft.tempId}`);
                        clearError();
                      }}
                    >
                      {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>
                  </div>

                  {expanded ? (
                    <div className="space-y-2 border-t border-zinc-800 px-3 pb-3 pt-3">
                      <input
                        value={draft.name}
                        onChange={(event) => {
                          const next = event.target.value;
                          updatePendingNodeCreateDraft(draft.tempId, (prev) => ({ ...prev, name: next }));
                          clearError(pendingNodeNameErrorKey(draft.tempId));
                        }}
                        className={INPUT_CLASS}
                        placeholder="Имя ноды"
                      />
                      {nameError ? <p className={INLINE_ERROR_CLASS}>{nameError}</p> : null}

                      <input
                        value={draft.key}
                        onChange={(event) => {
                          const next = event.target.value;
                          updatePendingNodeCreateDraft(draft.tempId, (prev) => ({ ...prev, key: next }));
                          clearError(pendingNodeKeyErrorKey(draft.tempId));
                        }}
                        className={INPUT_CLASS}
                        placeholder="Ключ / share-ссылка"
                      />
                      {keyError ? <p className={INLINE_ERROR_CLASS}>{keyError}</p> : null}

                      <select
                        value={draft.outbound}
                        onChange={(event) => {
                          const next = event.target.value;
                          updatePendingNodeCreateDraft(draft.tempId, (prev) => ({ ...prev, outbound: next }));
                          clearError();
                        }}
                        className={`${SELECT_CLASS} w-full`}
                      >
                        {outboundOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {visibleNodes.map((node) => {
              const draftName = nodeRenameDrafts[node.id] ?? node.name;
              const renamed = draftName !== node.name;
              const markedDelete = pendingNodeDeletes.has(node.id);
              const expanded = expandedNodeId === node.id;
              const nameError = readFieldError(nodeRenameErrorKey(node.id));

              return (
                <div
                  key={node.id}
                  className={`overflow-hidden rounded-xl border ${
                    markedDelete
                      ? "border-rose-500/40 bg-rose-950/20"
                      : renamed
                        ? "border-blue-500/40 bg-zinc-900"
                        : "border-zinc-800 bg-zinc-900"
                  }`}
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        setExpandedNodeId(expanded ? "" : node.id);
                        clearError();
                      }}
                    >
                      <div className="truncate text-sm font-semibold text-zinc-100">{draftName || node.name}</div>
                      <div className="mt-1 text-[11px] text-zinc-500">
                        Source Node: {node.nodeName || node.node || "-"}
                        {markedDelete ? " • Будет удалена" : ""}
                      </div>
                    </button>

                    <button
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border ${
                        markedDelete
                          ? "border-rose-400/50 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                          : "border-zinc-700 bg-zinc-900/90 text-zinc-400 hover:text-rose-300"
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleNodeDelete(node.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>

                    <button
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200"
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedNodeId(expanded ? "" : node.id);
                        clearError();
                      }}
                    >
                      {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>
                  </div>

                  {expanded ? (
                    <div className="space-y-2 border-t border-zinc-800 px-3 pb-3 pt-3">
                      <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                        Изменение названия ноды
                      </label>
                      <input
                        value={draftName}
                        onChange={(event) => {
                          const next = event.target.value;
                          setNodeRenameDrafts((prev) => ({ ...prev, [node.id]: next }));
                          clearError(nodeRenameErrorKey(node.id));
                        }}
                        className={INPUT_CLASS}
                        placeholder="Новое имя ноды"
                        disabled={markedDelete}
                      />
                      {nameError ? <p className={INLINE_ERROR_CLASS}>{nameError}</p> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {!visibleNodes.length && !pendingNodeCreates.length ? (
              <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/60 px-3 py-3 text-xs text-zinc-500">
                Ноды пока отсутствуют.
              </div>
            ) : null}
          </>
        ) : null}

        {section === "ruleSets" ? (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Rule Set</h3>
              <div className="flex items-center gap-2">
                {hasAnyRuleSetCards || showRuleSetMatchForm || ruleSetMatchedIds ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 px-2"
                    onClick={(event) => {
                      event.currentTarget.blur();
                      toggleRuleSetMatchComposer();
                    }}
                    data-testid="ruleset-match-toggle"
                  >
                    {showRuleSetMatchForm || ruleSetMatchedIds ? (
                      <>
                        <X size={13} className="mr-1" /> Отмена
                      </>
                    ) : (
                      <>
                        <Search size={13} className="mr-1" /> Match
                      </>
                    )}
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 px-2"
                  onClick={(event) => {
                    event.currentTarget.blur();
                    toggleRuleSetCreateComposer();
                  }}
                >
                  {showRuleSetCreateForm ? (
                    <>
                      <X size={13} className="mr-1" /> Отменить
                    </>
                  ) : (
                    <>
                      <Plus size={13} className="mr-1" /> Добавить rule set
                    </>
                  )}
                </Button>
              </div>
            </div>

            {showRuleSetCreateForm ? (
              <div className="rounded-xl border border-zinc-700/80 bg-gradient-to-b from-zinc-900 to-zinc-900/70 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Новый Rule Set</div>
                  <input
                    value={ruleSetCreateDraft.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      setRuleSetCreateDraft((prev) => ({
                        ...prev,
                        name,
                      }));
                      clearError("ruleset-create:name");
                    }}
                    placeholder="Название Rule Set"
                    className={INPUT_CLASS}
                  />
                  {readFieldError("ruleset-create:name") ? (
                    <p className={INLINE_ERROR_CLASS}>{readFieldError("ruleset-create:name")}</p>
                  ) : null}
                  <input
                    value={ruleSetCreateDraft.url}
                    onChange={(event) => {
                      setRuleSetCreateDraft((prev) => ({ ...prev, url: event.target.value }));
                      clearError("ruleset-create:url");
                    }}
                    placeholder="https://..."
                    className={INPUT_CLASS}
                  />
                  {readFieldError("ruleset-create:url") ? (
                    <p className={INLINE_ERROR_CLASS}>{readFieldError("ruleset-create:url")}</p>
                  ) : null}

                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={ruleSetCreateDraft.format}
                      onChange={(event) => setRuleSetCreateDraft((prev) => ({ ...prev, format: event.target.value }))}
                      className={SELECT_CLASS}
                    >
                      <option value="binary">binary</option>
                      <option value="source">source</option>
                    </select>
                    <input
                      value={ruleSetCreateDraft.updateInterval}
                      onChange={(event) =>
                        setRuleSetCreateDraft((prev) => ({ ...prev, updateInterval: event.target.value }))
                      }
                      placeholder="1d"
                      className={INPUT_CLASS}
                    />
                  </div>

                  <select
                    value={ruleSetCreateDraft.outbound}
                    onChange={(event) => setRuleSetCreateDraft((prev) => ({ ...prev, outbound: event.target.value }))}
                    className={`${SELECT_CLASS} w-full`}
                  >
                    {outboundOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>

                  <div className="pt-1">
                    <Button size="sm" className="h-9 w-full justify-center" onClick={addRuleSetCreateDraft}>
                      Добавить
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {showRuleSetMatchForm || ruleSetMatchedIds ? (
              <div
                className="rounded-xl border border-zinc-700/80 bg-gradient-to-b from-zinc-900 to-zinc-900/70 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                data-testid="ruleset-match-composer"
              >
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Поиск домена в списках</div>
                  <div className="flex items-start gap-2">
                    <input
                      value={ruleSetMatchQuery}
                      onChange={(event) => {
                        setRuleSetMatchQuery(event.target.value);
                        clearError(ruleSetMatchQueryErrorKey());
                        clearError(ruleSetMatchSubmitErrorKey());
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void applyRuleSetMatch();
                        }
                      }}
                      placeholder="Домен или URL"
                      className={INPUT_CLASS}
                      disabled={ruleSetMatchBusy}
                      data-testid="ruleset-match-input"
                    />
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() => {
                        void applyRuleSetMatch();
                      }}
                      disabled={ruleSetMatchBusy}
                      data-testid="ruleset-match-submit"
                      title={ruleSetMatchBusy ? "Поиск..." : "Выполнить поиск"}
                    >
                      <ArrowRight size={15} />
                    </Button>
                  </div>
                  {readFieldError(ruleSetMatchQueryErrorKey()) ? (
                    <p className={INLINE_ERROR_CLASS}>{readFieldError(ruleSetMatchQueryErrorKey())}</p>
                  ) : null}
                  {readFieldError(ruleSetMatchSubmitErrorKey()) ? (
                    <p className={INLINE_ERROR_CLASS}>{readFieldError(ruleSetMatchSubmitErrorKey())}</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {filteredPendingRuleSetCreates.map((draft) => {
              const expanded = expandedRuleSetId === `new:${draft.tempId}`;
              const nameError = readFieldError(ruleSetNameErrorKey(`new:${draft.tempId}`));
              const urlError = readFieldError(ruleSetUrlErrorKey(`new:${draft.tempId}`));

              return (
                <div key={draft.tempId} className="overflow-hidden rounded-xl border border-blue-500/40 bg-zinc-900">
                  <div className="flex h-[37px] items-center gap-2 px-3">
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        setExpandedRuleSetId(expanded ? "" : `new:${draft.tempId}`);
                        clearError();
                      }}
                    >
                      <div className="truncate text-sm font-semibold text-zinc-100">{draft.name || "Новый Rule Set"}</div>
                    </button>

                    <button
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/90 text-zinc-400 hover:text-rose-300"
                      onClick={(event) => {
                        event.stopPropagation();
                        setPendingRuleSetCreates((prev) => prev.filter((item) => item.tempId !== draft.tempId));
                        clearError();
                      }}
                    >
                      <Trash2 size={12} />
                    </button>

                    <button
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200"
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedRuleSetId(expanded ? "" : `new:${draft.tempId}`);
                        clearError();
                      }}
                    >
                      {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>
                  </div>

                  {expanded ? (
                    <div className="space-y-2 border-t border-zinc-800 px-3 pb-3 pt-3">
                      <input
                        value={draft.name}
                        onChange={(event) => {
                          const next = event.target.value;
                          setPendingRuleSetCreates((prev) =>
                            prev.map((item) => (item.tempId === draft.tempId ? { ...item, name: next } : item)),
                          );
                          clearError(ruleSetNameErrorKey(`new:${draft.tempId}`));
                        }}
                        className={INPUT_CLASS}
                        placeholder="Название"
                      />
                      {nameError ? <p className={INLINE_ERROR_CLASS}>{nameError}</p> : null}

                      <input
                        value={draft.url}
                        onChange={(event) => {
                          const next = event.target.value;
                          setPendingRuleSetCreates((prev) =>
                            prev.map((item) => (item.tempId === draft.tempId ? { ...item, url: next } : item)),
                          );
                          clearError(ruleSetUrlErrorKey(`new:${draft.tempId}`));
                        }}
                        className={INPUT_CLASS}
                        placeholder="URL"
                      />
                      {urlError ? <p className={INLINE_ERROR_CLASS}>{urlError}</p> : null}

                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={draft.format}
                          onChange={(event) => {
                            const next = event.target.value;
                            setPendingRuleSetCreates((prev) =>
                              prev.map((item) => (item.tempId === draft.tempId ? { ...item, format: next } : item)),
                            );
                            clearError();
                          }}
                          className={SELECT_CLASS}
                        >
                          <option value="binary">binary</option>
                          <option value="source">source</option>
                        </select>

                        <input
                          value={draft.updateInterval}
                          onChange={(event) => {
                            const next = event.target.value;
                            setPendingRuleSetCreates((prev) =>
                              prev.map((item) =>
                                item.tempId === draft.tempId ? { ...item, updateInterval: next } : item,
                              ),
                            );
                            clearError();
                          }}
                          className={INPUT_CLASS}
                          placeholder="1d"
                        />
                      </div>

                      <select
                        value={draft.outbound}
                        onChange={(event) => {
                          const next = event.target.value;
                          setPendingRuleSetCreates((prev) =>
                            prev.map((item) => (item.tempId === draft.tempId ? { ...item, outbound: next } : item)),
                          );
                          clearError();
                        }}
                        className={`${SELECT_CLASS} w-full`}
                      >
                        {outboundOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {filteredVisibleRuleSets.map((item) => {
              const draft = ruleSetDrafts[item.id] ?? createRuleSetDraft(item);
              const base = baseRuleSetDrafts[item.id] ?? createRuleSetDraft(item);
              const diffCount = countRuleSetDraftChanges(base, draft);
              const markedDelete = pendingRuleSetDeletes.has(item.id);
              const expanded = expandedRuleSetId === item.id;
              const nameError = readFieldError(ruleSetNameErrorKey(item.id));
              const urlError = readFieldError(ruleSetUrlErrorKey(item.id));

              return (
                <div
                  key={item.id}
                  className={`overflow-hidden rounded-xl border ${
                    markedDelete
                      ? "border-rose-500/40 bg-rose-950/20"
                      : diffCount
                        ? "border-blue-500/40 bg-zinc-900"
                        : "border-zinc-800 bg-zinc-900"
                  }`}
                >
                  <div className="flex h-[37px] items-center gap-2 px-3">
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        setExpandedRuleSetId(expanded ? "" : item.id);
                        clearError();
                      }}
                    >
                      <div className="truncate text-sm font-semibold text-zinc-100">{draft.name || item.name}</div>
                      {markedDelete ? <div className="mt-1 text-[11px] text-rose-400">Будет удалён</div> : null}
                    </button>

                    <button
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-md border ${
                        markedDelete
                          ? "border-rose-400/50 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                          : "border-zinc-700 bg-zinc-900/90 text-zinc-400 hover:text-rose-300"
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleRuleSetDelete(item.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>

                    <button
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200"
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedRuleSetId(expanded ? "" : item.id);
                        clearError();
                      }}
                    >
                      {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>
                  </div>

                  {expanded ? (
                    <div className="space-y-2 border-t border-zinc-800 px-3 pb-3 pt-3">
                      <input
                        value={draft.name}
                        onChange={(event) => {
                          const next = event.target.value;
                          setRuleSetDrafts((prev) => ({
                            ...prev,
                            [item.id]: {
                              ...draft,
                              name: next,
                            },
                          }));
                          clearError(ruleSetNameErrorKey(item.id));
                        }}
                        className={INPUT_CLASS}
                        placeholder="Название"
                        disabled={markedDelete}
                      />
                      {nameError ? <p className={INLINE_ERROR_CLASS}>{nameError}</p> : null}

                      <input
                        value={draft.url}
                        onChange={(event) => {
                          const next = event.target.value;
                          setRuleSetDrafts((prev) => ({
                            ...prev,
                            [item.id]: {
                              ...draft,
                              url: next,
                            },
                          }));
                          clearError(ruleSetUrlErrorKey(item.id));
                        }}
                        className={INPUT_CLASS}
                        placeholder="URL"
                        disabled={markedDelete}
                      />
                      {urlError ? <p className={INLINE_ERROR_CLASS}>{urlError}</p> : null}

                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={draft.format}
                          onChange={(event) => {
                            const next = event.target.value;
                            setRuleSetDrafts((prev) => ({
                              ...prev,
                              [item.id]: {
                                ...draft,
                                format: next,
                              },
                            }));
                            clearError();
                          }}
                          className={SELECT_CLASS}
                          disabled={markedDelete}
                        >
                          <option value="binary">binary</option>
                          <option value="source">source</option>
                        </select>

                        <input
                          value={draft.updateInterval}
                          onChange={(event) => {
                            const next = event.target.value;
                            setRuleSetDrafts((prev) => ({
                              ...prev,
                              [item.id]: {
                                ...draft,
                                updateInterval: next,
                              },
                            }));
                            clearError();
                          }}
                          className={INPUT_CLASS}
                          placeholder="1d"
                          disabled={markedDelete}
                        />
                      </div>

                      <select
                        value={draft.outbound}
                        onChange={(event) => {
                          const next = event.target.value;
                          setRuleSetDrafts((prev) => ({
                            ...prev,
                            [item.id]: {
                              ...draft,
                              outbound: next,
                            },
                          }));
                          clearError();
                        }}
                        className={`${SELECT_CLASS} w-full`}
                        disabled={markedDelete}
                      >
                        {outboundOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {!filteredVisibleRuleSets.length && !filteredPendingRuleSetCreates.length ? (
              <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/60 px-3 py-3 text-xs text-zinc-500">
                {ruleSetMatchedIds ? "Совпадений в Rule Set не найдено." : "Rule Set пока отсутствуют."}
              </div>
            ) : null}
          </>
        ) : null}

      </div>
    </div>
  );
});
