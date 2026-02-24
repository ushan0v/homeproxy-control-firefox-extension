import { createServer } from "node:http";

const HOST = process.env.MOCK_API_HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.MOCK_API_PORT || "7878", 10);
const REQUIRED_TOKEN = (process.env.MOCK_API_TOKEN || "playwright-token").trim();

const DEFAULT_FIELDS = {
  ruleSet: ["rule_set"],
  hostIp: ["domain", "domain_suffix", "domain_keyword", "domain_regex", "ip_cidr", "source_ip_cidr"],
  port: ["source_port", "source_port_range", "port", "port_range"],
};

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeId(value, fallback) {
  const clean = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || fallback;
}

function routingTag(id) {
  return `cfg-${id}-out`;
}

function normalizeOutboundTarget(value) {
  const clean = String(value || "").trim();
  if (!clean || clean === "direct" || clean === "direct-out") {
    return "direct";
  }
  if (clean === "block" || clean === "block-out" || clean === "reject" || clean === "reject-out") {
    return "block";
  }
  if (clean.startsWith("cfg-") && clean.endsWith("-out") && clean.length > 8) {
    return clean.slice(4, -4);
  }
  return clean;
}

function toNodeOutboundTag(value) {
  const normalized = normalizeOutboundTarget(value);
  if (normalized === "direct") return "direct-out";
  if (normalized === "block") return "block-out";
  return routingTag(normalized);
}

function toRuleSetOutboundValue(value) {
  const normalized = normalizeOutboundTarget(value);
  if (normalized === "direct") return "direct-out";
  if (normalized === "block") return "block-out";
  return normalized;
}

function createDefaultRoutingNodes() {
  return [
    {
      id: "proxy_us",
      name: "Proxy US",
      enabled: true,
      node: "node_proxy_us",
      nodeName: "US Node",
      tag: routingTag("proxy_us"),
      outboundTag: "direct-out",
    },
    {
      id: "proxy_eu",
      name: "Proxy EU",
      enabled: true,
      node: "node_proxy_eu",
      nodeName: "EU Node",
      tag: routingTag("proxy_eu"),
      outboundTag: "direct-out",
    },
  ];
}

function createDefaultRuleSets() {
  return [
    {
      id: "rs_ads",
      tag: "cfg-rs_ads-rule",
      name: "AdBlock Remote",
      enabled: true,
      type: "remote",
      format: "binary",
      url: "https://example.com/adblock.srs",
      path: "/var/run/homeproxy/rs_ads.srs",
      updateInterval: "1d",
      outbound: "direct-out",
    },
    {
      id: "rs_stream",
      tag: "cfg-rs_stream-rule",
      name: "Streaming Remote",
      enabled: true,
      type: "remote",
      format: "source",
      url: "https://example.com/streaming.json",
      path: "/var/run/homeproxy/rs_stream.json",
      updateInterval: "12h",
      outbound: "proxy_us",
    },
  ];
}

function createDefaultDevices() {
  return [
    {
      name: "macbook-pro",
      ip: "192.168.1.20",
      mac: "AA:BB:CC:DD:EE:01",
      clientId: "01:AA:BB:CC:DD:EE:01",
      expiresAt: nowIso(),
      expiresAtUnix: Math.floor(Date.now() / 1000) + 3600,
      expired: false,
    },
    {
      name: "iphone",
      ip: "192.168.1.37",
      mac: "AA:BB:CC:DD:EE:02",
      clientId: "01:AA:BB:CC:DD:EE:02",
      expiresAt: nowIso(),
      expiresAtUnix: Math.floor(Date.now() / 1000) + 2400,
      expired: false,
    },
    {
      name: "old-tablet",
      ip: "192.168.1.58",
      mac: "AA:BB:CC:DD:EE:03",
      clientId: "01:AA:BB:CC:DD:EE:03",
      expiresAt: nowIso(),
      expiresAtUnix: Math.floor(Date.now() / 1000) - 1800,
      expired: true,
    },
  ];
}

function toRuleSetRefs(ids, ruleSets) {
  const namesById = new Map(ruleSets.map((item) => [item.id, item.name]));
  return ids.map((id) => ({
    id,
    tag: `cfg-${id}-rule`,
    name: namesById.get(id) || id,
  }));
}

