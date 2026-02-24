export type RouteClass = "proxy" | "direct" | "block" | "unknown";
export type RouteEditClass = "proxy" | "direct" | "block";

export interface StoredSettings {
  baseUrl: string;
  token?: string;
}

export interface QuickActionConfig {
  ruleId: string;
  enabled: boolean;
}

export interface RuleSetRef {
  id: string;
  tag: string;
  name: string;
}

export interface RuleHostIpConfig {
  domain: string[];
  domainSuffix: string[];
  domainKeyword: string[];
  domainRegex: string[];
  ipCidr: string[];
  sourceIpCidr: string[];
}

export interface RulePortConfig {
  sourcePort: string[];
  sourcePortRange: string[];
  port: string[];
  portRange: string[];
}

export interface RuleOutboundInfo {
  action: string;
  class: string;
  tag?: string;
  name?: string;
  uciTag?: string;
}

export interface RoutingRuleView {
  id: string;
  tag: string;
  name: string;
  enabled: boolean;
  priority: number;
  ruleSet: RuleSetRef[];
  hostIp: RuleHostIpConfig;
  port: RulePortConfig;
  outbound: RuleOutboundInfo;
}

export interface RulesListResponse {
  configPath: string;
  fields: Record<string, string[]>;
  rules: RoutingRuleView[];
}

export interface RulesUpdateConfig {
  ruleSet: string[];
  domain: string[];
  domainSuffix: string[];
  domainKeyword: string[];
  domainRegex: string[];
  ipCidr: string[];
  sourceIpCidr: string[];
  sourcePort: string[];
  sourcePortRange: string[];
  port: string[];
  portRange: string[];
}

export interface RulesUpdateOutbound {
  class: RouteEditClass;
  node?: string;
  tag?: string;
  uciTag?: string;
}

export interface RulesUpdateRequest {
  tag?: string;
  id?: string;
  name?: string;
  label?: string;
  enabled?: boolean;
  priority?: number;
  outbound?: RulesUpdateOutbound;
  config: RulesUpdateConfig;
}

export interface RuleEditPatch {
  id: string;
  tag: string;
  name?: string;
  enabled?: boolean;
  priority?: number;
  config: RulesUpdateConfig;
  outbound: RulesUpdateOutbound;
}

export interface RulesUpdateResponse {
  updated: boolean;
  applied: boolean;
  id: string;
  tag: string;
  updatedAt: string;
}

export interface RulesCreateRequest {
  id?: string;
  tag?: string;
  name?: string;
  label?: string;
  enabled?: boolean;
  priority?: number;
  outbound?: RulesUpdateOutbound;
  config: RulesUpdateConfig;
}

export interface RulesCreateResponse {
  created: boolean;
  id: string;
  tag: string;
  createdAt: string;
}

export interface RulesDeleteRequest {
  id?: string;
  tag?: string;
}

export interface RulesDeleteResponse {
  deleted: boolean;
  id: string;
  tag: string;
  deletedAt: string;
}

export interface RulesHotReloadResponse {
  generated: boolean;
  checked: boolean;
  signaled: boolean;
  signal: string;
  service: string;
  instance: string;
  config: string;
  reloadedAt: string;
}

export interface HomeproxyServiceStatusResponse {
  running: boolean;
  status: string;
  checkedAt: string;
}

export interface HomeproxyServiceActionResponse {
  action: string;
  ok: boolean;
  running: boolean;
  status: string;
  checkedAt: string;
}

export interface CheckResult {
  input: string;
  normalized: string;
  inputType: string;
  class: RouteClass;
  outbound?: string;
  outboundTag?: string;
  matched: boolean;
  ruleIndex: number;
  ruleName?: string;
  action?: string;
  actionType?: string;
  ruleExpr?: string;
  error?: string;
}

export type SnifferRawStatus = "Proxy" | "Direct" | "Block" | "Unknown" | "Error";
export type SnifferPrimaryStatus = "Proxy" | "Direct" | "Block" | "Unknown";