function createDefaultRules(ruleSets) {
  return [
    {
      id: "rule_1",
      tag: "cfg-rule_1-rule",
      name: "Proxy US",
      enabled: true,
      priority: 0,
      ruleSet: toRuleSetRefs(["rs_stream"], ruleSets),
      hostIp: {
        domain: ["youtube.com"],
        domainSuffix: ["netflix.com"],
        domainKeyword: ["stream"],
        domainRegex: [],
        ipCidr: ["8.8.8.0/24"],
        sourceIpCidr: [],
      },
      port: {
        sourcePort: [],
        sourcePortRange: [],
        port: ["443"],
        portRange: ["1000:2000"],
      },
      outbound: {
        action: "route",
        class: "proxy",
        tag: routingTag("proxy_us"),
        name: "Proxy US",
        uciTag: "proxy_us",
      },
    },
    {
      id: "rule_2",
      tag: "cfg-rule_2-rule",
      name: "Direct Home",
      enabled: true,
      priority: 1,
      ruleSet: [],
      hostIp: {
        domain: ["ya.ru"],
        domainSuffix: ["example.org"],
        domainKeyword: [],
        domainRegex: [],
        ipCidr: [],
        sourceIpCidr: ["192.168.1.0/24"],
      },
      port: {
        sourcePort: ["53"],
        sourcePortRange: [],
        port: [],
        portRange: [],
      },
      outbound: {
        action: "route",
        class: "direct",
        tag: "direct-out",
        name: "Direct",
      },
    },
    {
      id: "rule_3",
      tag: "cfg-rule_3-rule",
      name: "Block Ads",
      enabled: true,
      priority: 2,
      ruleSet: toRuleSetRefs(["rs_ads"], ruleSets),
      hostIp: {
        domain: ["googleads.g.doubleclick.net"],
        domainSuffix: ["doubleclick.net"],
        domainKeyword: ["ads"],
        domainRegex: ["^([a-z0-9-]+\\.)?adservice\\..+$"],
        ipCidr: [],
        sourceIpCidr: [],
      },
      port: {
        sourcePort: [],
        sourcePortRange: [],
        port: [],
        portRange: [],
      },
      outbound: {
        action: "reject",
        class: "block",
        tag: "block-out",
        name: "Block",
      },
    },
  ];
}

function writeJson(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Access-Token");
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function sanitizeHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (value == null) continue;
    out[String(key).toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

function matchesSuffix(domain, suffix) {
  return domain === suffix || domain.endsWith(`.${suffix}`);
}

function normalizeDomain(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesDomainRegex(domain, pattern) {
  try {
    const regexp = new RegExp(pattern);
    return regexp.test(domain);
  } catch {
    return false;
  }
}

function findRouteForDomain(domain, rules) {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    return {
      class: "unknown",
      action: "route",
      outbound: "",
      outboundTag: "",
      ruleName: "",
      ruleIndex: -1,
      ruleExpr: "",
      matched: false,
    };
  }

  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (!rule?.enabled) continue;

    if (rule.hostIp?.domain?.some((item) => normalizeDomain(item) === normalized)) {
      return {
        class: rule.outbound.class,
        action: rule.outbound.action,
        outbound: rule.outbound.name || rule.outbound.tag || "",
        outboundTag: rule.outbound.tag || "",
        ruleName: rule.name,
        ruleIndex: index,
        ruleExpr: "domain",
        matched: true,
      };
    }

    if (rule.hostIp?.domainSuffix?.some((item) => matchesSuffix(normalized, normalizeDomain(item)))) {
      return {
        class: rule.outbound.class,
        action: rule.outbound.action,
        outbound: rule.outbound.name || rule.outbound.tag || "",
        outboundTag: rule.outbound.tag || "",
        ruleName: rule.name,
        ruleIndex: index,
        ruleExpr: "domain_suffix",
        matched: true,
      };
    }

    if (rule.hostIp?.domainKeyword?.some((item) => normalized.includes(normalizeDomain(item)))) {
      return {
        class: rule.outbound.class,
        action: rule.outbound.action,
        outbound: rule.outbound.name || rule.outbound.tag || "",
        outboundTag: rule.outbound.tag || "",
        ruleName: rule.name,
        ruleIndex: index,
        ruleExpr: "domain_keyword",
        matched: true,
      };
    }

    if (rule.hostIp?.domainRegex?.some((item) => matchesDomainRegex(normalized, item))) {
      return {
        class: rule.outbound.class,
        action: rule.outbound.action,
        outbound: rule.outbound.name || rule.outbound.tag || "",
        outboundTag: rule.outbound.tag || "",
        ruleName: rule.name,
        ruleIndex: index,
        ruleExpr: "domain_regex",
        matched: true,
      };
    }
  }

  return {
    class: "direct",
    action: "route",
    outbound: "Direct",
    outboundTag: "direct-out",
    ruleName: "default",
    ruleIndex: -1,
    ruleExpr: "default",
    matched: false,
  };
}

function getRequestToken(headers) {
  const auth = String(headers["authorization"] || "");
  const accessToken = String(headers["x-access-token"] || "");
  if (accessToken) return accessToken.trim();
  if (!auth) return "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return auth.trim();
}

function isAuthorized(path, headers) {
  if (!REQUIRED_TOKEN) return true;
  if (path.startsWith("/__mock/")) return true;
  const incoming = getRequestToken(headers);
  return incoming === REQUIRED_TOKEN;
}

function createNotAuthorizedBody() {
  return {
    error: "unauthorized",
    message: "invalid or missing access token",
  };
}

function pickList(config, key) {
  return Array.isArray(config?.[key]) ? config[key].map((item) => String(item).trim()).filter(Boolean) : [];
}

function resetRuleFromConfig(rule, config, ruleSets) {
  const ruleSetIds = pickList(config, "ruleSet");
  rule.ruleSet = toRuleSetRefs(ruleSetIds, ruleSets);
  rule.hostIp.domain = pickList(config, "domain");
  rule.hostIp.domainSuffix = pickList(config, "domainSuffix");
  rule.hostIp.domainKeyword = pickList(config, "domainKeyword");
  rule.hostIp.domainRegex = pickList(config, "domainRegex");
  rule.hostIp.ipCidr = pickList(config, "ipCidr");
  rule.hostIp.sourceIpCidr = pickList(config, "sourceIpCidr");
  rule.port.sourcePort = pickList(config, "sourcePort");
  rule.port.sourcePortRange = pickList(config, "sourcePortRange");
  rule.port.port = pickList(config, "port");
  rule.port.portRange = pickList(config, "portRange");
}

function findRuleByRef(rules, value) {
  const ref = String(value || "").trim();
  if (!ref) return null;
  const id = ref.replace(/^cfg-/, "").replace(/-rule$/, "");
  return rules.find((item) => item.id === id || item.tag === ref || item.id === ref) || null;
}

function normalizeRuleIdInput(value, fallback) {
  const ref = String(value || "").trim();
  if (!ref) return fallback;
  return ref.replace(/^cfg-/, "").replace(/-rule$/, "");
}

function findRoutingNodeByRef(nodes, value) {
  const ref = String(value || "").trim();
  if (!ref) return null;
  const normalized = normalizeOutboundTarget(ref);
  return (
    nodes.find((node) => node.id === normalized || node.tag === ref || node.name === ref || node.id === ref) || null
  );
}

function applyRuleOutbound(rule, outbound, nodes) {
  const className = String(outbound?.class || "").trim().toLowerCase();
  if (className === "direct") {
    rule.outbound = {
      action: "route",
      class: "direct",
      tag: "direct-out",
      name: "Direct",
    };
    return { ok: true };
  }
  if (className === "block") {
    rule.outbound = {
      action: "reject",
      class: "block",
      tag: "block-out",
      name: "Block",
    };
    return { ok: true };
  }
  if (className !== "proxy") {
    return { ok: false, error: "unsupported outbound class" };
  }

  const nodeRef = outbound?.node || outbound?.uciTag || outbound?.tag;
  const node = findRoutingNodeByRef(nodes, nodeRef);
  if (!node) {
    return { ok: false, error: "routing node not found" };
  }

  rule.outbound = {
    action: "route",
    class: "proxy",
    tag: routingTag(node.id),
    name: node.name,
    uciTag: node.id,
  };
  return { ok: true };
}

function updateRuleSetRefsOnRename(ruleSets, rules) {
  const namesById = new Map(ruleSets.map((item) => [item.id, item.name]));
  for (const rule of rules) {
    rule.ruleSet = (rule.ruleSet || []).map((item) => ({
      ...item,
      name: namesById.get(item.id) || item.name || item.id,
    }));
  }
}

function parsePriorityInput(value) {
  if (value === undefined || value === null) {
    return { hasValue: false, value: 0 };
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { hasValue: true, error: "invalid priority" };
  }
  return { hasValue: true, value: parsed };
}

function normalizePriority(priority, total) {
  if (total <= 0) return 0;
  if (priority >= total) return total - 1;
  return priority;
}

function renumberRulePriorities(rules) {
  for (let index = 0; index < rules.length; index += 1) {
    rules[index].priority = index;
  }
}

function moveRuleByPriority(rules, ruleId, targetPriority) {
  const sourceIndex = rules.findIndex((item) => item.id === ruleId);
  if (sourceIndex < 0) return;
  const targetIndex = normalizePriority(targetPriority, rules.length);
  if (sourceIndex === targetIndex) return;
  const [rule] = rules.splice(sourceIndex, 1);
  rules.splice(targetIndex, 0, rule);
}

const logs = [];
let running = true;
let routingNodes = createDefaultRoutingNodes();
let ruleSets = createDefaultRuleSets();
let rules = createDefaultRules(ruleSets);
let devices = createDefaultDevices();
let nodeCounter = 10;
let ruleSetCounter = 20;
renumberRulePriorities(rules);

const server = createServer(async (req, res) => {
  setCorsHeaders(res);

  const method = req.method || "GET";
  const path = (req.url || "/").split("?")[0] || "/";
  const headers = sanitizeHeaders(req.headers);

  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const body = method === "GET" || method === "HEAD" ? null : await readJsonBody(req);

  logs.push({
    at: nowIso(),
    method,
    path,
    headers,
    body,
  });

  if (path === "/__mock/logs" && method === "GET") {
    writeJson(res, 200, { logs });
    return;
  }

  if (path === "/__mock/reset" && method === "POST") {
    logs.length = 0;
    running = true;
    routingNodes = createDefaultRoutingNodes();
    ruleSets = createDefaultRuleSets();
    rules = createDefaultRules(ruleSets).map(clone);
    renumberRulePriorities(rules);
    devices = createDefaultDevices();
    nodeCounter = 10;
    ruleSetCounter = 20;
    writeJson(res, 200, { ok: true });
    return;
  }

  if (!isAuthorized(path, headers)) {
    writeJson(res, 401, createNotAuthorizedBody());
    return;
  }

  if (path === "/healthz" && method === "GET") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain");
    res.end("ok\n");
    return;
  }

  if (path === "/homeproxy/status" && method === "GET") {
    writeJson(res, 200, {
      running,
      status: running ? "running" : "stopped",
      checkedAt: nowIso(),
    });
    return;
  }

  if (path === "/homeproxy/start" && method === "POST") {
    running = true;
    writeJson(res, 200, {
      action: "start",
      ok: true,
      running,
      status: "running",
      checkedAt: nowIso(),
    });
    return;
  }

  if (path === "/homeproxy/stop" && method === "POST") {
    running = false;
    writeJson(res, 200, {
      action: "stop",
      ok: true,
      running,
      status: "stopped",
      checkedAt: nowIso(),
    });
    return;
  }

  if (path === "/homeproxy/restart" && method === "POST") {
    running = true;
    writeJson(res, 200, {
      action: "restart",
      ok: true,
      running,
      status: "running",
      checkedAt: nowIso(),
    });
    return;
  }

  if (path === "/rules" && method === "GET") {
    writeJson(res, 200, {
      configPath: "/etc/config/homeproxy",
      fields: DEFAULT_FIELDS,
      rules: clone(rules),
    });
    return;
  }

  if (path === "/rules/create" && method === "POST") {
    const payload = body || {};
    const name = String(payload.name || payload.label || "").trim();
    if (!name) {
      writeJson(res, 400, { error: "missing rule name" });
      return;
    }

    const usedRuleIds = new Set(rules.map((item) => item.id));
    const fallbackId = `rule_${rules.length + 1}`;
    let ruleId = sanitizeId(normalizeRuleIdInput(payload.id || payload.tag, name), fallbackId);
    if (usedRuleIds.has(ruleId)) {
      let index = 2;
      while (usedRuleIds.has(`${ruleId}_${index}`)) {
        index += 1;
      }
      ruleId = `${ruleId}_${index}`;
    }
    const priorityPatch = parsePriorityInput(payload.priority);
    if (priorityPatch.error) {
      writeJson(res, 400, { error: priorityPatch.error });
      return;
    }

    const rule = {
      id: ruleId,
      tag: `cfg-${ruleId}-rule`,
      name,
      enabled: payload.enabled !== false,
      priority: rules.length,
      ruleSet: [],
      hostIp: {
        domain: [],
        domainSuffix: [],
        domainKeyword: [],
        domainRegex: [],
        ipCidr: [],
        sourceIpCidr: [],
      },
      port: {
        sourcePort: [],
        sourcePortRange: [],
        port: [],
        portRange: [],
      },
      outbound: {
        action: "route",
        class: "direct",
        tag: "direct-out",
        name: "Direct",
      },
    };

    if (payload.config) {
      resetRuleFromConfig(rule, payload.config, ruleSets);
    }
    if (payload.outbound) {
      const outboundPatch = applyRuleOutbound(rule, payload.outbound, routingNodes);
      if (!outboundPatch.ok) {
        writeJson(res, 400, { error: outboundPatch.error || "invalid outbound patch" });
        return;
      }
    }

    rules.push(rule);
    if (priorityPatch.hasValue) {
      moveRuleByPriority(rules, rule.id, priorityPatch.value);
    }
    renumberRulePriorities(rules);

    writeJson(res, 200, {
      created: true,
      id: rule.id,
      tag: rule.tag,
      createdAt: nowIso(),
    });
    return;
  }

  if (path === "/rules/update" && method === "POST") {
    const payload = body || {};
    const rule = findRuleByRef(rules, payload.tag || payload.id);
    if (!rule) {
      writeJson(res, 400, { error: "rule not found" });
      return;
    }

    if (payload.name || payload.label) {
      const nextName = String(payload.name || payload.label || "").trim();
      if (nextName) {
        rule.name = nextName;
      }
    }
    if (typeof payload.enabled === "boolean") {
      rule.enabled = payload.enabled;
    }

    if (payload.config) {
      resetRuleFromConfig(rule, payload.config, ruleSets);
    }

    if (payload.outbound) {
      const result = applyRuleOutbound(rule, payload.outbound, routingNodes);
      if (!result.ok) {
        writeJson(res, 400, { error: result.error || "invalid outbound patch" });
        return;
      }
    }

    const priorityPatch = parsePriorityInput(payload.priority);
    if (priorityPatch.error) {
      writeJson(res, 400, { error: priorityPatch.error });
      return;
    }
    if (priorityPatch.hasValue) {
      moveRuleByPriority(rules, rule.id, priorityPatch.value);
    }
    renumberRulePriorities(rules);

    writeJson(res, 200, {
      updated: true,
      applied: false,
      id: rule.id,
      tag: rule.tag,
      updatedAt: nowIso(),
    });
    return;
  }

  if (path === "/rules/delete" && method === "POST") {
    const ref = body?.id || body?.tag;
    const index = rules.findIndex((item) => item.id === ref || item.tag === ref);
    if (index < 0) {
      writeJson(res, 400, { error: "rule not found" });
      return;
    }

    const [removed] = rules.splice(index, 1);
    renumberRulePriorities(rules);
    writeJson(res, 200, {
      deleted: true,
      id: removed.id,
      tag: removed.tag,
      deletedAt: nowIso(),
    });
    return;
  }

  if (path === "/rules/hot-reload" && method === "POST") {
    writeJson(res, 200, {
      generated: true,
      checked: true,
      signaled: true,
      signal: "SIGHUP",
      service: "homeproxy",
      instance: "sing-box-c",
      config: "/var/run/homeproxy/sing-box-c.json",
      reloadedAt: nowIso(),
    });
    return;
  }

  if (path === "/routing/nodes" && method === "GET") {
    writeJson(res, 200, {
      configPath: "/etc/config/homeproxy",
      nodes: routingNodes,
    });
    return;
  }

  if (path === "/nodes/create" && method === "POST") {
    const name = String(body?.name || "").trim();
    const key = String(body?.key || body?.link || "").trim();
    if (!name || !key) {
      writeJson(res, 400, { error: "missing name or key" });
      return;
    }

    nodeCounter += 1;
    const id = sanitizeId(body?.id || body?.routingId || name, `node_${nodeCounter}`);
    if (routingNodes.some((item) => item.id === id)) {
      writeJson(res, 400, { error: "node id already exists" });
      return;
    }

    const outboundRef = String(body?.outbound || "direct");
    const outboundNormalized = normalizeOutboundTarget(outboundRef);
    const outboundTag = toNodeOutboundTag(outboundNormalized);

    const node = {
      id,
      name,
      enabled: true,
      node: sanitizeId(body?.nodeId || `node_${id}`, `node_${id}`),
      nodeName: name,
      tag: routingTag(id),
      outboundTag,
    };

    routingNodes.push(node);

    writeJson(res, 200, {
      created: true,
      nodeId: node.node,
      nodeTag: routingTag(node.node),
      nodeName: node.nodeName,
      routingId: node.id,
      routingTag: node.tag,
      routingName: node.name,
      routingOutbound: outboundNormalized,
      createdAt: nowIso(),
    });
    return;
  }

  if (path === "/nodes/rename" && method === "POST") {
    const node = findRoutingNodeByRef(routingNodes, body?.id || body?.tag);
    const name = String(body?.name || "").trim();
    if (!node || !name) {
      writeJson(res, 400, { error: "node not found or empty name" });
      return;
    }

    node.name = name;
    node.nodeName = name;

    const updatedRoutingIds = [node.id];
    for (const rule of rules) {
      if (rule.outbound?.uciTag === node.id || rule.outbound?.tag === routingTag(node.id)) {
        rule.outbound.name = name;
      }
    }

    writeJson(res, 200, {
      updated: true,
      nodeId: node.node,
      nodeTag: routingTag(node.node),
      name,
      updatedRoutingIds,
      updatedAt: nowIso(),
    });
    return;
  }

  if (path === "/nodes/delete" && method === "POST") {
    const node = findRoutingNodeByRef(routingNodes, body?.id || body?.tag);
    if (!node) {
      writeJson(res, 400, { error: "node not found" });
      return;
    }

    routingNodes = routingNodes.filter((item) => item.id !== node.id);

    let updatedRules = 0;
    for (const rule of rules) {
      if (rule.outbound?.uciTag === node.id || rule.outbound?.tag === routingTag(node.id)) {
        rule.outbound = {
          action: "route",
          class: "direct",
          tag: "direct-out",
          name: "Direct",
        };
        updatedRules += 1;
      }
    }

    let updatedRuleSets = 0;
    for (const ruleSet of ruleSets) {
      if (normalizeOutboundTarget(ruleSet.outbound) === node.id) {
        ruleSet.outbound = "direct-out";
        updatedRuleSets += 1;
      }
    }

    for (const entry of routingNodes) {
      if (normalizeOutboundTarget(entry.outboundTag) === node.id) {
        entry.outboundTag = "direct-out";
      }
    }

    writeJson(res, 200, {
      deleted: true,
      nodeId: node.node,
      nodeTag: routingTag(node.node),
      removedRoutingIds: [node.id],
      updatedRules,
      updatedRuleSets,
      deletedAt: nowIso(),
    });
    return;
  }

  if (path === "/rulesets" && method === "GET") {
    writeJson(res, 200, {
      configPath: "/etc/config/homeproxy",
      ruleSets,
    });
    return;
  }

  if (path === "/devices" && method === "GET") {
    writeJson(res, 200, {
      leasePath: "/tmp/dhcp.leases",
      devices: clone(devices),
    });
    return;
  }

  if (path === "/rulesets/create" && method === "POST") {
    const name = String(body?.name || body?.label || "").trim();
    const url = String(body?.url || "").trim();
    if (!name || !url) {
      writeJson(res, 400, { error: "missing ruleset name/url" });
      return;
    }

    ruleSetCounter += 1;
    const id = sanitizeId(body?.id || body?.tag || name, `ruleset_${ruleSetCounter}`);
    if (ruleSets.some((item) => item.id === id)) {
      writeJson(res, 400, { error: "ruleset id already exists" });
      return;
    }

    const item = {
      id,
      tag: `cfg-${id}-rule`,
      name,
      enabled: body?.enabled !== false,
      type: "remote",
      format: String(body?.format || "binary").trim() || "binary",
      url,
      path: `/var/run/homeproxy/${id}`,
      updateInterval: String(body?.updateInterval || body?.update_interval || "1d").trim() || "1d",
      outbound: toRuleSetOutboundValue(body?.outbound || "direct"),
    };

    ruleSets.push(item);

    writeJson(res, 200, {
      created: true,
      id: item.id,
      tag: item.tag,
      createdAt: nowIso(),
    });
    return;
  }

  if (path === "/rulesets/update" && method === "POST") {
    const ref = String(body?.id || body?.tag || "").trim();
    const id = ref.replace(/^cfg-/, "").replace(/-rule$/, "");
    const item = ruleSets.find((entry) => entry.id === id || entry.tag === ref);
    if (!item) {
      writeJson(res, 400, { error: "ruleset not found" });
      return;
    }

    if (body?.name || body?.label) {
      item.name = String(body.name || body.label || "").trim() || item.name;
      updateRuleSetRefsOnRename(ruleSets, rules);
    }
    if (typeof body?.enabled === "boolean") {
      item.enabled = body.enabled;
    }
    if (body?.format) {
      item.format = String(body.format);
    }
    if (body?.url) {
      item.url = String(body.url);
    }
    if (Object.prototype.hasOwnProperty.call(body || {}, "outbound")) {
      item.outbound = toRuleSetOutboundValue(body?.outbound || "direct");
    }
    if (body?.updateInterval || body?.update_interval) {
      item.updateInterval = String(body.updateInterval || body.update_interval);
    }

    writeJson(res, 200, {
      updated: true,
      id: item.id,
      tag: item.tag,
      updatedAt: nowIso(),
    });
    return;
  }

  if (path === "/rulesets/delete" && method === "POST") {
    const ref = String(body?.id || body?.tag || "").trim();
    const id = ref.replace(/^cfg-/, "").replace(/-rule$/, "");
    const item = ruleSets.find((entry) => entry.id === id || entry.tag === ref);
    if (!item) {
      writeJson(res, 400, { error: "ruleset not found" });
      return;
    }

    ruleSets = ruleSets.filter((entry) => entry.id !== item.id);

    let updatedRules = 0;
    for (const rule of rules) {
      const before = rule.ruleSet.length;
      rule.ruleSet = rule.ruleSet.filter((entry) => entry.id !== item.id);
      if (rule.ruleSet.length !== before) {
        updatedRules += 1;
      }
    }

    writeJson(res, 200, {
      deleted: true,
      id: item.id,
      tag: item.tag,
      updatedRules,
      deletedAt: nowIso(),
    });
    return;
  }

  if (path === "/check" && method === "POST") {
    const domains = Array.isArray(body?.domains) ? body.domains.map((item) => String(item)) : [];
    const results = domains.map((domain) => {
      const route = findRouteForDomain(domain, rules);
      return {
        input: domain,
        normalized: normalizeDomain(domain),
        inputType: "domain",
        class: route.class,
        outbound: route.outbound,
        outboundTag: route.outboundTag,
        matched: route.matched,
        ruleIndex: route.ruleIndex,
        ruleName: route.ruleName,
        action: route.action,
        actionType: route.action,
        ruleExpr: route.ruleExpr,
      };
    });

    writeJson(res, 200, {
      mode: "default",
      loadedAt: nowIso(),
      configPath: "/var/run/homeproxy/sing-box-c.json",
      configModTime: nowIso(),
      dbPath: "/var/run/homeproxy/cache.db",
      dbModTime: nowIso(),
      ruleSets: ruleSets.length,
      routeRules: rules.length,
      results,
    });
    return;
  }

  writeJson(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  const authInfo = REQUIRED_TOKEN ? `token=${REQUIRED_TOKEN}` : "token disabled";
  console.log(`[mock-api] listening on http://${HOST}:${PORT} (${authInfo})`);
});