export interface CheckResponse {
  mode: string;
  loadedAt: string;
  configPath: string;
  configModTime: string;
  dbPath: string;
  dbModTime: string;
  ruleSets: number;
  routeRules: number;
  results: CheckResult[];
}

export interface SnifferItem {
  id: string;
  tabId: number;
  url: string;
  domain: string;
  method: string;
  type: string;
  status: SnifferRawStatus;
  statusCode: number;
  durationMs: number;
  timestamp: number;
  error: string;
}

export interface SnifferDomainItem {
  id: string;
  domain: string;
  url: string;
  method: string;
  type: string;
  status: SnifferPrimaryStatus;
  outbound?: string;
  statusCode: number;
  durationMs: number;
  timestamp: number;
  requestCount: number;
  error: string;
}

export interface SnifferActiveResponse {
  ok: boolean;
  tabId: number | null;
  url: string;
  items: SnifferItem[];
  error?: string;
}

export interface RoutingNodeView {
  id: string;
  name: string;
  enabled: boolean;
  node: string;
  nodeName?: string;
  tag: string;
  outboundTag: string;
}

export interface RoutingNodesListResponse {
  configPath: string;
  nodes: RoutingNodeView[];
}

export interface NodeCreateRequest {
  id?: string;
  nodeId?: string;
  routingId?: string;
  nodeLabel?: string;
  key: string;
  name: string;
  outbound?: string;
}

export interface NodeCreateResponse {
  created: boolean;
  nodeId: string;
  nodeTag: string;
  nodeName: string;
  routingId: string;
  routingTag: string;
  routingName: string;
  routingOutbound: string;
  createdAt: string;
}

export interface NodeRenameRequest {
  id?: string;
  tag?: string;
  name: string;
}

export interface NodeRenameResponse {
  updated: boolean;
  nodeId: string;
  nodeTag: string;
  name: string;
  updatedRoutingIds: string[];
  updatedAt: string;
}

export interface NodeDeleteRequest {
  id?: string;
  tag?: string;
}

export interface NodeDeleteResponse {
  deleted: boolean;
  nodeId: string;
  nodeTag: string;
  removedRoutingIds: string[];
  updatedRules: number;
  updatedRuleSets: number;
  deletedAt: string;
}

export interface RuleSetListItem {
  id: string;
  tag: string;
  name: string;
  enabled: boolean;
  type?: string;
  format?: string;
  url?: string;
  path?: string;
  updateInterval?: string;
  outbound?: string;
}

export interface RuleSetsListResponse {
  configPath: string;
  ruleSets: RuleSetListItem[];
}

export interface DeviceLeaseView {
  name: string;
  ip: string;
  mac: string;
  clientId?: string;
  expiresAt?: string;
  expiresAtUnix?: number;
  expired: boolean;
}

export interface DevicesListResponse {
  leasePath: string;
  devices: DeviceLeaseView[];
}

export interface RuleSetCreateRequest {
  id?: string;
  tag?: string;
  name: string;
  enabled?: boolean;
  format?: string;
  url: string;
  outbound?: string;
  updateInterval?: string;
}

export interface RuleSetCreateResponse {
  created: boolean;
  id: string;
  tag: string;
  createdAt: string;
}

export interface RuleSetUpdateRequest {
  id?: string;
  tag?: string;
  name?: string;
  enabled?: boolean;
  format?: string;
  url?: string;
  outbound?: string;
  updateInterval?: string;
}

export interface RuleSetUpdateResponse {
  updated: boolean;
  id: string;
  tag: string;
  updatedAt: string;
}

export interface RuleSetDeleteRequest {
  id?: string;
  tag?: string;
}

export interface RuleSetDeleteResponse {
  deleted: boolean;
  id: string;
  tag: string;
  updatedRules: number;
  deletedAt: string;
}
