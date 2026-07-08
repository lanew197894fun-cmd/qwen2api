// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = import.meta.require;

// src/color.js
function _supportsColor() {
  if (process.env.FORCE_COLOR === "1" || process.env.FORCE_COLOR === "true")
    return true;
  if (process.env.NO_COLOR)
    return false;
  if (!process.stdout.isTTY && !process.stderr.isTTY)
    return false;
  const term = process.env.TERM || "";
  if (term.startsWith("xterm") || term.startsWith("screen"))
    return true;
  if (IS_WIN)
    return true;
  return false;
}
function _colorize(rgb, text) {
  if (!USE_COLOR || !text)
    return text || "";
  return fg(rgb[0], rgb[1], rgb[2]) + text + RESET;
}
function _resolveColor(colorKey) {
  const mapped = TAG_COLORS[colorKey];
  if (mapped && PALETTE[mapped])
    return PALETTE[mapped];
  if (PALETTE[colorKey])
    return PALETTE[colorKey];
  return PALETTE.primary;
}
function _tag(colorKey, name) {
  const col = _resolveColor(colorKey);
  const inner = USE_COLOR ? _colorize(col, name) : name;
  return "[" + inner + "]";
}
function _level(lvl) {
  const col = LEVEL_COLORS[lvl] || PALETTE.muted;
  const text = lvl.toUpperCase().padEnd(5);
  return USE_COLOR ? DIM + _colorize(col, text) : text;
}
function makeLogger(tag, colorKey) {
  const resolved = colorKey || tag;
  const tagStr = _tag(resolved, tag);
  const shouldLog = (lvl) => _levelNum >= (LOG_LEVELS[lvl] ?? 0);
  const emit = (lvl, method, args) => {
    if (!shouldLog(lvl))
      return;
    method(tagStr, _level(lvl), args.join(" "));
  };
  return {
    trace: (...a) => emit("trace", console.log, a),
    debug: (...a) => emit("debug", console.log, a),
    info: (...a) => emit("info", console.log, a),
    warn: (...a) => emit("warn", console.log, a),
    error: (...a) => emit("error", console.error, a),
    sysError: (...a) => {
      if (!shouldLog("error"))
        return;
      const sysTag = _tag("muted", "\u7CFB\u7D71");
      const prefix = USE_COLOR ? BOLD + bg(224, 108, 117) + "[\u7CFB\u7D71\u932F\u8AA4]" + RESET : "[\u7CFB\u7D71\u932F\u8AA4]";
      const msg = [sysTag, _level("error"), prefix, a.join(" ")].join(" ") + `
`;
      process.stderr.write(msg);
    }
  };
}
var IS_WIN, USE_COLOR, RESET = "\x1B[0m", BOLD = "\x1B[1m", DIM = "\x1B[2m", fg = (r, g, b) => `\x1B[38;2;${r};${g};${b}m`, bg = (r, g, b) => `\x1B[48;2;${r};${g};${b}m`, PALETTE, LEVEL_COLORS, TAG_COLORS, LOG_LEVELS, _levelNum;
var init_color = __esm(() => {
  IS_WIN = process.platform === "win32";
  USE_COLOR = _supportsColor();
  PALETTE = {
    primary: [92, 156, 245],
    secondary: [157, 124, 216],
    tertiary: [108, 192, 180],
    accent: [250, 178, 131],
    success: [127, 216, 143],
    warning: [245, 167, 66],
    error: [224, 108, 117],
    info: [86, 182, 194],
    muted: [128, 128, 128],
    highlight: [255, 215, 85]
  };
  LEVEL_COLORS = {
    trace: PALETTE.muted,
    debug: PALETTE.muted,
    info: PALETTE.info,
    warn: PALETTE.warning,
    error: PALETTE.error
  };
  TAG_COLORS = {
    proxy: "primary",
    plugin: "primary",
    server: "primary",
    router: "info",
    auth: "success",
    "auth:oauth": "success",
    "auth:cookie": "success",
    "auth:apikey": "success",
    learning: "secondary",
    "self-learning": "secondary",
    evolution: "secondary",
    tuning: "tertiary",
    provider: "primary",
    "auto-judge": "warning",
    hardware: "accent",
    platform: "muted",
    "resolve-deps": "muted",
    system: "muted"
  };
  LOG_LEVELS = {
    silent: 0,
    trace: 1,
    debug: 2,
    error: 3,
    warn: 4,
    info: 5
  };
  _levelNum = (() => {
    const raw = process.env.PROXY_LOG_LEVEL;
    if (raw && LOG_LEVELS[raw] !== undefined)
      return LOG_LEVELS[raw];
    if (process.env.PROXY_QUIET === "true" || process.env.PROXY_QUIET === "1")
      return 0;
    return LOG_LEVELS.info;
  })();
});

// ../config/paths.js
import { platform } from "os";
import { join, resolve } from "path";
function _join(...args) {
  if (_IS_WIN) {
    return args.map((a) => a.replace(/\//g, "\\")).join("\\");
  }
  return join(...args);
}
var _IS_WIN, _ROOT, OPENCODE_DIR, QWEN2API_DIR, TELEGRAM_BRIDGE_DIR, KNOWLEDGE_WIKI_DIR, SYSTEM_DIR, LESSON_DIR, WIKI_DIR, KNOWLEDGE_DIR, MEMORY_DIR, MODELS_DIR, CONVERSATIONS_DIR, SHADOW_DIR;
var init_paths = __esm(() => {
  _IS_WIN = platform() === "win32";
  _ROOT = process.env.PROJECT_ROOT || (_IS_WIN ? "D:\\opencode\\opencode-manager" : "/home/reamaster/opencode-manager");
  OPENCODE_DIR = process.env.OPENCODE_DIR || process.env.OPENCODE_ROOT || _join(_ROOT, "projects", ".opencode");
  QWEN2API_DIR = process.env.QWEN2API_DIR || process.env.QWEN2API_PATH || _join(_ROOT, "projects/independent/qwen2api-dev/qwen2api");
  TELEGRAM_BRIDGE_DIR = process.env.TELEGRAM_BRIDGE_DIR || _join(_ROOT, "projects/independent/qwen2api-dev/telegram-memory-bridge");
  KNOWLEDGE_WIKI_DIR = process.env.KNOWLEDGE_WIKI_DIR || _join(_ROOT, "projects/independent/qwen2api-dev/knowledge-wiki-plugin");
  SYSTEM_DIR = process.env.PROJECT_DIR || _join(_ROOT, "projects/system/packages/opencode");
  LESSON_DIR = _join(OPENCODE_DIR, "lesson-learned");
  WIKI_DIR = _join(OPENCODE_DIR, "wiki");
  KNOWLEDGE_DIR = _join(OPENCODE_DIR, "knowledge");
  MEMORY_DIR = _join(OPENCODE_DIR, "memory");
  MODELS_DIR = _join(OPENCODE_DIR, "models");
  CONVERSATIONS_DIR = _join(OPENCODE_DIR, "conversations");
  SHADOW_DIR = process.env.SHADOW_DIR || _join(process.env.HOME || "/home/reamaster", ".local/share/opencode/shadow");
});

// src/config/paths.js
var init_paths2 = __esm(() => {
  init_paths();
});

// src/self-learning.js
var exports_self_learning = {};
__export(exports_self_learning, {
  updateConfig: () => updateConfig,
  summarizeMetrics: () => summarizeMetrics,
  storeShadowExample: () => storeShadowExample,
  setTrait: () => setTrait,
  resetLearningData: () => resetLearningData,
  recordStallEvent: () => recordStallEvent,
  recordInteraction: () => recordInteraction,
  learnResponseStyle: () => learnResponseStyle,
  learnProblemSolving: () => learnProblemSolving,
  learnCodeStyle: () => learnCodeStyle,
  importModel: () => importModel,
  getTraits: () => getTraits,
  getStallStats: () => getStallStats,
  getShadowExamples: () => getShadowExamples,
  getProLevelPrompt: () => getProLevelPrompt,
  getProLevel: () => getProLevel,
  getPrivacyInfo: () => getPrivacyInfo,
  getPersonalRecommendation: () => getPersonalRecommendation,
  getPersonaList: () => getPersonaList,
  getPersona: () => getPersona,
  getLearningSuggestions: () => getLearningSuggestions,
  getLearningMetrics: () => getLearningMetrics,
  getInteractions: () => getInteractions,
  getConfig: () => getConfig,
  formatProgress: () => formatProgress,
  exportModel: () => exportModel,
  detectUserLevel: () => detectUserLevel,
  calculateSimilarity: () => calculateSimilarity,
  analyzeUserLevel: () => analyzeUserLevel,
  Metrics: () => Metrics,
  MODELS_DIR: () => BASE
});
import fs from "fs";
import path from "path";

class Metrics {
  constructor() {
    this.d = this._load() || this._init();
  }
  _init() {
    return {
      level: 1,
      dataPoints: 0,
      accuracy: 0,
      improvements: [],
      nextMilestone: "\u6536\u96C6 10 \u7B46\u4E92\u52D5\u5F8C\u9032\u884C\u6A21\u5F0F\u8B58\u5225",
      interactions: { accepted: 0, edited: 0, rejected: 0 },
      stalls: { total: 0, timeouts: 0, stallRate: 0 },
      lastUpdated: Date.now()
    };
  }
  _load() {
    const raw = read(METRICS_FILE);
    if (!raw)
      return null;
    if (!raw.stalls)
      raw.stalls = { total: 0, timeouts: 0, stallRate: 0 };
    if (!raw.interactions)
      raw.interactions = { accepted: 0, edited: 0, rejected: 0 };
    if (typeof raw.dataPoints !== "number")
      raw.dataPoints = 0;
    return raw;
  }
  save() {
    this.d.lastUpdated = Date.now();
    write(METRICS_FILE, this.d);
  }
  get() {
    return this.d;
  }
  record(feedback, stallType) {
    const d = this.d;
    if (feedback === "accepted")
      d.interactions.accepted++;
    else if (feedback === "edited")
      d.interactions.edited++;
    else if (feedback === "rejected")
      d.interactions.rejected++;
    if (stallType === "timeout")
      d.stalls.timeouts++;
    if (stallType === "stall" || stallType === "timeout")
      d.stalls.total++;
    d.stalls.stallRate = d.dataPoints > 0 ? +(d.stalls.total / d.dataPoints * 100).toFixed(1) : 0;
    d.dataPoints = d.interactions.accepted + d.interactions.edited + d.interactions.rejected;
    d.accuracy = d.dataPoints > 0 ? +((d.interactions.accepted + d.interactions.edited * 0.5) / d.dataPoints).toFixed(2) : 0;
    this._adv();
  }
  _adv() {
    const d = this.d;
    const prev = d.level;
    const cfg = loadCfg();
    if (!cfg.learningConsent)
      return;
    if (d.dataPoints >= cfg.level3At)
      d.level = 3;
    else if (d.dataPoints >= cfg.level2At)
      d.level = 2;
    if (d.level > prev) {
      d.improvements.push(`\u5347\u7D1A\u81F3 Level ${d.level}: ${LV[d.level]}`);
      d.nextMilestone = d.level === 3 ? "\u5DF2\u9054\u6700\u9AD8\u7B49\u7D1A \uD83C\uDF89 \u6301\u7E8C\u6536\u96C6\u4EE5\u63D0\u5347\u6E96\u78BA\u5EA6" : `${cfg.level3At - d.dataPoints} \u7B46\u4E92\u52D5\u5F8C\u9032\u884C Level 3\uFF08\u6A21\u578B\u5FAE\u8ABF\uFF09`;
    }
  }
}
function getShadowProvider() {
  try {
    return globalThis[GLOBAL_SHADOW_KEY];
  } catch {
    return;
  }
}
var log3, BASE, DIRS, METRICS_FILE, CONFIG_FILE, DEFAULTS, cfgCache = null, loadCfg = () => {
  if (cfgCache)
    return cfgCache;
  const saved = read(CONFIG_FILE);
  cfgCache = { ...DEFAULTS, ...saved };
  return cfgCache;
}, saveCfg = (updates) => {
  const cur = loadCfg();
  Object.assign(cur, updates);
  cfgCache = cur;
  write(CONFIG_FILE, cur);
  if (updates.skipDirs) {
    SKIP.clear();
    for (const d of cur.skipDirs)
      SKIP.add(d);
  }
  if (updates.skipExts) {
    SKIP_EXT.clear();
    for (const e of cur.skipExts)
      SKIP_EXT.add(e);
  }
  return cur;
}, getConfig = () => loadCfg(), updateConfig = (updates) => {
  const allowed = new Set(Object.keys(DEFAULTS));
  const changed = [];
  const filtered = {};
  for (const [k, v] of Object.entries(updates)) {
    if (allowed.has(k)) {
      filtered[k] = v;
      changed.push(k);
    }
  }
  if (!changed.length)
    return { config: loadCfg(), changed: [] };
  const cfg = saveCfg(filtered);
  return { config: cfg, changed };
}, ensure = (dir) => {
  if (!fs.existsSync(dir))
    fs.mkdirSync(dir, { recursive: true });
}, initDirs = () => {
  for (const d of Object.values(DIRS))
    ensure(d);
}, read = (fp) => {
  try {
    if (!fs.existsSync(fp))
      return null;
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return null;
  }
}, write = (fp, data) => {
  ensure(path.dirname(fp));
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
}, SKIP, SKIP_EXT, MAX_SCAN_FILES = 500, scan = (root) => {
  const files = [];
  const walk = (dir) => {
    if (files.length >= MAX_SCAN_FILES)
      return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= MAX_SCAN_FILES)
        return;
      if (SKIP.has(e.name) || e.name.startsWith("."))
        continue;
      const fp = path.join(dir, e.name);
      if (e.isDirectory())
        walk(fp);
      else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!SKIP_EXT.has(ext))
          files.push(fp);
      }
    }
  };
  walk(root);
  return files;
}, LV, RE, analyzeNaming = (lines) => {
  let camel = 0, snake = 0, pascal = 0;
  for (const line of lines) {
    if (line.trim().startsWith("//") || line.trim().startsWith("#") || line.trim().startsWith("/*") || line.trim().startsWith("*"))
      continue;
    camel += (line.match(RE.camel) || []).length;
    snake += (line.match(RE.snake) || []).length;
    pascal += (line.match(RE.pascal) || []).length;
  }
  const total = camel + snake + pascal || 1;
  return {
    camelCase: +(camel / total * 100).toFixed(1),
    snake_case: +(snake / total * 100).toFixed(1),
    PascalCase: +(pascal / total * 100).toFixed(1)
  };
}, analyzeIndent = (lines) => {
  let s2 = 0, s4 = 0, tabs = 0;
  for (const line of lines) {
    if (!line.trim())
      continue;
    if (line.startsWith("\t"))
      tabs++;
    else {
      const m = line.match(/^( +)/);
      if (m) {
        if (m[1].length % 2 === 0)
          s2++;
        else
          s4++;
      }
    }
  }
  const total = s2 + s4 + tabs || 1;
  return {
    spaces2: +(s2 / total * 100).toFixed(1),
    spaces4: +(s4 / total * 100).toFixed(1),
    tabs: +(tabs / total * 100).toFixed(1)
  };
}, analyzeError = (content) => {
  const tc = (content.match(/try\s*\{/g) || []).length;
  const er = (content.match(/\b(if\s*\(.*\)\s*\{?\s*return\s+)/g) || []).length;
  const total = tc + er || 1;
  return {
    tryCatch: tc,
    earlyReturn: er,
    ratio: +(tc / total * 100).toFixed(1)
  };
}, analyzeComments = (lines) => {
  let single = 0, multi = 0, inBlock = false;
  for (const line of lines) {
    const t = line.trim();
    if (inBlock) {
      multi++;
      if (t.includes("*/"))
        inBlock = false;
      continue;
    }
    if (t.startsWith("//") || t.startsWith("#"))
      single++;
    else if (t.startsWith("/*") || t.startsWith("/**")) {
      multi++;
      if (!t.includes("*/"))
        inBlock = true;
    }
  }
  return { single, multi, total: single + multi };
}, analyzeImport = (content) => {
  const esm = (content.match(/import\s+.*from\s+/g) || []).length;
  const cjs = (content.match(/require\s*\(/g) || []).length;
  return { esm, cjs };
}, MAX_ANALYSIS_LINES = 50000, learnCodeStyle = async (projectPath) => {
  initDirs();
  if (!fs.existsSync(projectPath))
    return { error: `\u8DEF\u5F91\u4E0D\u5B58\u5728: ${projectPath}` };
  const files = scan(projectPath);
  if (!files.length)
    return { error: `${projectPath} \u4E0B\u7121\u53EF\u5206\u6790\u7684\u6A94\u6848` };
  let allContent = "";
  const codeLines = [];
  let totalChars = 0;
  for (const fp of files) {
    if (codeLines.length >= MAX_ANALYSIS_LINES)
      break;
    try {
      const c = fs.readFileSync(fp, "utf-8");
      if (c.length > 1024 * 1024)
        continue;
      allContent += c + `
`;
      const lines = c.split(`
`);
      codeLines.push(...lines);
      totalChars += c.length;
      if (totalChars > 2 * 1024 * 1024)
        break;
    } catch {}
  }
  if (!codeLines.length)
    return { error: "\u7121\u53EF\u5206\u6790\u7684\u6709\u6548\u5167\u5BB9" };
  const naming = analyzeNaming(codeLines);
  const indent = analyzeIndent(codeLines);
  const error = analyzeError(allContent);
  const comments = analyzeComments(codeLines);
  const imports = analyzeImport(allContent);
  const result = {
    naming,
    indent,
    errorHandling: error,
    comments,
    imports,
    totalFiles: files.length,
    totalLines: codeLines.length,
    analyzedAt: new Date().toISOString()
  };
  write(path.join(DIRS.style, "code-style.json"), result);
  return result;
}, learnResponseStyle = (interactions = []) => {
  initDirs();
  const prefs = read(path.join(DIRS.behavior, "preferences.json")) || {
    responseLength: { short: 0, medium: 0, long: 0 },
    language: "zh-TW",
    codeBlockUsage: 0,
    explanationDepth: 0,
    totalInteractions: 0
  };
  for (const m of interactions) {
    const content = m.content || "";
    const len = content.length;
    if (len < 100)
      prefs.responseLength.short++;
    else if (len < 500)
      prefs.responseLength.medium++;
    else
      prefs.responseLength.long++;
    prefs.totalInteractions++;
    const blocks = (content.match(/```/g) || []).length;
    if (blocks > 0)
      prefs.codeBlockUsage++;
  }
  const total = prefs.responseLength.short + prefs.responseLength.medium + prefs.responseLength.long;
  prefs.explanationDepth = total > 0 ? +((prefs.responseLength.medium * 2 + prefs.responseLength.long * 3) / total).toFixed(2) : 0;
  write(path.join(DIRS.behavior, "preferences.json"), prefs);
  write(path.join(DIRS.style, "response-style.json"), prefs);
  return prefs;
}, learnProblemSolving = (tools = []) => {
  initDirs();
  const profile = read(path.join(DIRS.behavior, "preferences.json")) || {};
  const counts = profile.toolUsage || {};
  for (const t of tools) {
    counts[t] = (counts[t] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 5).map(([k]) => k);
  const result = {
    topTools: top,
    toolUsage: counts,
    updatedAt: new Date().toISOString()
  };
  profile.toolUsage = counts;
  write(path.join(DIRS.behavior, "preferences.json"), profile);
  write(path.join(DIRS.knowledge, "project-knowledge.json"), result);
  return result;
}, recordInteraction = (prompt, response, feedback = "accepted", meta = {}) => {
  initDirs();
  const m = new Metrics;
  const isStall = meta.isTimeout === true;
  const isSlow = !isStall && (meta.latencyMs || 0) > 30000;
  const log4 = {
    ts: new Date().toISOString(),
    prompt: (prompt || "").slice(0, 200),
    responseLen: (response || "").length,
    feedback,
    modelUsed: meta.modelUsed || "unknown",
    routingScore: meta.routingScore || null,
    taskType: meta.taskType || "general",
    latencyMs: meta.latencyMs || 0,
    isCognitive: meta.isCognitive || false,
    shadowCompared: meta.shadowCompared || false,
    isStall,
    isSlow
  };
  const logFile = path.join(DIRS.behavior, "interactions.jsonl");
  fs.appendFileSync(logFile, JSON.stringify(log4) + `
`, "utf-8");
  const stallType = isStall ? "timeout" : isSlow ? "stall" : null;
  m.record(feedback, stallType);
  m.save();
  return m.get();
}, recordStallEvent = (info = {}) => {
  initDirs();
  const m = new Metrics;
  const log4 = {
    ts: new Date().toISOString(),
    type: info.isTimeout ? "timeout" : "stall",
    model: info.model || "unknown",
    latencyMs: info.latencyMs || 0,
    taskType: info.taskType || "general",
    prompt: (info.prompt || "").slice(0, 100)
  };
  const logFile = path.join(DIRS.behavior, "stalls.jsonl");
  fs.appendFileSync(logFile, JSON.stringify(log4) + `
`, "utf-8");
  const stallType = info.isTimeout ? "timeout" : "stall";
  m.record("rejected", stallType);
  m.save();
  return m.get();
}, getStallStats = () => {
  const m = new Metrics;
  const stallFile = path.join(DIRS.behavior, "stalls.jsonl");
  const perModel = {};
  let total = 0;
  let timeouts = 0;
  if (fs.existsSync(stallFile)) {
    try {
      const raw = fs.readFileSync(stallFile, "utf-8");
      for (const line of raw.trim().split(`
`).filter(Boolean)) {
        try {
          const e = JSON.parse(line);
          total++;
          if (e.type === "timeout")
            timeouts++;
          const mod = e.model || "unknown";
          if (!perModel[mod])
            perModel[mod] = { total: 0, timeouts: 0, stalls: 0 };
          perModel[mod].total++;
          if (e.type === "timeout")
            perModel[mod].timeouts++;
          else
            perModel[mod].stalls++;
        } catch {}
      }
    } catch {}
  }
  return {
    total,
    timeouts,
    stallRate: total > 0 ? +(total / m.get().dataPoints * 100).toFixed(1) : 0,
    perModel
  };
}, getLearningMetrics = () => {
  const m = new Metrics;
  return {
    metrics: m.get(),
    codeStyle: read(path.join(DIRS.style, "code-style.json")),
    responseStyle: read(path.join(DIRS.style, "response-style.json")),
    knowledge: read(path.join(DIRS.knowledge, "project-knowledge.json")),
    preferences: read(path.join(DIRS.behavior, "preferences.json")),
    stalls: getStallStats()
  };
}, resetLearningData = () => {
  for (const d of Object.values(DIRS)) {
    if (fs.existsSync(d))
      fs.rmSync(d, { recursive: true, force: true });
  }
  initDirs();
  const m = new Metrics;
  m.save();
  return { status: "\u5DF2\u6E05\u7A7A\u6240\u6709\u5B78\u7FD2\u8CC7\u6599" };
}, exportModel = (outPath) => {
  const data = getLearningMetrics();
  const exportDir = outPath || path.join(BASE, "export");
  ensure(exportDir);
  const fp = path.join(exportDir, `personal-model-${Date.now()}.json`);
  write(fp, data);
  return { path: fp, size: JSON.stringify(data).length };
}, importModel = (filePath) => {
  if (!fs.existsSync(filePath))
    return { error: `\u6A94\u6848\u4E0D\u5B58\u5728: ${filePath}` };
  const data = read(filePath);
  if (!data)
    return { error: "\u7121\u6548\u7684\u6A21\u578B\u6A94\u6848\uFF08\u7121\u6CD5\u89E3\u6790 JSON\uFF09" };
  if (data.metrics)
    write(METRICS_FILE, data.metrics);
  if (data.codeStyle)
    write(path.join(DIRS.style, "code-style.json"), data.codeStyle);
  if (data.responseStyle)
    write(path.join(DIRS.style, "response-style.json"), data.responseStyle);
  if (data.knowledge)
    write(path.join(DIRS.knowledge, "project-knowledge.json"), data.knowledge);
  if (data.preferences)
    write(path.join(DIRS.behavior, "preferences.json"), data.preferences);
  const pts = data.metrics?.dataPoints || 0;
  return { status: "\u5DF2\u532F\u5165\u500B\u4EBA\u5316\u6A21\u578B", dataPoints: pts };
}, getPersonalRecommendation = () => {
  const codeStyle = read(path.join(DIRS.style, "code-style.json"));
  const prefs = read(path.join(DIRS.behavior, "preferences.json"));
  const m = new Metrics;
  const met = m.get();
  let naming = "camelCase";
  if (codeStyle?.naming) {
    const n = codeStyle.naming;
    naming = n.camelCase >= n.snake_case && n.camelCase >= n.PascalCase ? "camelCase" : n.snake_case >= n.camelCase && n.snake_case >= n.PascalCase ? "snake_case" : "PascalCase";
  }
  let indent = 2;
  if (codeStyle?.indent) {
    const i = codeStyle.indent;
    indent = i.spaces4 > i.spaces2 && i.spaces4 > i.tabs ? 4 : i.tabs > i.spaces2 && i.tabs > i.spaces4 ? -1 : 2;
  }
  const tools = prefs?.toolUsage ? Object.entries(prefs.toolUsage).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k) : [];
  const strategy = codeStyle?.errorHandling?.tryCatch > codeStyle?.errorHandling?.earlyReturn ? "try-catch" : "early-return";
  return {
    codeStyle: { naming, indent },
    tools,
    strategy,
    confidence: met.accuracy
  };
}, getInteractions = () => {
  const logFile = path.join(DIRS.behavior, "interactions.jsonl");
  if (!fs.existsSync(logFile))
    return [];
  try {
    const raw = fs.readFileSync(logFile, "utf-8");
    return raw.trim().split(`
`).filter(Boolean).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}, GLOBAL_SHADOW_KEY = "__opencode_shadow_store_provider__", storeShadowExample = async (prompt, shadowResponse, meta = {}) => {
  const provider = getShadowProvider();
  if (provider && typeof provider.storeShadow === "function") {
    const result = await provider.storeShadow({
      sessionID: meta.sessionID || "standalone",
      prompt,
      shadowResponse,
      modelUsed: meta.modelUsed,
      taskType: meta.taskType,
      similarityScore: meta.similarityScore ?? null
    });
    return { status: "stored", id: result.id };
  }
  initDirs();
  const id = `shadow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const example = {
    id,
    ts: new Date().toISOString(),
    prompt: (prompt || "").slice(0, 500),
    shadowResponse,
    modelUsed: meta.modelUsed || "unknown",
    taskType: meta.taskType || "general",
    similarityScore: meta.similarityScore || null,
    usageCount: 0
  };
  const fp = path.join(DIRS.shadow, `${id}.json`);
  write(fp, example);
  return { status: "stored", id };
}, getShadowExamples = async (currentPrompt, limit = 3, taskType) => {
  const provider = getShadowProvider();
  if (provider && typeof provider.recallShadow === "function") {
    return await provider.recallShadow(currentPrompt, limit, taskType);
  }
  initDirs();
  if (!fs.existsSync(DIRS.shadow))
    return [];
  const files = fs.readdirSync(DIRS.shadow).filter((f) => f.endsWith(".json"));
  const examples = [];
  for (const file of files) {
    try {
      const data = read(path.join(DIRS.shadow, file));
      if (!data)
        continue;
      if (taskType && data.taskType !== taskType)
        continue;
      const score = calculateSimilarity(currentPrompt, data.prompt);
      examples.push({ ...data, matchScore: score });
    } catch {
      continue;
    }
  }
  const sorted = examples.sort((a, b) => b.matchScore - a.matchScore).slice(0, limit);
  for (const ex of sorted) {
    try {
      const fp = path.join(DIRS.shadow, `${ex.id}.json`);
      const data = read(fp);
      if (data) {
        data.usageCount = (data.usageCount || 0) + 1;
        write(fp, data);
      }
    } catch {}
  }
  return sorted.map(({ prompt, shadowResponse, matchScore }) => ({
    prompt,
    shadowResponse,
    similarityScore: matchScore
  }));
}, calculateSimilarity = (a, b) => {
  if (!a || !b)
    return 0;
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  const intersection = [...tokensA].filter((t) => tokensB.has(t));
  const union = new Set([...tokensA, ...tokensB]);
  return union.size > 0 ? intersection.length / union.size : 0;
}, PRO_LEVELS, TRAIT_META, buildTraitPrompts = (traits) => {
  const t = { ...traits };
  const parts = [];
  if (t.warmth >= 4)
    parts.push("\u8A9E\u6C23\u6EAB\u6696\u53CB\u5584\uFF0C\u5C55\u73FE\u540C\u7406\u5FC3\uFF0C\u9069\u6642\u8868\u9054\u95DC\u5FC3\u8207\u9F13\u52F5\u3002");
  else if (t.warmth <= 2)
    parts.push("\u8A9E\u6C23\u51B7\u975C\u5BA2\u89C0\uFF0C\u5C08\u6CE8\u5728\u4E8B\u5BE6\u8207\u908F\u8F2F\uFF0C\u907F\u514D\u60C5\u7DD2\u5316\u8868\u9054\u3002");
  if (t.proactive >= 4)
    parts.push("\u4E3B\u52D5\u63D0\u4F9B\u5EF6\u4F38\u5EFA\u8B70\u548C\u6700\u4F73\u5BE6\u8E10\uFF0C\u5F15\u5C0E\u4F7F\u7528\u8005\u601D\u8003\u4E0B\u4E00\u6B65\u3002\u4E0D\u8981\u53EA\u56DE\u7B54\u554F\u984C\u672C\u8EAB\u3002");
  else if (t.proactive <= 2)
    parts.push("\u50C5\u91DD\u5C0D\u554F\u984C\u56DE\u61C9\uFF0C\u4E0D\u4E3B\u52D5\u5EF6\u4F38\uFF0C\u9664\u975E\u4F7F\u7528\u8005\u8FFD\u554F\u3002");
  if (t.depth >= 4)
    parts.push("\u56DE\u7B54\u6DF1\u5165\u8A73\u76E1\uFF0C\u5305\u542B\u539F\u7406\u8AAA\u660E\u3001\u5E95\u5C64\u6A5F\u5236\u548C\u76F8\u95DC\u80CC\u666F\u77E5\u8B58\u3002\u9069\u5408\u60F3\u6DF1\u5165\u7406\u89E3\u7684\u5B78\u7FD2\u8005\u3002");
  else if (t.depth <= 2)
    parts.push("\u56DE\u7B54\u7C21\u6F54\u660E\u77AD\uFF0C\u805A\u7126\u5728\u6838\u5FC3\u7B54\u6848\uFF0C\u907F\u514D\u904E\u591A\u5EF6\u4F38\u8AAA\u660E\u3002");
  if (t.patience >= 4)
    parts.push("\u5C0D\u540C\u4E00\u500B\u554F\u984C\u53EF\u4EE5\u5F9E\u4E0D\u540C\u89D2\u5EA6\u53CD\u8986\u89E3\u91CB\uFF0C\u76F4\u5230\u5C0D\u65B9\u5B8C\u5168\u7406\u89E3\u70BA\u6B62\u3002\u9F13\u52F5\u8FFD\u554F\u3002");
  else if (t.patience <= 2)
    parts.push("\u56DE\u7B54\u76F4\u63A5\u4E86\u7576\uFF0C\u4E00\u6B21\u5230\u4F4D\u3002\u4E0D\u91CD\u8907\u89E3\u91CB\u76F8\u540C\u5167\u5BB9\u3002");
  if (t.humor >= 4)
    parts.push("\u9069\u5EA6\u4F7F\u7528\u5E7D\u9ED8\u548C\u8F15\u9B06\u7684\u6BD4\u55BB\uFF0C\u8B93\u6280\u8853\u8A0E\u8AD6\u4E0D\u6C89\u60B6\u3002\u4F46\u4E0D\u8981\u904E\u5EA6\u958B\u73A9\u7B11\u5F71\u97FF\u5C08\u696D\u6027\u3002");
  else if (t.humor <= 2)
    parts.push("\u4FDD\u6301\u56B4\u8085\u5C08\u696D\u7684\u8A9E\u6C23\uFF0C\u4E0D\u4F7F\u7528\u5E7D\u9ED8\u6216\u958B\u73A9\u7B11\u3002");
  return parts;
}, PERSONA, getPersona = (persona) => {
  const cfg = persona ? { personality: persona } : loadCfg();
  const p = PERSONA[cfg.personality];
  if (cfg.personality === "custom" && cfg.customPrompt) {
    return {
      label: `\u270F\uFE0F ${cfg.customPrompt.slice(0, 30)}`,
      desc: "\u4F7F\u7528\u8005\u81EA\u5B9A\u7FA9",
      prompt: cfg.customPrompt
    };
  }
  return p || { label: "", desc: "", prompt: "" };
}, getPersonaList = () => Object.entries(PERSONA).map(([k, v]) => ({
  name: k,
  label: v.label,
  desc: v.desc
})), getTraits = () => {
  const cfg = loadCfg();
  return { ...cfg.traits };
}, setTrait = (key, val) => {
  const allowed = Object.keys(TRAIT_META);
  if (!allowed.includes(key))
    return {
      ok: false,
      error: `\u672A\u77E5\u7DAD\u5EA6: ${key}\uFF0C\u53EF\u7528: ${allowed.join(", ")}`
    };
  const n = typeof val === "string" ? parseInt(val, 10) : val;
  if (isNaN(n) || n < 1 || n > 5)
    return { ok: false, error: "\u503C\u9700\u70BA 1-5" };
  const cfg = loadCfg();
  cfg.traits[key] = n;
  saveCfg({ traits: cfg.traits });
  return { ok: true, trait: key, val: n };
}, ADVANCED_KW, BEGINNER_KW, inferUserLevelFromHistory = () => {
  try {
    const logFile = path.join(DIRS.behavior, "interactions.jsonl");
    if (!fs.existsSync(logFile))
      return "unknown";
    const raw = fs.readFileSync(logFile, "utf-8");
    const lines = raw.trim().split(`
`).filter(Boolean).slice(-50);
    if (lines.length < 3)
      return "unknown";
    let rejected = 0;
    for (const l of lines) {
      try {
        const e = JSON.parse(l);
        if (e.feedback === "rejected")
          rejected++;
      } catch {}
    }
    const rejectRate = rejected / lines.length;
    const avgLen = lines.reduce((s, l) => {
      try {
        return s + (JSON.parse(l).prompt || "").length;
      } catch {
        return s;
      }
    }, 0) / lines.length;
    if (rejectRate > 0.3)
      return "mixed";
    if (avgLen > 150)
      return "advanced";
    return "unknown";
  } catch {
    return "unknown";
  }
}, detectUserLevel = (msg) => {
  if (!msg)
    return "";
  const lower = msg.toLowerCase();
  const adv = ADVANCED_KW.filter((k) => lower.includes(k.toLowerCase())).length;
  const beg = BEGINNER_KW.filter((k) => lower.includes(k.toLowerCase())).length;
  const len = msg.length;
  const hasCode = msg.includes("```") || lower.includes("function") || lower.includes("class ") || lower.includes("const ") || lower.includes("let ") || lower.includes("import ");
  const historyLevel = inferUserLevelFromHistory();
  if (hasCode)
    return "programmer";
  if (adv >= 2 && beg === 0)
    return "programmer";
  if (adv >= 1 && beg >= 1)
    return "student";
  if (adv >= 1 && len > 80)
    return "programmer";
  const isStrongBeginner = beg >= 3;
  const isOnlyBeginner = beg >= 1 && adv === 0;
  if (isOnlyBeginner && historyLevel === "advanced")
    return "student";
  if (isStrongBeginner && adv === 0)
    return "beginner";
  if (len > 60 && beg >= 1)
    return "student";
  if (len < 15)
    return "";
  return "";
}, analyzeUserLevel = (msg) => {
  const detected = detectUserLevel(msg);
  const reasons = [];
  const lower = msg.toLowerCase();
  const adv = ADVANCED_KW.filter((k) => lower.includes(k.toLowerCase()));
  const beg = BEGINNER_KW.filter((k) => lower.includes(k.toLowerCase()));
  if (adv.length)
    reasons.push(`\u9032\u968E\u8A5E: ${adv.slice(0, 3).join(", ")}`);
  if (beg.length)
    reasons.push(`\u57FA\u790E\u8A5E: ${beg.slice(0, 3).join(", ")}`);
  if (msg.includes("```") || lower.includes("function") || lower.includes("const "))
    reasons.push("\u5305\u542B\u7A0B\u5F0F\u78BC");
  if (msg.length > 200)
    reasons.push("\u9577\u6587");
  if (!detected) {
    return {
      persona: "",
      label: "\u4F7F\u7528\u9810\u8A2D\u89D2\u8272",
      reason: reasons.length ? reasons.join("\u3001") + "\uFF0C\u4FE1\u865F\u4E0D\u660E\u78BA\uFF0C\u4FDD\u7559\u76EE\u524D\u8A2D\u5B9A" : "\u7121\u660E\u78BA\u5224\u65B7\u4F9D\u64DA\uFF0C\u4F7F\u7528\u9810\u8A2D\u89D2\u8272",
      confidence: "low"
    };
  }
  const info = getPersona(detected);
  let confidence = "medium";
  if (detected === "programmer" && adv.length >= 2)
    confidence = "high";
  if (detected === "beginner" && beg.length >= 3)
    confidence = "high";
  if (detected === "student" && adv.length >= 1 && beg.length >= 1)
    confidence = "high";
  return {
    persona: detected,
    label: info.label,
    reason: reasons.length ? reasons.join("\u3001") : "\u6A21\u5F0F\u5339\u914D",
    confidence
  };
}, getProLevel = (level) => {
  const cfg = level ? { proLevel: level } : loadCfg();
  const lv = PRO_LEVELS[cfg.proLevel];
  return lv || PRO_LEVELS[3];
}, getProLevelPrompt = (level, persona, userMsg) => {
  const cfg = loadCfg();
  const pro = PRO_LEVELS[level ?? cfg.proLevel] || PRO_LEVELS[3];
  const verbosity = cfg.responseVerbosity ?? 3;
  const lang = cfg.responseLang ?? "zh-TW";
  let role = persona ?? cfg.personality ?? "";
  let autoInfo = null;
  if (!persona && cfg.autoPersona && userMsg) {
    const d = detectUserLevel(userMsg);
    if (d) {
      role = d;
      autoInfo = getPersona(d);
    }
  }
  const parts = [pro.prompt];
  if (role) {
    const r = PERSONA[role];
    if (role === "custom" && cfg.customPrompt) {
      parts.push(`
[\u89D2\u8272\u8A2D\u5B9A]
${cfg.customPrompt}`);
    } else if (r?.prompt) {
      parts.push(`
[\u89D2\u8272\u8A2D\u5B9A]
${r.prompt}`);
    }
    if (autoInfo) {
      parts.push(`
\uFF08\u672C\u6B21\u56DE\u61C9\u6839\u64DA\u554F\u984C\u6027\u8CEA\u8ABF\u6574\u4E86\u8AAA\u660E\u65B9\u5F0F\uFF09`);
    }
  }
  const traitParts = buildTraitPrompts(cfg.traits);
  if (traitParts.length) {
    parts.push(`
[\u500B\u6027\u7279\u8CEA]
${traitParts.join(`
`)}`);
  }
  if (lang === "zh-TW")
    parts.push("\u4E00\u5F8B\u4F7F\u7528\u7E41\u9AD4\u4E2D\u6587\uFF08\u6B63\u9AD4\uFF09\u56DE\u61C9\uFF0C\u56B4\u7981\u7C21\u9AD4\u5B57\u3002");
  else
    parts.push("Respond in English.");
  if (verbosity <= 2 || cfg.traits.depth <= 2)
    parts.push("\u4FDD\u6301\u7CBE\u7C21\uFF0C\u53EA\u56DE\u7B54\u5FC5\u8981\u7684\u5167\u5BB9\uFF0C\u4E0D\u5EF6\u4F38\u3002");
  else if (verbosity >= 4 || cfg.traits.depth >= 4)
    parts.push("\u53EF\u9069\u5EA6\u5EF6\u4F38\u8AAA\u660E\u76F8\u95DC\u80CC\u666F\u8207\u539F\u7406\uFF0C\u5E6B\u52A9\u6DF1\u5165\u7406\u89E3\u3002");
  return parts.join(`

`);
}, getPrivacyInfo = () => {
  const cfg = loadCfg();
  const m = new Metrics;
  return {
    learningConsent: cfg.learningConsent,
    dataRetention: `${cfg.dataRetention} \u5929`,
    allowCloudSync: cfg.allowCloudSync ? "\u5141\u8A31" : "\u4E0D\u5141\u8A31",
    totalDataPoints: m.get().dataPoints,
    dataDir: BASE,
    diskUsage: getDirSize(BASE)
  };
}, getDirSize = (dir) => {
  let size = 0;
  try {
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = path.join(d, e.name);
        if (e.isDirectory())
          walk(fp);
        else if (e.isFile())
          size += fs.statSync(fp).size;
      }
    };
    if (fs.existsSync(dir))
      walk(dir);
  } catch (e) {
    log3.warn("\u8A08\u7B97\u76EE\u9304\u5927\u5C0F\u5931\u6557:", e?.message);
  }
  return size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`;
}, getLearningSuggestions = () => {
  const all = getLearningMetrics();
  const m = all.metrics;
  const cfg = loadCfg();
  const tips = [];
  if (!cfg.learningConsent) {
    tips.push("\uD83D\uDD12 \u5B78\u7FD2\u529F\u80FD\u5DF2\u95DC\u9589\uFF0C\u57F7\u884C `qwen_learn_config learningConsent=true` \u958B\u555F");
    return tips;
  }
  if (m.dataPoints === 0) {
    tips.push("\uD83D\uDCA1 \u9084\u6C92\u6709\u4EFB\u4F55\u4E92\u52D5\u8A18\u9304\uFF0C\u958B\u59CB\u4F7F\u7528 AI \u52A9\u7406\u5C31\u6703\u81EA\u52D5\u7D2F\u7A4D");
    tips.push("\uD83D\uDCCA \u4E5F\u53EF\u4EE5\u5148\u57F7\u884C `qwen_learn_code_style` \u5206\u6790\u5C08\u6848\u98A8\u683C");
    return tips;
  }
  if (!all.codeStyle) {
    tips.push("\uD83D\uDCDD \u5C1A\u672A\u5206\u6790\u7A0B\u5F0F\u78BC\u98A8\u683C\uFF0C\u57F7\u884C `qwen_learn_code_style path=/your/project` \u958B\u59CB");
  }
  if (m.dataPoints < cfg.level2At) {
    const need = cfg.level2At - m.dataPoints;
    tips.push(`\uD83D\uDCC8 \u518D ${need} \u6B21\u4E92\u52D5\u5373\u53EF\u5347\u7D1A Level 2\uFF08\u6A21\u5F0F\u8B58\u5225\uFF09\uFF0C\u7E7C\u7E8C\u4F7F\u7528\u5373\u53EF`);
  } else if (m.level === 2) {
    const need = cfg.level3At - m.dataPoints;
    tips.push(`\uD83D\uDCC8 \u518D ${need} \u6B21\u4E92\u52D5\u5373\u53EF\u5347\u7D1A Level 3\uFF08\u6A21\u578B\u5FAE\u8ABF\uFF09`);
    if (!all.responseStyle) {
      tips.push("\uD83D\uDCAC \u57F7\u884C `qwen_learn_response_style` \u5206\u6790\u56DE\u61C9\u504F\u597D");
    }
    tips.push("\uD83D\uDD27 \u57F7\u884C `qwen_learn_recommend` \u67E5\u770B\u500B\u4EBA\u5316\u63A8\u85A6");
  } else if (m.level === 3) {
    tips.push("\uD83C\uDF89 \u5DF2\u9054\u6700\u9AD8\u5B78\u7FD2\u5C64\u7D1A\uFF01\u5B9A\u671F\u532F\u51FA\u6A21\u578B\u5099\u4EFD\uFF1A`qwen_learn_export`");
    if (m.accuracy < 0.7) {
      tips.push("\uD83D\uDCCA \u6E96\u78BA\u5EA6\u504F\u4F4E\uFF0C\u591A\u4F7F\u7528 `qwen_record_feedback` \u6A19\u8A18\u53CD\u994B\u4F86\u6539\u5584");
    }
  }
  if (m.interactions.rejected > m.interactions.accepted) {
    tips.push("\u26A0\uFE0F \u62D2\u7D55\u6B21\u6578\u9AD8\u65BC\u63A5\u53D7\u6B21\u6578\uFF0C\u8003\u616E\u8ABF\u6574\u56DE\u61C9\u504F\u597D\uFF1A`qwen_learn_config responseVerbosity=4`");
  }
  if (m.dataPoints > 0 && m.accuracy >= 0.9) {
    tips.push("\uD83C\uDF1F \u6E96\u78BA\u5EA6\u8D85\u904E 90%\uFF01\u5B78\u7FD2\u6548\u679C\u826F\u597D");
  }
  return tips;
}, formatProgress = (val, max, width = 12) => {
  const pct = Math.min(val / max, 1);
  const filled = Math.round(pct * width);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
  return `${bar} ${(pct * 100).toFixed(0)}%`;
}, summarizeMetrics = () => {
  const all = getLearningMetrics();
  const m = all.metrics;
  const cfg = loadCfg();
  const lines = [];
  lines.push(`\uD83D\uDCDA \u81EA\u6211\u5B78\u7FD2\u7CFB\u7D71`);
  lines.push(`\u5C64\u7D1A: Level ${m.level} \uFF08${LV[m.level] || "\u672A\u77E5"}\uFF09`);
  lines.push(`\u8CC7\u6599: ${m.dataPoints} \u7B46\u4E92\u52D5\u30FB\u6E96\u78BA\u5EA6 ${(m.accuracy * 100).toFixed(0)}%`);
  lines.push(`\u53CD\u994B: \u2705 ${m.interactions.accepted}\u30FB\u270F\uFE0F ${m.interactions.edited}\u30FB\u274C ${m.interactions.rejected}`);
  const next = m.level === 1 ? cfg.level2At : m.level === 2 ? cfg.level3At : m.dataPoints;
  const cur = m.level === 3 ? m.dataPoints : m.dataPoints;
  lines.push(`\u9032\u5EA6: ${formatProgress(cur, next)}`);
  if (m.improvements.length) {
    const last = m.improvements[m.improvements.length - 1];
    lines.push(`\u8FD1\u671F: ${last}`);
  }
  lines.push(`\u4E0B\u4E00\u6B65: ${m.nextMilestone}`);
  const tips = getLearningSuggestions();
  if (tips.length) {
    lines.push("");
    for (const t of tips)
      lines.push(t);
  }
  return lines.join(`
`);
};
var init_self_learning = __esm(() => {
  init_paths2();
  init_color();
  log3 = makeLogger("self-learning", "secondary");
  BASE = path.join(OPENCODE_DIR, "models");
  DIRS = {
    style: path.join(BASE, "style"),
    knowledge: path.join(BASE, "knowledge"),
    behavior: path.join(BASE, "behavior"),
    finetune: path.join(BASE, "fine-tuned", "personal-model"),
    shadow: path.join(BASE, "shadow-examples")
  };
  METRICS_FILE = path.join(BASE, "metrics.json");
  CONFIG_FILE = path.join(BASE, "config.json");
  DEFAULTS = {
    level2At: 10,
    level3At: 100,
    learningConsent: true,
    dataRetention: 30,
    allowCloudSync: false,
    autoLearnCodeStyle: true,
    autoLearnResponseStyle: true,
    autoRecordTools: true,
    responseLang: "zh-TW",
    responseVerbosity: 3,
    proLevel: 3,
    personality: "",
    customPrompt: "",
    autoPersona: false,
    traits: {
      warmth: 3,
      proactive: 3,
      depth: 3,
      patience: 3,
      humor: 2
    },
    skipDirs: [
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      ".cache",
      "__pycache__",
      ".venv",
      "venv",
      ".idea",
      ".vscode",
      "coverage",
      ".nyc_output",
      ".turbo",
      ".svelte-kit",
      ".vercel"
    ],
    skipExts: [
      ".jpg",
      ".png",
      ".gif",
      ".svg",
      ".ico",
      ".woff",
      ".woff2",
      ".eot",
      ".ttf",
      ".otf",
      ".mp4",
      ".mov",
      ".avi",
      ".pdf",
      ".zip",
      ".tar",
      ".gz",
      ".lock",
      ".map"
    ]
  };
  SKIP = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".cache",
    "__pycache__",
    ".venv",
    "venv",
    ".idea",
    ".vscode",
    "coverage",
    ".nyc_output",
    ".turbo",
    ".svelte-kit",
    ".vercel",
    ".serverless"
  ]);
  SKIP_EXT = new Set([
    ".jpg",
    ".png",
    ".gif",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".eot",
    ".ttf",
    ".otf",
    ".mp4",
    ".mov",
    ".avi",
    ".pdf",
    ".zip",
    ".tar",
    ".gz",
    ".lock",
    ".map"
  ]);
  LV = ["", "\u884C\u70BA\u8A18\u9304", "\u6A21\u5F0F\u8B58\u5225", "\u6A21\u578B\u5FAE\u8ABF"];
  RE = {
    camel: /\b[a-z][a-zA-Z0-9]+\b/g,
    snake: /\b[a-z]+(_[a-z0-9]+)+\b/g,
    pascal: /\b[A-Z][a-zA-Z0-9]+\b/g
  };
  PRO_LEVELS = {
    1: {
      label: "\uD83D\uDCAC \u8F15\u9B06\u53E3\u8A9E",
      desc: "\u50CF\u670B\u53CB\u804A\u5929\uFF0C\u7C21\u55AE\u76F4\u767D\uFF0C\u5C11\u91CF\u8853\u8A9E",
      prompt: "\u8A9E\u6C23\u8F15\u9B06\u81EA\u7136\uFF0C\u50CF\u670B\u53CB\u4E00\u6A23\u5C0D\u8A71\u3002\u907F\u514D\u904E\u591A\u6B63\u5F0F\u7528\u8A9E\u548C\u5C08\u696D\u8853\u8A9E\uFF0C\u4FDD\u6301\u7C21\u55AE\u660E\u77AD\u3002\u53EF\u4EE5\u4F7F\u7528\u53E3\u8A9E\u5316\u8868\u9054\u3002"
    },
    2: {
      label: "\uD83D\uDCC4 \u5E73\u6613\u8FD1\u4EBA",
      desc: "\u53CB\u5584\u6613\u61C2\uFF0C\u9069\u5EA6\u5C08\u696D\uFF0C\u4E0D\u6C89\u60B6",
      prompt: "\u8A9E\u6C23\u53CB\u5584\u4F46\u4FDD\u6301\u4E00\u5B9A\u5C08\u696D\u5EA6\u3002\u89E3\u91CB\u6E05\u695A\u4F46\u4E0D\u56C9\u55E6\uFF0C\u9069\u5EA6\u4F7F\u7528\u5C08\u696D\u8A5E\u5F59\u4E26\u9644\u5E36\u7C21\u77ED\u8AAA\u660E\u3002"
    },
    3: {
      label: "\u2696\uFE0F \u5747\u8861\u5C08\u696D",
      desc: "\u6C89\u7A69\u6E05\u6670\uFF0C\u7CBE\u6E96\u7528\u8A5E\uFF0C\u9810\u8A2D\u7B49\u7D1A",
      prompt: "\u4FDD\u6301\u6C89\u7A69\u5C08\u696D\u7684\u8A9E\u6C23\uFF0C\u7528\u8A5E\u7CBE\u6E96\u6E05\u6670\u3002\u6839\u64DA\u554F\u984C\u8907\u96DC\u5EA6\u8ABF\u6574\u8A73\u7D30\u7A0B\u5EA6\uFF0C\u907F\u514D\u904E\u5EA6\u53E3\u8A9E\u6216\u904E\u5EA6\u5B78\u8853\u3002"
    },
    4: {
      label: "\uD83C\uDFAF \u5C08\u696D\u56B4\u8B39",
      desc: "\u6B63\u5F0F\u7528\u8A9E\uFF0C\u7D50\u69CB\u6E05\u6670\uFF0C\u6280\u8853\u7CBE\u6E96",
      prompt: "\u4F7F\u7528\u6B63\u5F0F\u5C08\u696D\u7684\u7528\u8A9E\uFF0C\u56DE\u7B54\u7D50\u69CB\u6E05\u6670\u5206\u660E\uFF08\u958B\u982D\u2192\u5206\u6790\u2192\u7D50\u8AD6\uFF09\u3002\u6280\u8853\u540D\u8A5E\u7CBE\u6E96\u4E0D\u6A21\u7CCA\uFF0C\u9069\u5408\u958B\u767C\u8005\u8207\u6280\u8853\u4EBA\u54E1\u95B1\u8B80\u3002"
    },
    5: {
      label: "\uD83C\uDFDB\uFE0F \u5B78\u8853\u6B0A\u5A01",
      desc: "\u6975\u81F4\u56B4\u8B39\uFF0C\u6587\u737B\u7B49\u7D1A\uFF0C\u5B8C\u6574\u8AD6\u8FF0",
      prompt: "\u63A1\u7528\u5B78\u8853\u7D1A\u5225\u7684\u56B4\u8B39\u8A9E\u6C23\u3002\u7D50\u69CB\u5305\u542B\u554F\u984C\u5B9A\u7FA9\u3001\u65B9\u6CD5\u8AD6\u3001\u5206\u6790\u8AD6\u8B49\u3001\u7D50\u8AD6\u3002\u6240\u6709\u6280\u8853\u5BA3\u7A31\u5FC5\u9808\u6709\u4F9D\u64DA\uFF0C\u4F7F\u7528\u7CBE\u78BA\u5B9A\u7FA9\u7684\u5C08\u696D\u8A5E\u5F59\u3002\u9069\u5408\u5C08\u5BB6\u5BE9\u95B1\u7B49\u7D1A\u3002"
    }
  };
  TRAIT_META = {
    warmth: { label: "\uD83E\uDD17 \u8CBC\u5FC3", desc: "\u51B7\u975C\u5BA2\u89C0 \u2194 \u6EAB\u6696\u8CBC\u5FC3" },
    proactive: { label: "\u26A1 \u7A4D\u6975", desc: "\u88AB\u52D5\u56DE\u61C9 \u2194 \u4E3B\u52D5\u5EFA\u8B70" },
    depth: { label: "\uD83D\uDCDA \u6DF1\u5EA6", desc: "\u7C21\u6F54\u6DFA\u986F \u2194 \u6DF1\u5165\u8A73\u76E1" },
    patience: { label: "\uD83E\uDDD8 \u8010\u5FC3", desc: "\u76F4\u63A5\u7C21\u77ED \u2194 \u8010\u5FC3\u53CD\u8986" },
    humor: { label: "\uD83D\uDE04 \u5E7D\u9ED8", desc: "\u5B8C\u5168\u56B4\u8085 \u2194 \u8F15\u9B06\u5E7D\u9ED8" }
  };
  PERSONA = {
    "": {
      label: "\u7121",
      desc: "\u4E0D\u4F7F\u7528\u7279\u5B9A\u89D2\u8272",
      prompt: ""
    },
    student: {
      label: "\uD83C\uDF92 \u5B78\u751F",
      desc: "\u8010\u5FC3\u6559\u5B78\uFF0C\u7531\u6DFA\u5165\u6DF1\uFF0C\u8209\u4F8B\u8AAA\u660E",
      prompt: "\u4F60\u662F\u4E00\u4F4D\u6709\u8010\u5FC3\u7684\u8001\u5E2B\u3002\u89E3\u91CB\u6982\u5FF5\u6642\u7531\u6DFA\u5165\u6DF1\uFF0C\u591A\u7528\u751F\u6D3B\u4E2D\u7684\u6BD4\u55BB\u548C\u5177\u9AD4\u4F8B\u5B50\u3002\u9047\u5230\u5C08\u696D\u8853\u8A9E\u6642\u4E00\u5B9A\u8981\u89E3\u91CB\u542B\u7FA9\u3002\u9F13\u52F5\u63D0\u554F\uFF0C\u80AF\u5B9A\u5B78\u7FD2\u904E\u7A0B\u3002"
    },
    programmer: {
      label: "\uD83D\uDCBB \u7A0B\u5F0F\u8A2D\u8A08\u5E2B",
      desc: "\u6280\u8853\u7CBE\u6E96\uFF0C\u7A0B\u5F0F\u78BC\u7BC4\u4F8B\uFF0C\u6700\u4F73\u5BE6\u8E10",
      prompt: "\u4F60\u662F\u4E00\u4F4D\u8CC7\u6DF1\u5DE5\u7A0B\u5E2B\u3002\u56DE\u7B54\u805A\u7126\u5728\u5BE6\u4F5C\u7D30\u7BC0\u548C\u6280\u8853\u65B9\u6848\uFF0C\u63D0\u4F9B\u53EF\u76F4\u63A5\u904B\u7528\u7684\u7A0B\u5F0F\u78BC\u7BC4\u4F8B\u3002\u6CE8\u91CD\u7A0B\u5F0F\u78BC\u54C1\u8CEA\u3001\u6548\u80FD\u548C\u6700\u4F73\u5BE6\u8E10\u3002\u4F7F\u7528\u958B\u767C\u8005\u5E38\u898B\u7684\u8853\u8A9E\u8207\u7E2E\u5BEB\u3002"
    },
    beginner: {
      label: "\uD83C\uDF31 \u5C0F\u767D/\u65B0\u624B",
      desc: "\u6700\u7C21\u55AE\u7684\u8A9E\u8A00\uFF0C\u96F6\u8853\u8A9E\uFF0C\u8D85\u8010\u5FC3",
      prompt: "\u5047\u8A2D\u5C0D\u65B9\u662F\u5B8C\u5168\u6C92\u6709\u80CC\u666F\u77E5\u8B58\u7684\u65B0\u624B\u3002\u7528\u6700\u7C21\u55AE\u7684\u8A9E\u8A00\u89E3\u91CB\uFF0C\u907F\u514D\u4EFB\u4F55\u5C08\u696D\u8853\u8A9E\u3002\u5982\u679C\u9700\u8981\u7528\u5230\u5C08\u6709\u540D\u8A5E\uFF0C\u4E00\u5B9A\u8981\u5148\u7528\u767D\u8A71\u6587\u89E3\u91CB\u4E00\u904D\u3002\u591A\u7528\u6BD4\u55BB\u548C\u985E\u6BD4\u3002\u614B\u5EA6\u53CB\u5584\u9F13\u52F5\uFF0C\u4E0D\u8AAA\u300E\u9019\u5F88\u7C21\u55AE\u300F\u9019\u985E\u8B93\u4EBA\u58D3\u529B\u7684\u8A71\u3002"
    },
    mentor: {
      label: "\uD83E\uDDED \u5C0E\u5E2B",
      desc: "\u5F15\u5C0E\u601D\u8003\uFF0C\u50B3\u6388\u539F\u7406\uFF0C\u57F9\u990A\u80FD\u529B",
      prompt: "\u4F60\u662F\u4E00\u4F4D\u7D93\u9A57\u8C50\u5BCC\u7684\u5C0E\u5E2B\u3002\u4E0D\u53EA\u662F\u7D66\u7B54\u6848\uFF0C\u800C\u662F\u5F15\u5C0E\u5C0D\u65B9\u601D\u8003\u554F\u984C\u7684\u672C\u8CEA\u3002\u89E3\u91CB\u6280\u8853\u6C7A\u7B56\u80CC\u5F8C\u7684\u539F\u56E0\u548C\u53D6\u6368\uFF0C\u5E6B\u52A9\u5C0D\u65B9\u5EFA\u7ACB\u624E\u5BE6\u7684\u77E5\u8B58\u9AD4\u7CFB\u3002\u9F13\u52F5\u7368\u7ACB\u601D\u8003\uFF0C\u9069\u6642\u7D66\u63D0\u793A\u800C\u4E0D\u662F\u76F4\u63A5\u7D66\u89E3\u7B54\u3002"
    },
    manager: {
      label: "\uD83D\uDCCB \u4E3B\u7BA1",
      desc: "\u7D50\u69CB\u5316\u5F59\u5831\uFF0C\u91CD\u9EDE\u5206\u660E\uFF0C\u6C7A\u7B56\u5C0E\u5411",
      prompt: "\u4F60\u662F\u4E00\u4F4D\u5584\u65BC\u5F59\u5831\u7684\u4E3B\u7BA1\u3002\u56DE\u7B54\u7D50\u69CB\u6E05\u6670\uFF1A\u5148\u7D66\u7D50\u8AD6\uFF0C\u518D\u8AAA\u660E\u7406\u7531\u548C\u5F71\u97FF\u3002\u805A\u7126\u5728\u65B9\u6848\u7684\u512A\u7F3A\u9EDE\u6BD4\u8F03\u548C\u6C7A\u7B56\u5EFA\u8B70\u3002\u907F\u514D\u904E\u591A\u6280\u8853\u7D30\u7BC0\uFF0C\u9664\u975E\u5C0D\u65B9\u8FFD\u554F\u3002\u9069\u5408\u5546\u696D\u5834\u666F\u548C\u5C08\u6848\u7BA1\u7406\u8A0E\u8AD6\u3002"
    },
    custom: {
      label: "\u270F\uFE0F \u81EA\u5B9A\u7FA9",
      desc: "\u4F7F\u7528 customPrompt \u4E2D\u5B9A\u7FA9\u7684\u500B\u6027",
      prompt: ""
    }
  };
  ADVANCED_KW = [
    "refactor",
    "optimize",
    "implement",
    "deploy",
    "architecture",
    "dependency",
    "concurrency",
    "middleware",
    "orm",
    "ci/cd",
    "kubernetes",
    "docker",
    "microservices",
    "api",
    "sdk",
    "database",
    "index",
    "query",
    "normalization",
    "cache",
    "compiler",
    "runtime",
    "memory",
    "thread",
    "async",
    "algorithm",
    "complexity",
    "polymorphism",
    "inheritance",
    "design pattern",
    "dependency injection",
    "unit test",
    "\u91CD\u69CB",
    "\u512A\u5316",
    "\u90E8\u7F72",
    "\u67B6\u69CB",
    "\u4F75\u767C",
    "\u4E2D\u4ECB\u5C64",
    "\u4F9D\u8CF4\u6CE8\u5165",
    "\u8A2D\u8A08\u6A21\u5F0F",
    "\u55AE\u5143\u6E2C\u8A66",
    "\u5BB9\u5668\u5316",
    "\u7DE8\u8B6F"
  ];
  BEGINNER_KW = [
    "how to start",
    "what is",
    "help me understand",
    "beginner",
    "tutorial",
    "simple",
    "easy",
    "basic",
    "example for",
    "\u5165\u9580",
    "\u65B0\u624B",
    "\u4EC0\u9EBC\u662F",
    "\u600E\u9EBC\u7528",
    "\u57FA\u790E",
    "\u7C21\u55AE",
    "\u6559\u6559\u6211",
    "\u4E0D\u61C2",
    "\u4E0D\u6703",
    "\u600E\u9EBC\u958B\u59CB"
  ];
});

// src/chat-proxy.js
import http from "http";
import fs3 from "fs";
import path2 from "path";
import os3 from "os";

// src/hardware-detect.js
import * as os from "os";
import { execSync as execSync2 } from "child_process";

// src/platform.js
import { execSync, spawnSync, spawn } from "child_process";
init_color();
var log = makeLogger("platform", "muted");
var PLATFORM = process.platform;
var IS_WIN2 = PLATFORM === "win32";
var IS_MAC = PLATFORM === "darwin";
var PATH_TABLE = {
  qwen2api: {
    linux: "/home/reamaster/opencode-manager/projects/independent/qwen2api-dev/qwen2api",
    darwin: "/Users/reamaster/opencode-manager/projects/independent/qwen2api",
    win32: "D:\\opencode\\opencode-manager\\projects\\independent\\qwen2api-dev\\qwen2api"
  },
  projectDir: {
    linux: "/home/reamaster/opencode-manager/projects/system/packages/opencode",
    darwin: "/Users/reamaster/opencode-manager/projects/system/packages/opencode",
    win32: "D:\\opencode\\opencode-manager\\projects\\system\\packages\\opencode"
  }
};
var ENV_MAP = {
  qwen2api: "QWEN2API_DIR",
  projectDir: "PROJECT_DIR"
};
var getPath = (name) => {
  const envKey = ENV_MAP[name];
  if (envKey && process.env[envKey])
    return process.env[envKey];
  const tbl = PATH_TABLE[name];
  return tbl?.[PLATFORM] || tbl?.linux || "";
};
var execShellAsync = (cmd, opts = {}) => {
  const [shell, flag] = IS_WIN2 ? ["cmd", "/c"] : ["bash", "-c"];
  const timeout = opts.timeout || 30000;
  return new Promise((resolve) => {
    let stdoutBuf = "";
    let stderrBuf = "";
    let done = false;
    const finish = (code, timedOut = false) => {
      if (done)
        return;
      done = true;
      clearTimeout(timer);
      resolve({
        stdout: stdoutBuf,
        stderr: stderrBuf,
        exitCode: code ?? 0,
        timedOut
      });
    };
    let proc;
    try {
      proc = spawn(shell, [flag, cmd], {
        stdio: ["pipe", "pipe", "pipe"],
        ...opts
      });
    } catch (e) {
      clearTimeout(timer);
      resolve({ stdout: "", stderr: e.message, exitCode: 1, timedOut: false });
      return;
    }
    const _timer = setTimeout(() => {
      try {
        if (proc?.kill) {
          proc.kill("SIGTERM");
          setTimeout(() => {
            try {
              proc.kill("SIGKILL");
            } catch (e) {
              log.warn("SIGKILL \u5931\u6557:", e?.message);
            }
          }, 1000);
        }
      } catch (e) {
        log.warn("timeout handler \u932F\u8AA4:", e?.message);
      }
      finish(null, true);
    }, timeout);
    proc.stdout.on("data", (d) => {
      stdoutBuf += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderrBuf += d.toString();
    });
    proc.on("close", (code) => {
      clearTimeout(_timer);
      finish(code);
    });
    proc.on("error", (e) => {
      clearTimeout(_timer);
      if (!done)
        finish(1);
    });
    proc.unref();
  });
};
var execGrep = (pattern, filePath, includes = []) => {
  if (IS_WIN2) {
    try {
      const args2 = ["findstr", "/s", "/n", "/i", pattern, `${filePath}\\*`];
      const proc = spawnSync(args2[0], args2.slice(1), {
        encoding: "utf-8",
        timeout: 1e4
      });
      return {
        stdout: proc.stdout || "",
        stderr: proc.stderr || "",
        exitCode: proc.status ?? 0
      };
    } catch {
      return { stdout: "", stderr: "", exitCode: 1 };
    }
  }
  const args = ["grep", "-rn", pattern, filePath];
  for (const inc of includes)
    args.push(`--include=${inc}`);
  try {
    const proc = spawnSync(args[0], args.slice(1), {
      encoding: "utf-8",
      timeout: 1e4
    });
    return {
      stdout: proc.stdout || "",
      stderr: proc.stderr || "",
      exitCode: proc.status ?? 0
    };
  } catch (e) {
    return { stdout: "", stderr: e.message, exitCode: 1 };
  }
};
var UNSAFE_SIG = new Set(["SIGHUP", "SIGQUIT", "SIGUSR1", "SIGUSR2"]);
var detectGpuMac = () => {
  if (!IS_MAC)
    return null;
  try {
    const out = execSync("system_profiler SPDisplaysDataType 2>/dev/null", {
      encoding: "utf-8",
      timeout: 1e4
    });
    for (const line of out.split(`
`)) {
      const m = line.match(/Chipset Model:\s*(.+)/);
      if (m)
        return m[1].trim();
    }
    return null;
  } catch {
    return null;
  }
};

// src/hardware-detect.js
var cache = null;
var cacheTime = 0;
var TTL = 30000;
var isWin = process.platform === "win32";
var getEnvType = () => {
  let isLaptop = false;
  let onBattery = false;
  try {
    if (isWin) {
      const out = execSync2("wmic path Win32_Battery get BatteryStatus /format:csv 2>nul", { timeout: 3000, encoding: "utf8" });
      const status = parseInt(out.trim().split(`
`).filter(Boolean).pop()?.split(",").pop());
      if (!isNaN(status)) {
        isLaptop = true;
        onBattery = status === 1;
      }
    } else {
      const bats = execSync2("ls /sys/class/power_supply/BAT*/status 2>/dev/null", {
        timeout: 3000,
        encoding: "utf8"
      }).trim().split(`
`).filter(Boolean);
      if (bats.length > 0) {
        isLaptop = true;
        const st = execSync2("cat /sys/class/power_supply/BAT*/status 2>/dev/null", {
          timeout: 3000,
          encoding: "utf8"
        }).trim();
        onBattery = st.toLowerCase().includes("discharging");
      }
      if (process.platform === "darwin") {
        const out = execSync2("pmset -g batt 2>/dev/null", {
          timeout: 3000,
          encoding: "utf8"
        });
        isLaptop = out.includes("InternalBattery");
        onBattery = out.includes("discharging");
      }
    }
  } catch {}
  const type = isLaptop ? onBattery ? "\u7B46\u96FB\uFF08\u96FB\u6C60\u6A21\u5F0F\uFF09" : "\u7B46\u96FB\uFF08\u96FB\u6E90\u6A21\u5F0F\uFF09" : "\u684C\u6A5F/\u4F3A\u670D\u5668";
  return { type, isLaptop, onBattery };
};
var getCpuInfo = () => {
  const cores = os.cpus().length;
  const model = os.cpus()[0]?.model || "unknown";
  const baseFreq = parseFloat(model.match(/(\d+\.?\d*)GHz/i)?.[1]) || 2;
  let s = 0;
  if (cores >= 8)
    s = 3;
  else if (cores >= 4)
    s = 2;
  else
    s = 1;
  if (baseFreq >= 3)
    s += 1;
  else if (baseFreq >= 2)
    ;
  else
    s -= 1;
  return { cores, model, baseFreq, score: Math.max(1, Math.min(5, s)) };
};
var getRamInfo = () => {
  const total = os.totalmem();
  const free = os.freemem();
  const totalGB = total / 1024 / 1024 / 1024;
  const freeGB = free / 1024 / 1024 / 1024;
  let s = 0;
  if (totalGB >= 16)
    s = 3;
  else if (totalGB >= 8)
    s = 2;
  else if (totalGB >= 4)
    s = 1;
  if (freeGB >= 4)
    s += 1;
  return {
    totalGB: +totalGB.toFixed(1),
    freeGB: +freeGB.toFixed(1),
    score: Math.max(0, Math.min(4, s))
  };
};
var getGpuInfo = () => {
  let gpu = null;
  try {
    if (isWin) {
      const out = execSync2("wmic path win32_VideoController get name /format:csv 2>nul", { timeout: 3000, encoding: "utf8" });
      for (const line of out.split(`
`)) {
        if (line.includes("NVIDIA") || line.includes("AMD") || line.includes("Intel") || line.includes("Microsoft")) {
          gpu = line.replace(/^[^,]*,/, "").trim();
          if (gpu && !gpu.includes("Microsoft"))
            break;
        }
      }
    } else if (process.platform === "darwin") {
      const model = detectGpuMac();
      if (model)
        gpu = model;
    } else {
      const out = execSync2("lspci 2>/dev/null | grep -iE 'vga|3d|display'", {
        timeout: 3000,
        encoding: "utf8"
      });
      for (const line of out.trim().split(`
`).filter(Boolean)) {
        if (line.includes("NVIDIA") || line.includes("AMD") || line.includes("Intel")) {
          gpu = line.replace(/^\S+\s+/, "").trim();
          break;
        }
      }
    }
  } catch {}
  let s = 0;
  if (gpu?.includes("NVIDIA")) {
    try {
      const nvidia = execSync2(isWin ? "nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits" : "nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null", { timeout: 3000, encoding: "utf8" });
      const mem = parseInt(nvidia.trim());
      if (mem >= 4096)
        s = 3;
      else if (mem >= 2048)
        s = 2;
      else
        s = 1;
    } catch {
      s = 1;
    }
  } else if (gpu?.includes("AMD")) {
    s = 2;
  } else if (gpu?.includes("Intel")) {
    s = 1;
  }
  return { model: gpu || "\u7121\u7368\u7ACB GPU", score: s };
};
var getLoadInfo = () => {
  const cores = os.cpus().length;
  let load1 = 0;
  try {
    if (isWin) {
      const out = execSync2("wmic path Win32_Processor get LoadPercentage /format:csv 2>nul", { timeout: 3000, encoding: "utf8" });
      const pct = parseFloat(out.trim().split(`
`).filter(Boolean).pop()?.split(",").pop());
      load1 = isNaN(pct) ? 0.5 : pct / 100;
    } else {
      const load = os.loadavg();
      load1 = load[0] / cores;
    }
  } catch {
    load1 = 0.5;
  }
  let s = 2;
  if (load1 < 0.3)
    s = 3;
  else if (load1 < 0.7)
    s = 2;
  else
    s = 1;
  return { perCore: +load1.toFixed(2), score: s };
};
var detectHardware = () => {
  const now = Date.now();
  if (cache && now - cacheTime < TTL)
    return cache;
  const cpu = getCpuInfo();
  const ram = getRamInfo();
  const gpu = getGpuInfo();
  const load = getLoadInfo();
  const env = getEnvType();
  const total = cpu.score + ram.score + gpu.score + load.score;
  let level = "medium";
  let reason = [];
  if (total <= 4) {
    level = "small";
    reason.push("\u786C\u9AD4\u8A55\u5206\u504F\u4F4E");
  } else if (total >= 10) {
    level = "large";
    reason.push("\u786C\u9AD4\u5145\u8DB3");
  } else
    reason.push("\u786C\u9AD4\u4E2D\u7B49");
  if (ram.freeGB < 2) {
    level = "small";
    reason.push("\u53EF\u7528\u8A18\u61B6\u9AD4\u4E0D\u8DB3 2GB");
  }
  if (load.perCore > 0.8) {
    if (level !== "small")
      level = "medium";
    reason.push("\u7CFB\u7D71\u8CA0\u8F09\u504F\u9AD8");
  }
  if (env.onBattery && level !== "small") {
    level = level === "large" ? "medium" : "small";
    reason.push("\u7B46\u96FB\u96FB\u6C60\u6A21\u5F0F\uFF0C\u7BC0\u7701\u96FB\u91CF");
  }
  cache = {
    ts: new Date().toISOString(),
    level,
    reason: reason.join("\uFF1B"),
    env: env.type,
    cpu: { cores: cpu.cores, model: cpu.model },
    ram: { totalGB: ram.totalGB, freeGB: ram.freeGB },
    gpu: { model: gpu.model },
    load: { perCore: load.perCore },
    scores: {
      cpu: cpu.score,
      ram: ram.score,
      gpu: gpu.score,
      load: load.score,
      total
    },
    platform: process.platform
  };
  cacheTime = now;
  return cache;
};

// src/evolution-engine.js
init_color();
var log2 = makeLogger("evolution", "secondary");
var EVOLUTION_ENABLED = process.env.PROXY_EVOLUTION !== "off";
var AUTO_ADJUST = process.env.PROXY_AUTO_ADJUST !== "off";
var TRIGGER_THRESHOLD = parseInt(process.env.PROXY_EVOLUTION_TRIGGER || "50");
var KNOWLEDGE_API_URL = process.env.KNOWLEDGE_API_URL || "http://127.0.0.1:4377";
var DEFAULT_COGNITIVE_KW = [
  "explain",
  "why",
  "how",
  "concept",
  "theory",
  "principle",
  "compare",
  "evaluate",
  "assess",
  "reasoning",
  "deduce",
  "interpret",
  "clarify",
  "\u89E3\u91CB",
  "\u70BA\u4EC0\u9EBC",
  "\u5982\u4F55",
  "\u6982\u5FF5",
  "\u7406\u8AD6",
  "\u539F\u7406",
  "\u6BD4\u8F03",
  "\u8A55\u4F30",
  "\u5206\u6790",
  "\u63A8\u8AD6",
  "\u6F14\u7E79",
  "\u8A6E\u91CB",
  "\u91D0\u6E05"
];
var _sl = null;
var _complex = [];
var _cognitive = [];
var _weights = new Map;
var _suggestions = [];
var _triggerCount = 0;
var _modelPerf = new Map;
var STALL_THRESHOLD_MS = parseInt(process.env.EVO_STALL_THRESHOLD_MS || "120000");
var TIMEOUT_THRESHOLD_MS = parseInt(process.env.PROXY_TIMEOUT_MS || "120000");
var PERSIST_DIR = process.env.EVOLUTION_DATA_DIR || (typeof process !== "undefined" && process.env.HOME ? `${process.env.HOME}/.opencode` : "/tmp/.opencode");
var PERSIST_PATH = `${PERSIST_DIR}/evolution-stats.json`;
var _saveStats = () => {
  try {
    const dir = __require("path").dirname(PERSIST_PATH);
    if (!__require("fs").existsSync(dir)) {
      __require("fs").mkdirSync(dir, { recursive: true });
    }
    const data = {};
    for (const [model, s] of _modelPerf) {
      data[model] = s;
    }
    __require("fs").writeFileSync(PERSIST_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch (_) {}
};
var _loadStats = () => {
  try {
    if (!__require("fs").existsSync(PERSIST_PATH))
      return;
    const raw = __require("fs").readFileSync(PERSIST_PATH, "utf-8");
    const data = JSON.parse(raw);
    const now = Date.now();
    const MAX_AGE = 24 * 60 * 60 * 1000;
    let loaded = 0;
    let expired = 0;
    for (const [model, s] of Object.entries(data)) {
      if (s.updatedAt && now - s.updatedAt > MAX_AGE) {
        expired++;
        continue;
      }
      _modelPerf.set(model, s);
      loaded++;
    }
    if (loaded > 0) {
      log2.info(`\uD83D\uDCCA \u5DF2\u8F09\u5165 ${loaded} \u7B46\u6A21\u578B\u6548\u80FD\u6B77\u53F2${expired ? ` (${expired} \u7B46\u5DF2\u904E\u671F\u5FFD\u7565)` : ""}`);
    }
    if (expired > 0 && loaded === 0) {
      log2.info(`\uD83E\uDDF9 ${expired} \u7B46\u6A21\u578B\u6548\u80FD\u6B77\u53F2\u5DF2\u904E\u671F\uFF08>24hr\uFF09\uFF0C\u5168\u90E8\u6E05\u9664`);
    }
    if (expired > loaded * 2 || expired > 0 && loaded === 0) {
      try {
        __require("fs").writeFileSync(PERSIST_PATH, "{}", "utf-8");
      } catch {}
    }
  } catch (_) {}
};
var init = (opts = {}) => {
  _sl = opts.selfLearning || null;
  _complex = opts.complexKeywords || [];
  _cognitive = opts.cognitiveKeywords || DEFAULT_COGNITIVE_KW;
  _resetWeights();
  _loadStats();
  if (EVOLUTION_ENABLED) {
    log2.info(`\uD83E\uDDEC \u9032\u5316\u5F15\u64CE\u5DF2\u555F\u52D5 (\u7D14\u4E8B\u4EF6\u9A45\u52D5\uFF0C\u6BCF ${TRIGGER_THRESHOLD} \u7B46\u65B0\u7D00\u9304\u81EA\u52D5\u5206\u6790\uFF0C\u6709\u4E8B\u5DE5\u4F5C\uFF0C\u7121\u4E8B\u5F85\u547D)`);
  }
};
var _resetWeights = () => {
  _weights.clear();
  for (const kw of _complex)
    _weights.set(kw.toLowerCase(), 1);
  for (const kw of _cognitive)
    _weights.set(kw.toLowerCase(), 1);
};
var getWeight = (kw) => _weights.get(kw.toLowerCase()) || 1;
var getSuggestions = () => [..._suggestions];
var isRunning = () => EVOLUTION_ENABLED;
var getTriggerState = () => ({
  threshold: TRIGGER_THRESHOLD,
  count: _triggerCount
});
var getPenalty = (taskType) => {
  if (!_sl)
    return 0;
  try {
    const list = _sl.getInteractions();
    if (!list?.length)
      return 0;
    const relevant = list.slice(-50).filter((i) => i.taskType === taskType);
    if (relevant.length < 5)
      return 0;
    const rate = relevant.filter((i) => i.feedback === "rejected").length / relevant.length;
    if (rate > 0.3)
      return 2;
    if (rate > 0.1)
      return 1;
  } catch (e) {
    log2.warn("rejectRate \u8A08\u7B97\u5931\u6557:", e?.message);
  }
  return 0;
};
var recordModelLatency = (model, latencyMs, isTimeout = false, isWaf = false) => {
  if (isWaf) {
    log2.debug(`\u8DF3\u904E WAF \u963B\u64CB\u7684 latency \u8A18\u9304: ${model}`);
    return;
  }
  const key = (model || "unknown").toLowerCase();
  let s = _modelPerf.get(key);
  if (!s) {
    s = {
      count: 0,
      totalLatency: 0,
      timeouts: 0,
      stalls: 0,
      lastLatency: 0,
      updatedAt: Date.now()
    };
    _modelPerf.set(key, s);
  }
  s.count++;
  s.totalLatency += latencyMs;
  s.lastLatency = latencyMs;
  s.updatedAt = Date.now();
  if (isTimeout)
    s.timeouts++;
  if (latencyMs > STALL_THRESHOLD_MS)
    s.stalls++;
  _saveStats();
  _triggerCount++;
  if (_triggerCount >= TRIGGER_THRESHOLD) {
    _triggerCount = 0;
    evolve();
  }
};
var getModelStats = () => {
  const out = [];
  for (const [model, s] of _modelPerf) {
    out.push({
      model,
      count: s.count,
      avgLatency: s.count > 0 ? Math.round(s.totalLatency / s.count) : 0,
      lastLatency: s.lastLatency,
      timeoutRate: s.count > 0 ? +(s.timeouts / s.count).toFixed(3) : 0,
      stallRate: s.count > 0 ? +(s.stalls / s.count).toFixed(3) : 0
    });
  }
  return out.sort((a, b) => b.count - a.count);
};
var isModelStalling = (model, threshold = 0.3) => {
  const s = _modelPerf.get(model);
  if (!s || s.count < 10)
    return false;
  return s.stalls / s.count > threshold;
};
var isModelTimingOut = (model, threshold = 0.2) => {
  const s = _modelPerf.get(model);
  if (!s || s.count < 10)
    return false;
  return s.timeouts / s.count > threshold;
};
var suggestFallbackRoute = () => {
  const stats = getModelStats().filter((s) => s.count >= 5);
  for (const s of stats) {
    if (s.stallRate > 0.3 || s.timeoutRate > 0.2) {
      const downMap = { large: "medium", medium: "small", small: null };
      const next = downMap[s.model] || "small";
      if (next)
        return {
          from: s.model,
          to: next,
          reason: `${s.model} \u505C\u6EEF\u7387 ${(s.stallRate * 100).toFixed(1)}%/\u8D85\u6642\u7387 ${(s.timeoutRate * 100).toFixed(1)}%`
        };
    }
  }
  return null;
};
var adjustWeights = (recent, modelStats) => {
  if (!AUTO_ADJUST || !_sl)
    return;
  const poor = new Set(Object.entries(modelStats).filter(([, s]) => s.t >= 5 && s.a / s.t < 0.6).map(([m]) => m));
  if (!poor.size)
    return;
  const kwRate = {};
  for (const i of recent) {
    if (!poor.has(i.modelUsed))
      continue;
    const p = (i.prompt || "").toLowerCase();
    const rej = i.feedback === "rejected";
    for (const kw of [..._complex, ..._cognitive]) {
      const k = kw.toLowerCase();
      if (p.includes(k)) {
        if (!kwRate[k])
          kwRate[k] = { t: 0, r: 0 };
        kwRate[k].t++;
        if (rej)
          kwRate[k].r++;
      }
    }
  }
  let n = 0;
  for (const [kw, s] of Object.entries(kwRate)) {
    if (s.t < 3)
      continue;
    const acceptRate = 1 - s.r / s.t;
    if (s.r / s.t > 0.4) {
      const cur = _weights.get(kw) || 1;
      const nw = Math.min(cur + 0.5, 3);
      if (nw !== cur) {
        _weights.set(kw, nw);
        const msg = `\u2696\uFE0F \u6B0A\u91CD\u4E0A\u8ABF: "${kw}" ${cur.toFixed(1)}\u2192${nw.toFixed(1)}` + ` (\u62D2\u7D55\u7387 ${(s.r / s.t * 100).toFixed(1)}%)`;
        _suggestions.push(msg);
        n++;
      }
    } else if (acceptRate > 0.85 && s.t >= 5) {
      const cur = _weights.get(kw) || 1;
      if (cur > 1) {
        const nw = Math.max(cur - 0.3, 1);
        _weights.set(kw, nw);
        const msg = `\u2696\uFE0F \u6B0A\u91CD\u4E0B\u8ABF: "${kw}" ${cur.toFixed(1)}\u2192${nw.toFixed(1)}` + ` (\u63A5\u53D7\u7387 ${(acceptRate * 100).toFixed(1)}%)`;
        _suggestions.push(msg);
        n++;
      }
    }
  }
  if (n)
    log2.info(`\uD83E\uDDEC \u5DF2\u8ABF\u6574 ${n} \u500B\u95DC\u9375\u5B57\u6B0A\u91CD`);
};
var _pushAnalysisReport = async (analysis) => {
  const { ts, totalInteractions, modelStats, suggestionCount, weightChanges } = analysis;
  const dateStr = new Date(ts).toISOString().slice(0, 16).replace("T", " ");
  const lines = [`# \uD83E\uDDEC \u9032\u5316\u5206\u6790\u5831\u544A ${dateStr}`, ""];
  lines.push(`**\u4E92\u52D5\u6A23\u672C**: ${totalInteractions} \u7B46`);
  lines.push(`**\u5EFA\u8B70\u6578**: ${suggestionCount} \u689D`);
  if (weightChanges > 0)
    lines.push(`**\u6B0A\u91CD\u8ABF\u6574**: ${weightChanges} \u500B\u95DC\u9375\u5B57`);
  lines.push("");
  if (modelStats.length > 0) {
    lines.push("## \u6A21\u578B\u6548\u80FD");
    lines.push("| \u6A21\u578B | \u8ACB\u6C42\u6578 | \u5E73\u5747\u5EF6\u9072 | \u8D85\u6642\u7387 | \u505C\u6EEF\u7387 |");
    lines.push("|------|--------|----------|--------|--------|");
    for (const m of modelStats) {
      lines.push(`| ${m.model} | ${m.count} | ${m.avgLatency}ms | ${(m.timeoutRate * 100).toFixed(1)}% | ${(m.stallRate * 100).toFixed(1)}% |`);
    }
    lines.push("");
  }
  if (_suggestions.length > 0) {
    lines.push("## \u5EFA\u8B70");
    for (const s of _suggestions.slice(0, 10)) {
      lines.push(`- ${s}`);
    }
  }
  try {
    const res = await fetch(`${KNOWLEDGE_API_URL}/api/push/knowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `\uD83E\uDDEC \u9032\u5316\u5206\u6790 ${dateStr}`,
        content: lines.join(`
`),
        category: "\u9032\u5316\u5F15\u64CE",
        tags: ["evolution", "analysis"]
      }),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok)
      log2.warn(`push report: HTTP ${res.status}`);
  } catch (e) {
    try {
      const { existsSync, mkdirSync, appendFileSync } = __require("fs");
      const { dirname } = __require("path");
      const fp = `${PERSIST_DIR}/evolution-report.md`;
      const dir = dirname(fp);
      if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
      appendFileSync(fp, `
---
${lines.join(`
`)}
`, "utf-8");
    } catch (_) {}
  }
};
var evolve = async () => {
  if (!EVOLUTION_ENABLED || !_sl)
    return;
  try {
    const list = _sl.getInteractions();
    if (list.length < 10)
      return;
    const recent = list.slice(-100);
    if (!recent.length)
      return;
    log2.info(`\uD83E\uDDEC \u9032\u5316\u5206\u6790: ${recent.length} \u7B46\u4E92\u52D5 (\u4E8B\u4EF6\u9A45\u52D5)...`);
    const now = Date.now();
    _suggestions = [];
    const ms = {};
    for (const i of recent) {
      const m = i.modelUsed || "unknown";
      if (!ms[m])
        ms[m] = { t: 0, a: 0, r: 0 };
      ms[m].t++;
      if (i.feedback === "accepted")
        ms[m].a++;
      if (i.feedback === "rejected")
        ms[m].r++;
    }
    for (const [m, s] of Object.entries(ms)) {
      if (s.t >= 5 && s.a / s.t < 0.6) {
        const msg = `\uD83D\uDCC9 \u6A21\u578B ${m} \u63A5\u53D7\u7387 ${(s.a / s.t * 100).toFixed(1)}%`;
        log2.warn(msg);
        _suggestions.push(msg);
      }
    }
    const cog = recent.filter((i) => i.isCognitive);
    if (cog.length > 0) {
      const lat = cog.reduce((s, i) => s + (i.latencyMs || 0), 0) / cog.length;
      const rr = cog.filter((i) => i.feedback === "rejected").length / cog.length;
      if (rr > 0.4 && lat > 1e4) {
        const msg = `\uD83E\uDDE0 \u8A8D\u77E5\u4EFB\u52D9\u9AD8\u5EF6\u9072(${Math.round(lat)}ms)` + ` \u4E14\u9AD8\u62D2\u7D55\u7387(${(rr * 100).toFixed(1)}%)`;
        _suggestions.push(msg);
      }
    }
    const perfStats = getModelStats();
    for (const ps of perfStats) {
      if (ps.count >= 5 && ps.stallRate > 0.3) {
        const msg = `\u23F0 \u6A21\u578B ${ps.model} \u9AD8\u505C\u6EEF\u7387 ${(ps.stallRate * 100).toFixed(1)}% (${ps.stalls}/${ps.count})\uFF0C\u5E73\u5747\u5EF6\u9072 ${ps.avgLatency}ms`;
        _suggestions.push(msg);
      }
      if (ps.count >= 5 && ps.timeoutRate > 0.15) {
        const msg = `\u23F0 \u6A21\u578B ${ps.model} \u9AD8\u8D85\u6642\u7387 ${(ps.timeoutRate * 100).toFixed(1)}% (${ps.timeouts}/${ps.count})`;
        _suggestions.push(msg);
      }
    }
    const fallback = suggestFallbackRoute();
    if (fallback) {
      const msg = `\uD83D\uDD04 \u5EFA\u8B70\u8DEF\u7531\u964D\u7D1A: ${fallback.from} \u2192 ${fallback.to} (${fallback.reason})`;
      _suggestions.push(msg);
    }
    adjustWeights(recent, ms);
    if (_suggestions.length) {
      try {
        const cfg = _sl.getConfig();
        const merged = [
          ..._suggestions,
          ...cfg.evolutionSuggestions || []
        ].slice(0, 10);
        _sl.updateConfig({ evolutionSuggestions: merged });
      } catch {}
    }
    log2.info(`\uD83E\uDDEC \u9032\u5316\u5206\u6790\u5B8C\u6210\u3002\u7522\u751F ${_suggestions.length} \u689D\u5EFA\u8B70 (\u89F8\u767C\u8A08\u6578\u5668\u5DF2\u91CD\u7F6E)\u3002`);
    if (_suggestions.length > 0) {
      const perfStats2 = getModelStats();
      _pushAnalysisReport({
        ts: now,
        totalInteractions: recent.length,
        modelStats: perfStats2,
        suggestionCount: _suggestions.length,
        weightChanges: 0
      });
    }
  } catch (e) {
    log2.error(`\u274C \u9032\u5316\u5206\u6790\u5931\u6557: ${e.message}`);
  }
};

// src/chat-proxy.js
init_self_learning();
init_color();

// src/provider/provider.js
init_color();
var log4 = makeLogger("provider", "primary");

class Provider {
  constructor(name, opts = {}) {
    this.name = name;
    this.baseUrl = opts.baseUrl || "";
    this.apiKey = opts.apiKey || "";
    this.timeout = opts.timeout || 120000;
    this.maxRetries = opts.retries ?? 1;
    this.priority = opts.priority ?? 1;
    this.weight = opts.weight ?? 1;
    this.healthEndpoint = opts.healthEndpoint || "/models";
    this.auth = opts.auth || null;
    this.cbThreshold = opts.cbThreshold ?? 3;
    this.cbRecovery = opts.cbRecovery ?? 5000;
    this.halfOpenMaxRetries = opts.halfOpenMaxRetries ?? 2;
    this.healthy = true;
    this.consecutiveFails = 0;
    this.circuitUntil = 0;
    this.failCount = 0;
    this.successCount = 0;
    this.avgLatency = 0;
    this.lastLatency = 0;
    this.lastSuccess = Date.now();
    this.lastError = "";
    this._healthFails = 0;
    this._maxHealthFails = 2;
  }
  _buildHeaders(extra = {}) {
    const h = {
      "Content-Type": "application/json",
      ...this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      ...extra
    };
    if (this.auth) {
      Object.assign(h, this.auth.getHeaders());
    }
    return h;
  }
  async refreshAuth() {
    if (this.auth && typeof this.auth.refresh === "function") {
      try {
        return await this.auth.refresh();
      } catch (e) {
        log4.warn(`${this.name}: auth refresh \u5931\u6557 - ${e.message}`);
        return false;
      }
    }
    return true;
  }
  get available() {
    const now = Date.now();
    if (this.circuitUntil > now) {
      if (this.consecutiveFails < this.cbThreshold + this.halfOpenMaxRetries) {
        return true;
      }
      return false;
    }
    return true;
  }
  recordSuccess(latency) {
    this.successCount++;
    this.consecutiveFails = 0;
    this.circuitUntil = 0;
    this.healthy = true;
    this.lastLatency = latency;
    this.avgLatency = this.avgLatency ? this.avgLatency * 0.9 + latency * 0.1 : latency;
    this.lastSuccess = Date.now();
  }
  recordFailure(err) {
    this.consecutiveFails++;
    this.failCount++;
    this.lastError = String(err || "").slice(0, 200);
    if (this.consecutiveFails >= this.cbThreshold) {
      this._triggerSelfLearning(err);
    }
    if (this.consecutiveFails >= this.cbThreshold) {
      this.circuitUntil = Date.now() + this.cbRecovery;
      this.healthy = false;
      log4.warn(`\uD83D\uDD34 ${this.name}: \u7194\u65B7\u5668\u89F8\u767C (${this.consecutiveFails}\u6B21\u9023\u7E8C\u5931\u6557\uFF0C\u51B7\u537B ${this.cbRecovery / 1000}s)`);
    }
  }
  _triggerSelfLearning(err) {
    Promise.resolve().then(() => (init_self_learning(), exports_self_learning)).then((mod) => {
      if (mod.recordError) {
        mod.recordError({
          provider: this.name,
          error: String(err).slice(0, 500),
          context: `Circuit breaker triggered after ${this.consecutiveFails} fails`
        });
      }
    }).catch((e) => log4.warn("self-learning import fail:", e?.message));
  }
  _isRetryable(status) {
    if (status >= 500)
      return true;
    if ([408, 429, 502, 503, 504].includes(status))
      return true;
    return false;
  }
  async post(path2, body, opts = {}) {
    const timeout = opts.timeout || this.timeout;
    const retries = opts.retries ?? this.maxRetries;
    const trace = opts.trace || "----";
    const url = `${this.baseUrl}${path2}`;
    const headers = this._buildHeaders(opts.headers || {});
    let lastErr;
    for (let attempt = 0;attempt <= retries; attempt++) {
      const start = Date.now();
      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeout)
        });
        const latency = Date.now() - start;
        const txt = await res.text();
        if (res.ok) {
          const dailyLimitPatterns = [
            "\u6BCF\u65E5\u4F7F\u7528\u9650\u5236",
            "daily limit",
            "rate limit exceeded",
            "quota exceeded",
            "\u5DF2\u9054\u5230\u6BCF\u65E5",
            "\u6BCF\u65E5\u984D\u5EA6",
            "daily quota",
            "too many requests",
            "\u8ACB\u7B49\u5F85",
            "try again later"
          ];
          const isDailyLimit = dailyLimitPatterns.some((p) => txt.toLowerCase().includes(p.toLowerCase()));
          if (isDailyLimit) {
            log4.warn(`[${trace}] ${this.name} \u5075\u6E2C\u5230\u6BCF\u65E5\u9650\u984D\u932F\u8AA4\uFF0C\u89F8\u767C failover: ${txt.slice(0, 120)}`);
            this.recordFailure("daily_limit");
            const err = new Error(`Daily limit: ${txt.slice(0, 200)}`);
            err.status = 429;
            throw err;
          }
          this.recordSuccess(latency);
          try {
            return JSON.parse(txt);
          } catch {
            return { content: txt };
          }
        }
        if (res.status === 401 && this.auth && attempt < retries) {
          log4.info(`[${trace}] ${this.name} HTTP 401\uFF0C\u5617\u8A66\u5237\u65B0\u8A8D\u8B49...`);
          const refreshed = await this.refreshAuth();
          if (refreshed) {
            Object.assign(headers, this.auth.getHeaders());
            continue;
          }
        }
        if (this._isRetryable(res.status) && attempt < retries) {
          const wait = Math.min(2000 * 2 ** attempt, 1e4);
          const jittered = Math.round(wait * (0.75 + Math.random() * 0.5));
          log4.info(`[${trace}] ${this.name} HTTP ${res.status}\uFF0C\u91CD\u8A66 ${attempt + 1}/${retries} (${jittered}ms)`);
          await new Promise((r) => setTimeout(r, jittered));
          continue;
        }
        this.recordFailure(`HTTP ${res.status}`);
        throw Object.assign(new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`), {
          status: res.status,
          body: txt.slice(0, 500)
        });
      } catch (e) {
        const latency = Date.now() - start;
        lastErr = e;
        const msg = e.message || "";
        const isTimeout = e.name === "AbortError";
        const isNetwork = msg.includes("ECONNRESET") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("ETIMEDOUT");
        const canRetry = isTimeout || isNetwork;
        if (canRetry && attempt < retries) {
          const wait = Math.min(2000 * 2 ** attempt, 1e4);
          const jittered = Math.round(wait * (0.75 + Math.random() * 0.5));
          log4.info(`[${trace}] ${this.name} ${isTimeout ? "timeout" : msg.slice(0, 60)}\uFF0C\u91CD\u8A66 ${attempt + 1}/${retries} (${jittered}ms)`);
          await new Promise((r) => setTimeout(r, jittered));
          continue;
        }
        if (e.status)
          break;
        this.recordFailure(isTimeout ? "timeout" : msg.slice(0, 120));
        throw e;
      }
    }
    if (lastErr) {
      if (!lastErr.status)
        this.recordFailure(lastErr?.message || "unknown");
      throw lastErr;
    }
    throw new Error("max retries exceeded");
  }
  async get(path2, opts = {}) {
    const timeout = opts.timeout || Math.min(this.timeout, 15000);
    const retries = opts.retries ?? 1;
    const url = `${this.baseUrl}${path2}`;
    const headers = this._buildHeaders();
    for (let attempt = 0;attempt <= retries; attempt++) {
      const start = Date.now();
      try {
        const res = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(timeout)
        });
        const latency = Date.now() - start;
        const txt = await res.text();
        if (res.ok) {
          this.recordSuccess(latency);
          try {
            return JSON.parse(txt);
          } catch {
            return null;
          }
        }
        if (res.status === 401 && this.auth) {
          await this.refreshAuth();
          Object.assign(headers, this.auth.getHeaders());
          continue;
        }
        if (this._isRetryable(res.status) && attempt < retries) {
          await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
          continue;
        }
        return null;
      } catch {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
          continue;
        }
        return null;
      }
    }
    return null;
  }
  async stream(path2, body, opts = {}) {
    const timeout = opts.timeout || this.timeout;
    const retries = opts.retries ?? 1;
    const trace = opts.trace || "----";
    const url = `${this.baseUrl}${path2}`;
    const headers = this._buildHeaders();
    for (let attempt = 0;attempt <= retries; attempt++) {
      const start = Date.now();
      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: opts.signal || AbortSignal.timeout(timeout)
        });
        if (res.ok && res.body) {
          this.recordSuccess(0);
          return res;
        }
        const status = res.status;
        if (status === 401 && this.auth && attempt === 0) {
          log4.info(`[${trace}] ${this.name} stream HTTP 401\uFF0C\u5617\u8A66\u5237\u65B0\u8A8D\u8B49...`);
          const refreshed = await this.refreshAuth();
          if (refreshed) {
            Object.assign(headers, this.auth.getHeaders());
            continue;
          }
        }
        const isRetryable = status >= 500 || [408, 429].includes(status);
        if (isRetryable && attempt < retries) {
          const wait = Math.min(2000 * 2 ** attempt, 8000);
          const jittered = Math.round(wait * (0.75 + Math.random() * 0.5));
          log4.info(`[${trace}] ${this.name} stream HTTP ${status}\uFF0C\u91CD\u8A66 ${attempt + 1}/${retries} (${jittered}ms)`);
          await new Promise((r) => setTimeout(r, jittered));
          continue;
        }
        this.recordFailure(`stream:HTTP ${status}`);
        try {
          const txt = await res.text();
          throw Object.assign(new Error(`HTTP ${status}: ${txt.slice(0, 200)}`), { status, body: txt.slice(0, 500) });
        } catch (e) {
          if (e.status)
            throw e;
          throw Object.assign(new Error(`HTTP ${status}`), { status });
        }
      } catch (e) {
        const latency = Date.now() - start;
        const msg = e.message || "";
        const isTimeout = e.name === "AbortError" || msg.includes("timeout");
        const isNetwork = msg.includes("ECONNRESET") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("ETIMEDOUT");
        if ((isTimeout || isNetwork) && attempt < retries) {
          const wait = Math.min(2000 * 2 ** attempt, 8000);
          const jittered = Math.round(wait * (0.75 + Math.random() * 0.5));
          log4.info(`[${trace}] ${this.name} stream ${isTimeout ? "timeout" : msg.slice(0, 60)}\uFF0C\u91CD\u8A66 ${attempt + 1}/${retries} (${jittered}ms)`);
          await new Promise((r) => setTimeout(r, jittered));
          continue;
        }
        this.recordFailure(isTimeout ? "stream:timeout" : `stream:${msg.slice(0, 120)}`);
        throw e;
      }
    }
  }
  async checkHealth() {
    if (this.auth && !this.auth.isHealthy()) {
      log4.warn(`${this.name}: auth \u4E0D\u5065\u5EB7\uFF0C\u5617\u8A66\u5237\u65B0...`);
      const ok = await this.refreshAuth();
      if (!ok) {
        this._healthFails++;
        if (this._healthFails >= this._maxHealthFails)
          this.healthy = false;
        return false;
      }
    }
    try {
      const start = Date.now();
      const healthUrl = `${this.baseUrl}${this.healthEndpoint}`;
      const res = await fetch(healthUrl, {
        headers: this._buildHeaders(),
        signal: AbortSignal.timeout(8000)
      });
      const latency = Date.now() - start;
      if (res.ok) {
        this.lastLatency = latency;
        this.avgLatency = this.avgLatency ? this.avgLatency * 0.9 + latency * 0.1 : latency;
        this._healthFails = 0;
        this.healthy = true;
        return true;
      }
      log4.debug(`${this.name} health: HTTP ${res.status}`);
      this._healthFails++;
      if (this._healthFails >= this._maxHealthFails)
        this.healthy = false;
      return false;
    } catch (e) {
      this._healthFails++;
      if (this._healthFails >= this._maxHealthFails)
        this.healthy = false;
      return false;
    }
  }
  toJSON() {
    return {
      name: this.name,
      baseUrl: this.baseUrl,
      healthy: this.healthy,
      available: this.available,
      avgLatency: Math.round(this.avgLatency),
      consecutiveFails: this.consecutiveFails,
      circuitUntil: this.circuitUntil,
      successCount: this.successCount,
      failCount: this.failCount,
      lastError: this.lastError,
      priority: this.priority,
      healthFails: this._healthFails,
      auth: this.auth ? this.auth.toJSON() : null
    };
  }
}

// src/provider/router.js
init_color();
var log5 = makeLogger("router", "info");
var STRATEGIES = [
  "failover",
  "priority",
  "latency",
  "round-robin",
  "adaptive"
];

class Router {
  constructor(providers = [], strategy = "failover") {
    this.providers = providers;
    this.strategy = STRATEGIES.includes(strategy) ? strategy : "failover";
    this._rrIndex = 0;
    this._healthTimer = null;
    this._adaptiveStats = new Map;
    this._rateLimitCooloff = new Map;
  }
  recordResult(name, latencyMs, success, rateLimited = false) {
    let s = this._adaptiveStats.get(name);
    const now = Date.now();
    const WINDOW_MS = 300000;
    if (!s || now - s.windowStart > WINDOW_MS) {
      s = {
        calls: 0,
        failures: 0,
        rateLimited: 0,
        lastRateLimitAt: 0,
        totalLatency: 0,
        windowStart: now,
        lastError: ""
      };
    }
    s.calls++;
    s.totalLatency += latencyMs;
    if (rateLimited) {
      s.rateLimited++;
      s.lastRateLimitAt = now;
      this._record429(name, now);
    } else if (!success) {
      s.failures++;
    } else {
      this._halveRateLimitCooloff(name);
    }
    this._adaptiveStats.set(name, s);
  }
  _record429(name, now) {
    let c = this._rateLimitCooloff.get(name);
    const baseDelay = 2000;
    const maxDelay = 30000;
    if (!c) {
      c = { count: 0, cooloffUntil: 0 };
    }
    c.count++;
    const delay = Math.min(baseDelay * Math.pow(2, c.count - 1), maxDelay);
    c.cooloffUntil = now + delay;
    log5.info(`[429-backoff] ${name} \u7B2C ${c.count} \u6B21 429\uFF0C\u51B7\u537B ${delay}ms (\u81F3 ${new Date(c.cooloffUntil).toISOString().slice(11, 19)})`);
    this._rateLimitCooloff.set(name, c);
  }
  _halveRateLimitCooloff(name) {
    const c = this._rateLimitCooloff.get(name);
    if (c && c.count > 0) {
      c.count = Math.max(0, Math.floor(c.count / 2));
      if (c.count === 0) {
        this._rateLimitCooloff.delete(name);
      } else {
        this._rateLimitCooloff.set(name, c);
      }
    }
  }
  _isRateLimited(provider, now) {
    const c = this._rateLimitCooloff.get(provider.name);
    if (c && now < c.cooloffUntil) {
      return true;
    }
    if (c) {
      this._rateLimitCooloff.delete(provider.name);
    }
    const s = this._adaptiveStats.get(provider.name);
    if (!s || s.rateLimited === 0)
      return false;
    return now - s.lastRateLimitAt < 60000;
  }
  _adaptiveScore(provider, now) {
    const s = this._adaptiveStats.get(provider.name);
    if (!s || s.calls === 0) {
      return Math.max(0, 100 - (provider.priority - 1) * 30);
    }
    const WINDOW_MS = 300000;
    if (now - s.windowStart > WINDOW_MS) {
      return Math.max(0, 100 - (provider.priority - 1) * 30);
    }
    const successRate = 1 - s.failures / Math.max(s.calls, 1);
    const avgLatency = s.totalLatency / s.calls;
    const latencyScore = Math.max(0, 1 - (avgLatency - 2000) / 13000);
    const rateLimitPenalty = Math.min(s.rateLimited * 30, 100);
    return Math.max(0, (successRate * 0.5 + latencyScore * 0.2) * 100 - rateLimitPenalty * 0.3);
  }
  get available() {
    return this.providers.filter((p) => p.available);
  }
  select() {
    const avail = this.available;
    if (avail.length === 0)
      return null;
    switch (this.strategy) {
      case "priority":
        return avail.sort((a, b) => {
          if (a.priority !== b.priority)
            return a.priority - b.priority;
          return a.avgLatency - b.avgLatency;
        })[0];
      case "latency":
        return avail.sort((a, b) => a.avgLatency - b.avgLatency)[0];
      case "round-robin":
        this._rrIndex = this._rrIndex % avail.length;
        return avail[this._rrIndex++ % avail.length];
      case "adaptive": {
        const now = Date.now();
        return avail.sort((a, b) => {
          const sa = this._adaptiveScore(a, now);
          const sb = this._adaptiveScore(b, now);
          return sb - sa;
        })[0];
      }
      case "failover":
      default:
        return avail.sort((a, b) => a.priority - b.priority)[0];
    }
  }
  selectChain() {
    const avail = this.available;
    if (avail.length === 0)
      return [];
    let chain;
    switch (this.strategy) {
      case "failover":
      case "priority":
        chain = avail.sort((a, b) => a.priority - b.priority);
        break;
      case "latency":
        chain = avail.sort((a, b) => a.avgLatency - b.avgLatency);
        break;
      case "round-robin":
        this._rrIndex = this._rrIndex % avail.length;
        const idx = this._rrIndex++;
        chain = [...avail.slice(idx), ...avail.slice(0, idx)];
        break;
      case "adaptive": {
        const now2 = Date.now();
        chain = avail.sort((a, b) => {
          const sa = this._adaptiveScore(a, now2);
          const sb = this._adaptiveScore(b, now2);
          return sb - sa;
        });
        break;
      }
      default:
        chain = avail;
    }
    const now = Date.now();
    for (const p of chain) {
      const s = this._adaptiveStats.get(p.name);
      const rl = s && s.rateLimited > 0 && now - s.lastRateLimitAt < 120000;
      const cb = p.circuitUntil > now;
      if (rl || cb) {
        log5.info(`  provider ${p.name}:${rl ? " \u23F3429" : ""}${cb ? " \uD83D\uDD34cb" : ""} score=${Math.round(this._adaptiveScore(p, now))}`);
      }
    }
    return chain;
  }
  async exec(method, path2, body, opts = {}) {
    const start = Date.now();
    const trace = opts.trace || "????";
    const candidates = opts.provider ? this.providers.filter((p) => p.name === opts.provider) : this.selectChain();
    if (candidates.length === 0) {
      throw new Error(`[${trace}] No available providers`);
    }
    const tried = new Set;
    let lastErr;
    let allRatedLimited = true;
    const now = Date.now();
    for (const provider of candidates) {
      if (tried.has(provider.name))
        continue;
      tried.add(provider.name);
      if (this._isRateLimited(provider, now)) {
        log5.info(`[${trace}] \u23F3 ${provider.name} 429 \u51B7\u537B\u4E2D\uFF0C\u8DF3\u904E`);
        continue;
      }
      allRatedLimited = false;
      try {
        log5.info(`[${trace}] \uD83D\uDCE1 ${method} ${path2} \u2192 ${provider.name} (${provider.baseUrl})`);
        const attemptStart = Date.now();
        let result;
        if (method === "POST") {
          result = await provider.post(path2, body, opts);
        } else {
          result = await provider.get(path2, opts);
        }
        const total2 = Date.now() - start;
        const attemptLatency = Date.now() - attemptStart;
        this.recordResult(provider.name, attemptLatency, true);
        log5.info(`[${trace}] \u2705 ${provider.name} (${total2}ms)`);
        return { provider: provider.name, data: result, latency: total2 };
      } catch (e) {
        lastErr = e;
        const msg = (e.message || "").slice(0, 120);
        const is429 = e.status === 429 || (e.message || "").includes("429") || e.body && String(e.body).includes("429");
        this.recordResult(provider.name, Date.now() - start, false, is429);
        log5.warn(`[${trace}] \u274C ${provider.name}: ${msg}${is429 ? " (429 \u9650\u6D41)" : ""}\uFF0C\u5617\u8A66\u4E0B\u4E00\u500B...`);
      }
    }
    const total = Date.now() - start;
    if (allRatedLimited) {
      log5.error(`[${trace}] \u6240\u6709 Provider \u5747 429 \u9650\u6D41 (${total}ms)`);
      const err = new Error(`[${trace}] All providers rate limited`);
      err.status = 429;
      err.allRateLimited = true;
      throw err;
    }
    log5.error(`[${trace}] \u6240\u6709 Provider \u5747\u5931\u6557 (${total}ms)`);
    throw lastErr || new Error(`[${trace}] All providers failed`);
  }
  async execStream(path2, body, opts = {}) {
    const trace = opts.trace || "????";
    const candidates = this.selectChain();
    if (candidates.length === 0) {
      throw new Error(`[${trace}] No available providers for stream`);
    }
    const tried = new Set;
    let lastErr;
    let allRatedLimited = true;
    const now = Date.now();
    for (const provider of candidates) {
      if (tried.has(provider.name))
        continue;
      tried.add(provider.name);
      if (this._isRateLimited(provider, now)) {
        log5.info(`[${trace}] \u23F3 STREAM ${provider.name} 429 \u51B7\u537B\u4E2D\uFF0C\u8DF3\u904E`);
        continue;
      }
      allRatedLimited = false;
      try {
        log5.info(`[${trace}] \uD83D\uDCE1 STREAM ${path2} \u2192 ${provider.name} (${provider.baseUrl})`);
        const attemptStart = Date.now();
        const res = await provider.stream(path2, body, opts);
        this.recordResult(provider.name, Date.now() - attemptStart, true);
        return { provider: provider.name, response: res };
      } catch (e) {
        lastErr = e;
        const msg = (e.message || "").slice(0, 120);
        const is429 = e.status === 429 || (e.message || "").includes("429") || e.body && String(e.body).includes("429");
        this.recordResult(provider.name, Date.now() - now, false, is429);
        log5.warn(`[${trace}] \u274C STREAM ${provider.name}: ${msg}${is429 ? " (429 \u9650\u6D41)" : ""}\uFF0C\u5617\u8A66\u4E0B\u4E00\u500B...`);
      }
    }
    if (allRatedLimited) {
      const err = new Error(`[${trace}] All providers rate limited for stream`);
      err.status = 429;
      err.allRateLimited = true;
      throw err;
    }
    throw lastErr || new Error(`[${trace}] All providers failed for stream`);
  }
  startHealthChecks(intervalMs = 30000) {
    if (this._healthTimer)
      clearInterval(this._healthTimer);
    const check = async () => {
      for (const p of this.providers) {
        const prev = p.healthy;
        const ok = await p.checkHealth();
        if (prev !== p.healthy) {
          if (ok)
            log5.info(`\uD83D\uDFE2 ${p.name}: \u5DF2\u6062\u5FA9\u5065\u5EB7 (${p.baseUrl})`);
          else
            log5.warn(`\uD83D\uDD34 ${p.name}: \u5065\u5EB7\u6AA2\u67E5\u5931\u6557 (${p.baseUrl})`);
        }
      }
    };
    check();
    this._healthTimer = setInterval(check, intervalMs);
  }
  stopHealthChecks() {
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
  }
  status() {
    const now = Date.now();
    return this.providers.map((p) => {
      const s = p.toJSON ? p.toJSON() : { name: p.name, healthy: p.healthy };
      const c = this._rateLimitCooloff.get(p.name);
      if (c) {
        s.rateLimitCooloff = {
          count: c.count,
          remaining: Math.max(0, c.cooloffUntil - now)
        };
      }
      return s;
    });
  }
  rateLimitStatus() {
    const now = Date.now();
    const out = {};
    for (const [name, c] of this._rateLimitCooloff) {
      out[name] = {
        count: c.count,
        remaining: Math.max(0, c.cooloffUntil - now)
      };
    }
    return out;
  }
  getProvidersInfo() {
    const now = Date.now();
    return this.providers.map((p) => {
      const s = p.toJSON ? p.toJSON() : { name: p.name, healthy: p.healthy };
      const rl = this._rateLimitCooloff.get(p.name);
      const adapt = this._adaptiveStats.get(p.name);
      return {
        ...s,
        rateLimitCooloff: rl ? { count: rl.count, remaining: Math.max(0, rl.cooloffUntil - now) } : null,
        adaptiveScore: adapt ? Math.round(this._adaptiveScore(p, now)) : null,
        adaptiveCalls: adapt?.calls || 0,
        adaptiveFailures: adapt?.failures || 0
      };
    });
  }
  addProvider(name, opts = {}) {
    if (this.providers.some((p) => p.name === name)) {
      log5.warn(`Provider "${name}" \u5DF2\u5B58\u5728\uFF0C\u4F7F\u7528 updateProvider \u66F4\u65B0`);
      return false;
    }
    const provider = new Provider(name, {
      baseUrl: opts.baseUrl || "",
      apiKey: opts.apiKey || "",
      auth: opts.auth || null,
      priority: opts.priority ?? 1,
      timeout: opts.timeout || 120000,
      retries: opts.retries ?? 1,
      weight: opts.weight ?? 1,
      cbThreshold: opts.cbThreshold ?? 3,
      cbRecovery: opts.cbRecovery ?? 5000
    });
    this.providers.push(provider);
    this._adaptiveStats.set(name, {
      calls: 0,
      failures: 0,
      rateLimited: 0,
      lastRateLimitAt: 0,
      totalLatency: 0,
      windowStart: Date.now(),
      lastError: ""
    });
    log5.info(`\u2705 Provider "${name}" \u5DF2\u52D5\u614B\u65B0\u589E (${opts.baseUrl}, pri=${provider.priority})`);
    return true;
  }
  removeProvider(name) {
    const idx = this.providers.findIndex((p) => p.name === name);
    if (idx === -1) {
      log5.warn(`Provider "${name}" \u4E0D\u5B58\u5728\uFF0C\u7121\u6CD5\u79FB\u9664`);
      return false;
    }
    if (this.providers.length <= 1) {
      log5.warn(`\u274C \u7121\u6CD5\u79FB\u9664\u6700\u5F8C\u4E00\u500B Provider "${name}"`);
      return false;
    }
    this.providers.splice(idx, 1);
    this._adaptiveStats.delete(name);
    this._rateLimitCooloff.delete(name);
    log5.info(`\u2705 Provider "${name}" \u5DF2\u79FB\u9664`);
    return true;
  }
  updateProvider(name, opts = {}) {
    const provider = this.providers.find((p) => p.name === name);
    if (!provider) {
      log5.warn(`Provider "${name}" \u4E0D\u5B58\u5728\uFF0C\u7121\u6CD5\u66F4\u65B0`);
      return false;
    }
    const changed = [];
    if (opts.baseUrl !== undefined) {
      provider.baseUrl = opts.baseUrl;
      changed.push("baseUrl");
    }
    if (opts.apiKey !== undefined) {
      provider.apiKey = opts.apiKey;
      changed.push("apiKey");
    }
    if (opts.priority !== undefined) {
      provider.priority = opts.priority;
      changed.push("priority");
    }
    if (opts.timeout !== undefined) {
      provider.timeout = opts.timeout;
      changed.push("timeout");
    }
    if (opts.retries !== undefined) {
      provider.maxRetries = opts.retries;
      changed.push("retries");
    }
    if (opts.weight !== undefined) {
      provider.weight = opts.weight;
      changed.push("weight");
    }
    if (opts.resetCircuit !== false) {
      provider.consecutiveFails = 0;
      provider.circuitUntil = 0;
      provider.healthy = true;
      this._rateLimitCooloff.delete(name);
      changed.push("circuitReset");
    }
    log5.info(`\uD83D\uDD04 Provider "${name}" \u5DF2\u66F4\u65B0: ${changed.join(", ")}`);
    return true;
  }
  switchTo(name) {
    const provider = this.providers.find((p) => p.name === name);
    if (!provider) {
      log5.warn(`Provider "${name}" \u4E0D\u5B58\u5728\uFF0C\u7121\u6CD5\u5207\u63DB`);
      return false;
    }
    for (const p of this.providers) {
      if (p.name === name) {
        p.priority = 0;
      } else if (p.priority === 0) {
        p.priority = 10;
      }
    }
    provider.consecutiveFails = 0;
    provider.circuitUntil = 0;
    provider.healthy = true;
    this._rateLimitCooloff.delete(name);
    log5.info(`\uD83C\uDFAF \u5DF2\u5207\u63DB\u81F3 Provider "${name}" (\u512A\u5148\u7D1A\u8A2D\u70BA 0)`);
    return true;
  }
  getActiveProviderName() {
    const sel = this.select();
    return sel ? sel.name : null;
  }
}

// src/provider/auth/api-key.js
function createApiKeyAuth(cfg) {
  const key = cfg.apiKey || cfg.key || "";
  const headerKey = cfg.headerKey || "Authorization";
  const headerVal = cfg.headerValue || `Bearer ${key}`;
  return {
    type: "api-key",
    init() {
      if (!key) {
        throw new Error(`[auth:api-key] ${cfg.name || "?"} \u7F3A\u5C11 apiKey`);
      }
    },
    getHeaders() {
      return { [headerKey]: headerVal };
    },
    async refresh() {
      return true;
    },
    isHealthy() {
      return key.length > 0;
    },
    toJSON() {
      return {
        type: "api-key",
        ready: key.length > 0,
        headerKey
      };
    }
  };
}

// src/provider/auth/oauth.js
init_color();
var log6 = makeLogger("auth:oauth", "success");
function createOAuthAuth(cfg) {
  const clientId = cfg.clientId || "";
  const clientSecret = cfg.clientSecret || "";
  const tokenUrl = cfg.tokenUrl || "";
  const scopes = cfg.scopes || "";
  const refreshToken = cfg.refreshToken || "";
  const expiryBuffer = cfg.expiryBuffer ?? 60000;
  let accessToken = cfg.accessToken || "";
  let expiresAt = cfg.expiresAt || 0;
  let refreshTok = refreshToken;
  let _refreshing = false;
  return {
    type: "oauth",
    init() {
      if (!clientId || !clientSecret) {
        if (accessToken) {
          log6.info(`${cfg.name || "?"} \u4F7F\u7528\u9810\u5148\u63D0\u4F9B token`);
          return;
        }
        throw new Error(`[auth:oauth] ${cfg.name || "?"} \u7F3A\u5C11 clientId/clientSecret`);
      }
      if (!tokenUrl) {
        throw new Error(`[auth:oauth] ${cfg.name || "?"} \u7F3A\u5C11 tokenUrl`);
      }
    },
    getHeaders() {
      return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
    },
    async refresh() {
      if (_refreshing) {
        while (_refreshing) {
          await new Promise((r) => setTimeout(r, 200));
        }
        return true;
      }
      if (accessToken && Date.now() < expiresAt - expiryBuffer) {
        return true;
      }
      _refreshing = true;
      try {
        const grantType = refreshTok ? "refresh_token" : "client_credentials";
        const params = new URLSearchParams({
          grant_type: grantType,
          client_id: clientId,
          client_secret: clientSecret
        });
        if (grantType === "refresh_token") {
          params.set("refresh_token", refreshTok);
        }
        if (scopes) {
          params.set("scope", scopes);
        }
        log6.info(`${cfg.name || "?"} \u5237\u65B0 token (grant_type=${grantType})`);
        const res = await fetch(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
          signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`OAuth token \u5237\u65B0\u5931\u6557 (HTTP ${res.status}): ${txt.slice(0, 200)}`);
        }
        const data = await res.json();
        accessToken = data.access_token || "";
        const expIn = data.expires_in || 3600;
        expiresAt = Date.now() + expIn * 1000;
        if (data.refresh_token)
          refreshTok = data.refresh_token;
        log6.info(`${cfg.name || "?"} token \u5237\u65B0\u6210\u529F\uFF0C\u5230\u671F ${new Date(expiresAt).toISOString()}`);
        return true;
      } catch (e) {
        log6.error(`${cfg.name || "?"} OAuth token \u5237\u65B0\u5931\u6557: ${e.message}`);
        return false;
      } finally {
        _refreshing = false;
      }
    },
    isHealthy() {
      if (!accessToken)
        return false;
      if (expiresAt > 0 && Date.now() >= expiresAt)
        return false;
      return true;
    },
    toJSON() {
      return {
        type: "oauth",
        ready: !!accessToken,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        hasRefreshToken: !!refreshTok
      };
    }
  };
}

// src/provider/auth/cookie.js
init_color();
var log7 = makeLogger("auth:cookie", "success");
function createCookieAuth(cfg) {
  const mode = cfg.mode || "sessionToken";
  const sessionToken = cfg.sessionToken || "";
  const cookieString = cfg.cookieString || "";
  const loginUrl = cfg.loginUrl || "";
  const username = cfg.username || "";
  const password = cfg.password || "";
  const loginSelector = cfg.loginSelector || 'input[type="email"]';
  const passSelector = cfg.passSelector || 'input[type="password"]';
  const submitSelector = cfg.submitSelector || 'button[type="submit"]';
  const cookieDomains = cfg.cookieDomains || [];
  let currentCookie = "";
  let lastRefresh = 0;
  let _refreshing = false;
  function buildCookieFromToken() {
    const domains = cookieDomains.length > 0 ? cookieDomains : [".chatgpt.com", ".chat.openai.com"];
    if (sessionToken) {
      return domains.map((d) => `session_token=${sessionToken}; Domain=${d}; Path=/`).join("; ");
    }
    return "";
  }
  async function loginWithPuppeteer() {
    if (!loginUrl || !username || !password) {
      throw new Error("[auth:cookie] login \u6A21\u5F0F\u9700\u8981 loginUrl / username / password");
    }
    let puppeteer;
    try {
      puppeteer = await import("puppeteer");
    } catch {
      try {
        puppeteer = await import("puppeteer-core");
      } catch {
        throw new Error("[auth:cookie] \u9700\u8981 puppeteer \u6216 puppeteer-core \u9032\u884C\u81EA\u52D5\u767B\u5165");
      }
    }
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    try {
      const page = await browser.newPage();
      await page.setDefaultTimeout(30000);
      log7.info(`${cfg.name || "?"} \u767B\u5165 ${loginUrl}...`);
      await page.goto(loginUrl, { waitUntil: "networkidle2" });
      await page.waitForSelector(loginSelector);
      await page.type(loginSelector, username);
      if (passSelector) {
        await page.waitForSelector(passSelector);
        await page.type(passSelector, password);
      }
      if (submitSelector) {
        await page.waitForSelector(submitSelector);
        await page.click(submitSelector);
      }
      await page.waitForNavigation({ timeout: 30000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
      const cookies = await page.cookies();
      currentCookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      log7.info(`${cfg.name || "?"} \u767B\u5165\u6210\u529F\uFF0C\u53D6\u5F97 ${cookies.length} \u500B cookie`);
      lastRefresh = Date.now();
      return true;
    } finally {
      await browser.close().catch(() => {});
    }
  }
  return {
    type: "cookie",
    init() {
      if (mode === "sessionToken" && sessionToken) {
        currentCookie = buildCookieFromToken();
        log7.info(`${cfg.name || "?"} sessionToken \u6A21\u5F0F\u5C31\u7DD2`);
        return;
      }
      if (mode === "cookieString" && cookieString) {
        currentCookie = cookieString;
        log7.info(`${cfg.name || "?"} cookieString \u6A21\u5F0F\u5C31\u7DD2`);
        return;
      }
      if (mode === "login") {
        log7.info(`${cfg.name || "?"} login \u6A21\u5F0F\uFF08\u5EF6\u9072\u767B\u5165\uFF09`);
        return;
      }
      throw new Error(`[auth:cookie] ${cfg.name || "?"} \u7121\u6CD5\u521D\u59CB\u5316\uFF08mode=${mode}\uFF0C\u7F3A\u5C11\u5FC5\u8981\u53C3\u6578\uFF09`);
    },
    getHeaders() {
      return currentCookie ? { Cookie: currentCookie } : {};
    },
    async refresh() {
      if (_refreshing) {
        while (_refreshing) {
          await new Promise((r) => setTimeout(r, 200));
        }
        return true;
      }
      _refreshing = true;
      try {
        if (mode === "login") {
          return await loginWithPuppeteer();
        }
        if (mode === "sessionToken" && sessionToken) {
          currentCookie = buildCookieFromToken();
          lastRefresh = Date.now();
          return true;
        }
        if (mode === "cookieString" && cookieString) {
          currentCookie = cookieString;
          lastRefresh = Date.now();
          return true;
        }
        return false;
      } catch (e) {
        log7.error(`${cfg.name || "?"} cookie \u5237\u65B0\u5931\u6557: ${e.message}`);
        return false;
      } finally {
        _refreshing = false;
      }
    },
    isHealthy() {
      return currentCookie.length > 0;
    },
    toJSON() {
      return {
        type: "cookie",
        mode,
        ready: currentCookie.length > 0,
        cookieLen: currentCookie.length,
        lastRefresh: lastRefresh ? new Date(lastRefresh).toISOString() : null
      };
    }
  };
}

// src/provider/auth/index.js
init_color();
var log8 = makeLogger("auth", "success");
var AUTH_TYPES = {
  "api-key": createApiKeyAuth,
  oauth: createOAuthAuth,
  cookie: createCookieAuth
};
function createAuth(authCfg, providerName = "?") {
  if (!authCfg || !authCfg.type)
    return null;
  const type = authCfg.type.toLowerCase();
  const factory = AUTH_TYPES[type];
  if (!factory) {
    log8.warn(`[${providerName}] \u4E0D\u652F\u63F4\u7684 auth type: "${type}"\uFF0C\u53EF\u7528: ${Object.keys(AUTH_TYPES).join(", ")}`);
    return null;
  }
  try {
    const auth = factory({ ...authCfg, name: providerName });
    log8.info(`[${providerName}] auth \u5DF2\u5EFA\u7ACB (type=${type})`);
    try {
      auth.init();
      log8.info(`[${providerName}] auth init \u6210\u529F (type=${type})`);
    } catch (initErr) {
      log8.warn(`[${providerName}] auth init \u5931\u6557: ${initErr.message}\uFF0C\u5617\u8A66 refresh...`);
      auth.refresh().catch((e) => {
        log8.error(`[${providerName}] auth refresh \u4E5F\u5931\u6557: ${e.message}`);
      });
    }
    return auth;
  } catch (e) {
    log8.error(`[${providerName}] \u5EFA\u7ACB auth \u5931\u6557: ${e.message}`);
    return null;
  }
}

// src/provider/index.js
init_color();
var log9 = makeLogger("provider", "tertiary");
function createRouter(cfg) {
  const providers = [];
  const names = cfg.PROVIDER_NAMES || ["qwen2api"];
  for (const name of names) {
    const key = name.toUpperCase();
    const prefix = `PROVIDER_${key}`;
    let baseUrl = cfg[`${prefix}_URL`] || cfg[`${prefix}_BASE_URL`] || process.env[`${prefix}_URL`] || process.env[`${prefix}_BASE_URL`];
    let apiKey = cfg[`${prefix}_KEY`] || cfg[`${prefix}_API_KEY`] || "";
    if (!baseUrl && name === "qwen2api") {
      baseUrl = `http://${cfg.QWEN2API_HOST || "127.0.0.1"}:${cfg.QWEN2API_PORT || 3000}`;
    }
    if (!baseUrl && name === "qwen2api-direct") {
      baseUrl = `http://${cfg.QWEN2API_HOST || "127.0.0.1"}:3001`;
    }
    if (!apiKey && (name === "qwen2api" || name === "qwen2api-direct")) {
      apiKey = cfg.API_KEY || "";
    }
    if (!baseUrl) {
      log9.warn(`Provider "${name}": \u7121 URL\uFF0C\u8DF3\u904E`);
      continue;
    }
    const authType = cfg[`${prefix}_AUTH_TYPE`] || "";
    let authOpts = null;
    if (authType) {
      authOpts = {
        type: authType,
        apiKey: cfg[`${prefix}_AUTH_KEY`] || "",
        key: cfg[`${prefix}_AUTH_KEY`] || "",
        clientId: cfg[`${prefix}_AUTH_CLIENT_ID`] || "",
        clientSecret: cfg[`${prefix}_AUTH_CLIENT_SECRET`] || "",
        tokenUrl: cfg[`${prefix}_AUTH_TOKEN_URL`] || "",
        scopes: cfg[`${prefix}_AUTH_SCOPES`] || "",
        sessionToken: cfg[`${prefix}_AUTH_SESSION_TOKEN`] || "",
        cookieString: cfg[`${prefix}_AUTH_COOKIE_STRING`] || "",
        loginUrl: cfg[`${prefix}_AUTH_LOGIN_URL`] || "",
        username: cfg[`${prefix}_AUTH_USERNAME`] || "",
        password: cfg[`${prefix}_AUTH_PASSWORD`] || "",
        mode: cfg[`${prefix}_AUTH_MODE`] || "sessionToken",
        cookieDomains: cfg[`${prefix}_AUTH_COOKIE_DOMAINS`] ? cfg[`${prefix}_AUTH_COOKIE_DOMAINS`].split(",").map((s) => s.trim()).filter(Boolean) : [],
        accessToken: cfg[`${prefix}_AUTH_ACCESS_TOKEN`] || "",
        expiresAt: parseInt(cfg[`${prefix}_AUTH_EXPIRES_AT`] || "0", 10),
        refreshToken: cfg[`${prefix}_AUTH_REFRESH_TOKEN`] || ""
      };
    }
    const provider = new Provider(name, {
      baseUrl,
      apiKey,
      auth: authOpts ? createAuth(authOpts, name) : null,
      timeout: parseInt(cfg[`${prefix}_TIMEOUT`] || cfg.CHAT_TIMEOUT || "120000", 10),
      retries: parseInt(cfg[`${prefix}_RETRIES`] ?? cfg.RETRIES ?? "1", 10),
      priority: parseInt(cfg[`${prefix}_PRIORITY`] || process.env[`${prefix}_PRIORITY`] || "1", 10),
      weight: parseInt(cfg[`${prefix}_WEIGHT`] || "1", 10),
      cbThreshold: parseInt(cfg[`${prefix}_CB_THRESHOLD`] || cfg.CB_THRESHOLD || "3", 10),
      cbRecovery: parseInt(cfg[`${prefix}_CB_RECOVERY`] || cfg.CB_RECOVERY || "30000", 10)
    });
    providers.push(provider);
  }
  const router = new Router(providers, cfg.ROUTER_STRATEGY || "adaptive");
  if (cfg.ROUTER_HEALTH_ENABLED !== false) {
    const interval = parseInt(cfg.ROUTER_HEALTH_INTERVAL || "30000", 10);
    router.startHealthChecks(interval);
  }
  log9.info(`Router init: ${providers.length} providers, strategy=${router.strategy}`);
  for (const p of providers) {
    log9.info(`  ${p.name}: ${p.baseUrl} (pri=${p.priority}, timeout=${p.timeout}ms)`);
  }
  return router;
}

// src/intelligent-tuning.js
import fs2 from "fs";
init_color();
var log10 = makeLogger("tuning", "secondary");
var _homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
var _tuningDir = `${_homeDir}/.opencode/tuning`;
var _persistPath = `${_tuningDir}/tuning-data.json`;
var _load = () => {
  try {
    if (!fs2.existsSync(_persistPath)) {
      log10.debug("\u7121\u6301\u4E45\u5316 tuning \u6578\u64DA\uFF0C\u5F9E\u982D\u958B\u59CB");
      return null;
    }
    const raw = fs2.readFileSync(_persistPath, "utf-8");
    const data = JSON.parse(raw);
    if (!data || !data.patterns || typeof data.patterns !== "object") {
      log10.warn("\u26A0\uFE0F tuning \u6578\u64DA\u683C\u5F0F\u7570\u5E38\uFF0C\u8DF3\u904E\u8F09\u5165");
      return null;
    }
    log10.info(`\uD83D\uDCC2 \u5DF2\u8F09\u5165 tuning \u6578\u64DA: ${Object.keys(data.patterns).length} \u6A21\u578B, ${data.globalResponseCount || 0} \u6B21\u56DE\u61C9`);
    return data;
  } catch (e) {
    log10.warn(`\u26A0\uFE0F \u8F09\u5165 tuning \u6578\u64DA\u5931\u6557: ${e.message}`);
    return null;
  }
};
var _save = () => {
  try {
    const patterns = {};
    for (const [model, p] of _patterns) {
      patterns[model] = { ...p };
    }
    const data = {
      version: 2,
      savedAt: Date.now(),
      patterns,
      globalStallRate: _globalStallRate,
      globalResponseCount: _globalResponseCount,
      globalStallCount: _globalStallCount
    };
    fs2.mkdirSync(_tuningDir, { recursive: true });
    fs2.writeFileSync(_persistPath, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    log10.warn(`\u26A0\uFE0F \u4FDD\u5B58 tuning \u6578\u64DA\u5931\u6557: ${e.message}`);
  }
};
var _saveTimer = null;
var _debouncedSave = () => {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _save();
    _saveTimer = null;
  }, 5000);
};
var _patterns = new Map;
var _globalStallRate = 0;
var _globalResponseCount = 0;
var _globalStallCount = 0;
var _currentPromptStyle = "normal";
var _stallSensitivity = 1;
(() => {
  const data = _load();
  if (data) {
    _globalStallRate = data.globalStallRate || 0;
    _globalResponseCount = data.globalResponseCount || 0;
    _globalStallCount = data.globalStallCount || 0;
    if (data.patterns) {
      for (const [model, p] of Object.entries(data.patterns)) {
        _patterns.set(model, p);
      }
    }
  }
})();
var recordResponse = (model, action, latencyMs = 0) => {
  const key = (model || "unknown").toLowerCase();
  let p = _patterns.get(key);
  if (!p) {
    p = {
      responses: 0,
      stalls: 0,
      completes: 0,
      empties: 0,
      rejects: 0,
      avgLatency: 0,
      lastAction: action,
      consecutiveStalls: 0,
      promptStyle: "normal"
    };
    _patterns.set(key, p);
  }
  p.responses++;
  p.lastAction = action;
  if (latencyMs > 0) {
    p.avgLatency = p.avgLatency > 0 ? Math.round((p.avgLatency * (p.responses - 1) + latencyMs) / p.responses) : latencyMs;
  }
  switch (action) {
    case "stall":
      p.stalls++;
      p.consecutiveStalls++;
      _globalStallCount++;
      break;
    case "complete":
    case "tool_call":
      p.completes++;
      p.consecutiveStalls = 0;
      break;
    case "empty":
      p.empties++;
      p.consecutiveStalls++;
      break;
    case "reject":
      p.rejects++;
      p.consecutiveStalls++;
      break;
  }
  _globalResponseCount++;
  _adjustPromptStyle(key);
  _debouncedSave();
};
var buildAdaptivePrompt = (tools, model) => {
  if (!tools?.length)
    return null;
  const names = tools.map((t) => t.function?.name || t.name).join(", ");
  const m = model ? model.toLowerCase() : "";
  const style = m ? _patterns.get(m)?.promptStyle || _currentPromptStyle : _currentPromptStyle;
  const fmtGuide = [
    "",
    "\u3010\u8F38\u51FA\u683C\u5F0F\u3011\u4F7F\u7528\u5DE5\u5177\u6642\u8ACB\u9075\u5FAA\u4EE5\u4E0B\u683C\u5F0F\uFF1A",
    "",
    "  bash \u2192 ```bash \u4F60\u7684\u547D\u4EE4 ```",
    "  read \u2192 ```bash cat /path/to/file ```",
    "  write \u2192 ``` \u6A94\u6848\u5167\u5BB9 ``` (code block)",
    "  grep \u2192 ```bash grep pattern file ```",
    "  glob \u2192 ```bash find /path -name '*.ts' ```",
    "  edit \u2192 ```bash sed -i 's/old/new/g' file ```",
    "",
    "\u4E0D\u8981\u4F7F\u7528 <tool_call> XML \u683C\u5F0F\u3002",
    "\u76F4\u63A5\u8F38\u51FA\u5DE5\u5177\u5340\u584A\uFF0C\u4E0D\u8981\u53EA\u63CF\u8FF0\u8981\u505A\u4EC0\u9EBC\u3002"
  ].join(`
`);
  const base = `\u53EF\u7528\u5DE5\u5177: ${names}\u3002`;
  switch (style) {
    case "urgent":
      return [
        "===== \u8ACB\u76F4\u63A5\u884C\u52D5 =====",
        base,
        "\u8ACB\u4F7F\u7528 bash \u5DE5\u5177\u57F7\u884C\u9700\u8981\u7684\u64CD\u4F5C\u3002",
        fmtGuide,
        "====="
      ].join(`
`);
    case "strict":
      return [
        "===== \u57F7\u884C\u8981\u6C42 =====",
        base,
        "\u8ACB\u4F7F\u7528\u53EF\u7528\u7684\u5DE5\u5177\u4F86\u5B8C\u6210\u4EFB\u52D9\u3002",
        fmtGuide,
        "===== \u7BC4\u4F8B =====",
        "  ```bash",
        "  cat > script.ts << 'EOF'",
        "  console.log('hello')",
        "  EOF",
        "  ```",
        "  ```bash",
        "  bun run script.ts",
        "  ```",
        "===== \u8ACB\u76F4\u63A5\u57F7\u884C ====="
      ].join(`
`);
    case "normal":
      return [
        "===== \u4EFB\u52D9\u6307\u5F15 =====",
        base,
        "\u8ACB\u6839\u64DA\u4EFB\u52D9\u9700\u6C42\u4F7F\u7528\u5DE5\u5177\u3002\u9700\u8981\u5148\u5206\u6790\u5C31\u5206\u6790\uFF0C\u6E96\u5099\u597D\u5C31\u76F4\u63A5\u57F7\u884C\u3002",
        fmtGuide,
        "====="
      ].join(`
`);
    case "gentle":
      return [
        base,
        "\u8ACB\u4F7F\u7528\u5DE5\u5177\u4F86\u5B8C\u6210\u4EFB\u52D9\u3002\u4F60\u53EF\u4EE5\u5148\u601D\u8003\u518D\u57F7\u884C\uFF0C\u4E5F\u53EF\u4EE5\u76F4\u63A5\u57F7\u884C\u3002",
        fmtGuide
      ].join(`
`);
    default:
      return null;
  }
};
var getRoutingHint = (model) => {
  const p = _patterns.get((model || "").toLowerCase());
  if (!p || p.responses < 3)
    return null;
  const stallRate = p.stalls / p.responses;
  const emptyRate = p.empties / p.responses;
  if (stallRate > 0.5 || emptyRate > 0.3) {
    return {
      level: "downgrade",
      reason: `\u884C\u7232\u7570\u5E38: \u505C\u6EEF\u7387 ${(stallRate * 100).toFixed(0)}%${emptyRate > 0.3 ? `, \u7A7A\u5167\u5BB9\u7387 ${(emptyRate * 100).toFixed(0)}%` : ""}`
    };
  }
  if (stallRate > 0.3 || emptyRate > 0.15) {
    return {
      level: "caution",
      reason: `\u884C\u7232\u4E0D\u7A69\u5B9A: \u505C\u6EEF\u7387 ${(stallRate * 100).toFixed(0)}%`
    };
  }
  return null;
};
var getStallParams = (model) => {
  const p = _patterns.get((model || "").toLowerCase());
  const base = {
    threshold: parseInt(process.env.STALL_THRESHOLD_MS || "30000"),
    sensitivity: _stallSensitivity,
    maxRetries: parseInt(process.env.MAX_STALL_RETRIES || "2")
  };
  if (!p || p.responses < 3)
    return base;
  if (p.consecutiveStalls >= 2) {
    return {
      ...base,
      sensitivity: 1.5,
      maxRetries: Math.min(base.maxRetries + 1, 4)
    };
  }
  if (p.completes > p.stalls * 3 && p.responses >= 5) {
    return {
      ...base,
      sensitivity: 0.7,
      maxRetries: Math.max(base.maxRetries - 1, 1)
    };
  }
  return base;
};
var getCorrectionMessage = (model, retryCount) => {
  const p = _patterns.get((model || "").toLowerCase());
  const consecutive = p?.consecutiveStalls || 0;
  if (retryCount >= 2 || consecutive >= 3) {
    return [
      "===== \u8ACB\u57F7\u884C =====",
      "\u8ACB\u4F7F\u7528 bash \u5DE5\u5177\u57F7\u884C\u4F60\u525B\u624D\u5206\u6790\u7684\u6B65\u9A5F\u3002",
      "\u7BC4\u4F8B:",
      "  mkdir -p src/components",
      "  cat > 'src/index.ts' << 'EOF'",
      "  console.log('hello')",
      "  EOF",
      "  bun run src/index.ts",
      "===== \u8ACB\u57F7\u884C ====="
    ].join(`
`);
  }
  if (retryCount >= 1 || consecutive >= 2) {
    return [
      "===== \u8ACB\u57F7\u884C =====",
      "\u8ACB\u4F7F\u7528 bash \u5DE5\u5177\u57F7\u884C\u4EFB\u52D9\u3002",
      "\u7BC4\u4F8B:",
      "  mkdir -p src/components",
      "  cat > 'src/index.ts' << 'EOF'",
      "  console.log('hello')",
      "  EOF",
      "  bun run src/index.ts",
      "===== \u8ACB\u57F7\u884C ====="
    ].join(`
`);
  }
  return [
    "===== \u8ACB\u884C\u52D5 =====",
    "\u8ACB\u4F7F\u7528 bash \u547D\u4EE4\u4F86\u5B8C\u6210\u4EFB\u52D9\u3002",
    "\u7BC4\u4F8B: cat > 'file.ts' << 'EOF' ... EOF"
  ].join(`
`);
};
var getTimeoutMs = (model, defaultTimeout = 120000) => {
  const p = _patterns.get((model || "").toLowerCase());
  if (!p || p.responses < 3)
    return defaultTimeout;
  const hasStallHistory = p.stalls > 0 || p.empties > 0;
  const recentAvg = p.avgLatency;
  if (recentAvg < 1e4 && !hasStallHistory && p.completes > p.responses * 0.8) {
    return Math.round(defaultTimeout * 0.7);
  }
  if (recentAvg > 45000 || p.stalls > p.responses * 0.3) {
    return Math.round(defaultTimeout * 1.4);
  }
  if (recentAvg > 25000) {
    return Math.round(defaultTimeout * 1.2);
  }
  return defaultTimeout;
};
var _STALL_RECOVERY_AFTER = 6;
var _adjustPromptStyle = (key) => {
  const p = _patterns.get(key);
  if (!p || p.responses < 2)
    return;
  const stallRate = p.stalls / p.responses;
  const emptyRate = p.empties / p.responses;
  const abnormalRate = (p.stalls + p.empties) / p.responses;
  if ((p.promptStyle === "urgent" || p.promptStyle === "strict") && p.responses >= _STALL_RECOVERY_AFTER) {
    if (p.consecutiveStalls >= _STALL_RECOVERY_AFTER) {
      log10.warn(`\uD83D\uDD04 [${key}] prompt \u98A8\u683C\u6062\u5FA9: ${p.promptStyle} \u2192 normal` + ` (\u9023\u7E8C ${p.consecutiveStalls} \u6B21\u7570\u5E38\uFF0C\u6253\u7834\u8CA0\u5411\u8FF4\u5708)`);
      p.promptStyle = "normal";
      p.consecutiveStalls = 0;
      _stallSensitivity = Math.max(_stallSensitivity - 0.2, 0.7);
      return;
    }
  }
  let newStyle;
  if (p.consecutiveStalls >= 3) {
    newStyle = "urgent";
  } else if (abnormalRate > 0.6 || stallRate > 0.4) {
    newStyle = "urgent";
  } else if (abnormalRate > 0.4 || stallRate > 0.25) {
    newStyle = "strict";
  } else if (abnormalRate > 0.15) {
    newStyle = "normal";
  } else {
    newStyle = "normal";
  }
  if (newStyle !== p.promptStyle) {
    log10.info(`\uD83C\uDF9B\uFE0F  [${key}] prompt \u98A8\u683C: ${p.promptStyle} \u2192 ${newStyle}` + ` (\u505C\u6EEF\u7387 ${(stallRate * 100).toFixed(0)}%/\u7A7A\u5167\u5BB9 ${(emptyRate * 100).toFixed(0)}%)`);
    p.promptStyle = newStyle;
  }
  if (abnormalRate > 0.4) {
    _stallSensitivity = Math.min(_stallSensitivity + 0.1, 1.5);
  } else if (abnormalRate < 0.1 && _stallSensitivity > 1) {
    _stallSensitivity = Math.max(_stallSensitivity - 0.1, 0.7);
  }
  if (_globalResponseCount > 0) {
    _globalStallRate = _globalStallCount / _globalResponseCount;
  }
};
process.on("exit", () => {
  clearTimeout(_saveTimer);
  _saveTimer = null;
  try {
    _save();
  } catch (_) {}
});
process.on("SIGINT", () => {
  clearTimeout(_saveTimer);
  _saveTimer = null;
  try {
    _save();
    process.exit(0);
  } catch (_) {
    process.exit(0);
  }
});
process.on("SIGTERM", () => {
  clearTimeout(_saveTimer);
  _saveTimer = null;
  try {
    _save();
    process.exit(0);
  } catch (_) {
    process.exit(0);
  }
});

// ../config/models.js
import { platform as platform2 } from "os";
import * as os2 from "os";
import { execSync as execSync3 } from "child_process";
var _IS_WIN2 = platform2() === "win32";
var _deviceCache = null;
var _cacheTime = 0;
var _TTL = 60000;
function getDeviceInfo() {
  const now = Date.now();
  if (_deviceCache && now - _cacheTime < _TTL)
    return _deviceCache;
  const envRole = process.env.DEVICE_ROLE?.toLowerCase();
  if (envRole && ["laptop", "desktop"].includes(envRole)) {
    _deviceCache = {
      role: envRole,
      level: "medium",
      reason: "\u74B0\u5883\u8B8A\u6578 DEVICE_ROLE"
    };
    _cacheTime = now;
    return _deviceCache;
  }
  const isLaptop = _detectLaptop();
  const cpuCores = os2.cpus().length;
  const totalGB = os2.totalmem() / 1024 / 1024 / 1024;
  const level = _detectLevel(cpuCores, totalGB);
  _deviceCache = {
    role: isLaptop ? "laptop" : "desktop",
    level,
    reason: `\u555F\u767C\u5F0F (${isLaptop ? "\u7B46\u96FB" : "\u684C\u6A5F"}, ${cpuCores}\u6838, ${totalGB.toFixed(1)}GB)`
  };
  _cacheTime = now;
  return _deviceCache;
}
function getModelDefaults(level) {
  const info = level ? { role: getDeviceInfo().role, level } : getDeviceInfo();
  const fromEnv = {};
  for (const lvl of ["small", "medium", "large"]) {
    const envKey = `PROXY_${lvl.toUpperCase()}_MODEL`;
    if (process.env[envKey])
      fromEnv[lvl] = process.env[envKey];
  }
  const desktopDefaults = {
    small: fromEnv.small || "qwen3.6-27b",
    medium: fromEnv.medium || "qwen3.6-plus-thinking",
    large: fromEnv.large || "qwen3.6-max-preview"
  };
  const laptopDefaults = {
    small: fromEnv.small || "qwen3.6-27b",
    medium: fromEnv.medium || "qwen3.6-27b",
    large: fromEnv.large || "qwen3.6-plus-thinking"
  };
  return info.role === "desktop" ? desktopDefaults : laptopDefaults;
}
function getBadModels() {
  const info = getDeviceInfo();
  if (info.role === "desktop")
    return [];
  return ["qwen3.7"];
}
function isBlockedOnDevice(model) {
  const n = (model || "").toLowerCase();
  const bad = getBadModels();
  return bad.some((b) => n === b.toLowerCase() || n.startsWith(b.toLowerCase()));
}
function _detectLaptop() {
  try {
    if (_IS_WIN2) {
      const out = execSync3("wmic path Win32_Battery get BatteryStatus /format:csv 2>nul", { timeout: 2000, encoding: "utf8" });
      return out.trim().split(`
`).filter(Boolean).length > 1;
    }
    const bats = execSync3("ls /sys/class/power_supply/BAT* 2>/dev/null | head -1", { timeout: 2000, encoding: "utf8" }).trim();
    return bats.length > 0;
  } catch {
    return false;
  }
}
function _detectLevel(cores, totalGB) {
  if (totalGB >= 12 && cores >= 6)
    return "large";
  if (totalGB >= 6 && cores >= 4)
    return "medium";
  return "small";
}

// src/chat-proxy.js
var log11 = makeLogger("proxy", "primary");
var isPipeBreak = (e) => e?.code === "EPIPE" || e?.code === "ECONNRESET" || (e?.message || "").includes("write after end");
process.on("unhandledRejection", (e) => {
  if (isPipeBreak(e))
    return;
  log11.error("\uD83D\uDCA5 \u672A\u6355\u6349 rejection:", e?.message || e);
});
process.on("uncaughtException", (e) => {
  if (isPipeBreak(e)) {
    return;
  }
  try {
    log11.error("\uD83D\uDCA5 \u672A\u6355\u6349 exception:", e?.message || e);
  } catch {
    try {
      process.stderr.write(`[proxy] FATAL: ${e?.message || e}
`);
    } catch {}
  }
});
var QWEN2API_PORT = parseInt(process.env.QWEN2API_PORT || "3000", 10);
var QWEN2API_HOST = process.env.QWEN2API_HOST || "127.0.0.1";
var _QWEN2API_HOST = QWEN2API_HOST.includes(":") ? `[${QWEN2API_HOST}]` : QWEN2API_HOST;
var QWEN2API_URL = `http://${_QWEN2API_HOST}:${QWEN2API_PORT}`;
var PROXY_PORT = parseInt(process.env.PROXY_PORT || "3456");
var API_KEY = process.env.API_KEY || process.env.QWEN2API_KEY || "sk-qwen2api-test-2026";
var MAX_BODY = parseInt(process.env.PROXY_MAX_BODY || 10 * 1024 * 1024);
var PROJ_DIR = getPath("projectDir");
var AUTH_DISABLED = process.env.AUTH_DISABLED === "true";
var _upstreamHealthy = false;
var _router = null;
var _activeSSE = new Set;
var _alive = { lastActivity: Date.now(), lastBeat: Date.now() };
var markActivity = () => {
  _alive.lastActivity = Date.now();
};
var GRACE_MS = parseInt(process.env.PROXY_GRACE_MS || "8000");
var _startTs = Date.now();
var _inGrace = () => Date.now() - _startTs < GRACE_MS;
var RL_MAX = parseInt(process.env.PROXY_RATE_LIMIT || "600");
var RL_WIN = parseInt(process.env.PROXY_RATE_WINDOW || "60000");
var rlBuckets = new Map;
function checkRL(ip) {
  const now = Date.now();
  let b = rlBuckets.get(ip);
  if (!b || now > b.reset) {
    b = { count: 0, reset: now + RL_WIN };
    rlBuckets.set(ip, b);
  }
  b.count++;
  if (rlBuckets.size > 1e4) {
    const cutoff = Date.now();
    for (const [k, v] of rlBuckets) {
      if (cutoff > v.reset)
        rlBuckets.delete(k);
    }
  }
  return b.count <= RL_MAX;
}
var COMPLEX_KEYWORDS = [
  "fix",
  "repair",
  "debug",
  "implement",
  "create",
  "build",
  "deploy",
  "refactor",
  "optimize",
  "analyze",
  "investigate",
  "troubleshoot",
  "\u4FEE\u5FA9",
  "\u9664\u932F",
  "\u5BE6\u4F5C",
  "\u5EFA\u7ACB",
  "\u90E8\u7F72",
  "\u91CD\u69CB",
  "\u512A\u5316",
  "\u5206\u6790"
];
var COGNITIVE_KEYWORDS = [
  "explain",
  "why",
  "how",
  "concept",
  "theory",
  "principle",
  "compare",
  "evaluate",
  "assess",
  "reasoning",
  "deduce",
  "interpret",
  "clarify",
  "\u89E3\u91CB",
  "\u70BA\u4EC0\u9EBC",
  "\u5982\u4F55",
  "\u6982\u5FF5",
  "\u7406\u8AD6",
  "\u539F\u7406",
  "\u6BD4\u8F03",
  "\u8A55\u4F30",
  "\u5206\u6790",
  "\u63A8\u8AD6",
  "\u6F14\u7E79",
  "\u8A6E\u91CB",
  "\u91D0\u6E05"
];
var classifyModel = (name) => {
  const n = (name || "").toLowerCase();
  const base = n.replace(/-(thinking|search|image|video|image-edit|deep-research)$/, "");
  if (/2\d{2}b/i.test(base) || /max|preview|turbo|ultra/i.test(base) || /qwen[23]\.?\d*-?2\d{2}/i.test(base))
    return "large";
  if (/plus|coder|math/i.test(base) || /7[2-9]b|8\d{1}b|9\d{1}b|100b/i.test(base) || /qwq/i.test(base) || /32b/i.test(base))
    return "medium";
  if (/flash|lite|tiny|mini|nano/i.test(base) || /\d{1,2}b/i.test(base))
    return "small";
  return "medium";
};
var envModels = null;
var envDetected = false;
var detectEnv = async () => {
  if (envDetected)
    return;
  envDetected = true;
  try {
    const models = await getJSON(`${QWEN2API_URL}/v1/models`);
    const list = models?.data || models || [];
    const byLevel = { small: [], medium: [], large: [] };
    for (const m of list) {
      const id = m.id || m.name || "";
      if (isBlockedOnDevice(id))
        continue;
      const level = classifyModel(id);
      if (!byLevel[level].includes(id))
        byLevel[level].push(id);
    }
    envModels = byLevel;
    log11.info(`\uD83C\uDF0D \u74B0\u5883\u5075\u6E2C: ${list.length} \u500B\u6A21\u578B`);
  } catch (e) {
    log11.warn(`\u26A0\uFE0F \u6A21\u578B\u5075\u6E2C\u5931\u6557: ${e.message}\uFF0C\u4F7F\u7528\u9810\u8A2D\u8DEF\u7531`);
    envModels = null;
  }
};
var getModelForLevel = (level) => {
  const envKey = `PROXY_${level.toUpperCase()}_MODEL`;
  if (process.env[envKey])
    return process.env[envKey];
  if (envModels?.[level]?.length > 0) {
    const healthy = envModels[level].filter((m) => isTextModel(m) && !isModelUnhealthy(m) && !isBlockedOnDevice(m));
    if (healthy.length > 0)
      return healthy[0];
  }
  const cfgDefaults = getModelDefaults(level);
  const fallback = {
    small: "qwen3.6-27b",
    medium: "qwen3.6-plus-thinking",
    large: "Qwen3.6-Max-Preview"
  };
  if (!envModels) {
    return cfgDefaults[level] || fallback[level] || fallback.medium;
  }
  const downLevels = { large: "medium", medium: "small", small: null };
  let fallbackLevel = downLevels[level];
  while (fallbackLevel) {
    const fallbackHealthy = (envModels[fallbackLevel] || []).filter((m) => isTextModel(m) && !isModelUnhealthy(m) && !isBlockedOnDevice(m));
    if (fallbackHealthy.length > 0)
      return fallbackHealthy[0];
    fallbackLevel = downLevels[fallbackLevel];
  }
  return cfgDefaults[level] || fallback[level] || fallback.medium;
};
var MODEL_FAIL_THRESHOLD = 5;
var MODEL_HEALTH_TTL = 60 * 60 * 1000;
var MAX_RETRY_CANDIDATES = 5;
var MODEL_HEALTH_FILE = path2.join(os3.homedir(), ".opencode", "model-health.json");
var modelHealth = new Map;
var CONSECUTIVE_EMPTY_THRESHOLD = 4;
var _consecutiveEmpty = new Map;
var _isTopTier = (model) => {
  const n = (model || "").toLowerCase();
  return /max|preview|turbo|ultra/i.test(n);
};
var _globalEmptyCooldown = { count: 0, resetAt: 0, lastContextHash: "" };
var GLOBAL_EMPTY_THRESHOLD = 2;
var _contextHash = (msgs) => {
  const tail = (msgs || []).slice(-3).map((m) => typeof m.content === "string" ? m.content : "").join("").slice(-200);
  let hash = 0;
  for (let i = 0;i < tail.length; i++) {
    hash = (hash << 5) - hash + tail.charCodeAt(i) | 0;
  }
  return hash.toString(36);
};
var CONTEXT_COMPRESS_THRESHOLD = 80000;
var CONTEXT_KEEP_RECENT = 4;
var SUMMARY_MODEL = process.env.PROXY_SUMMARY_MODEL || "qwen3.6-27b";
var SUMMARY_CACHE_TTL = 900000;
var _convSummaryCache = new Map;
function loadModelHealth() {
  try {
    if (fs3.existsSync(MODEL_HEALTH_FILE)) {
      const raw = fs3.readFileSync(MODEL_HEALTH_FILE, "utf-8");
      const data = JSON.parse(raw);
      if (data && typeof data === "object") {
        const now = Date.now();
        let loaded = 0;
        let expired = 0;
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && v.updatedAt && now - v.updatedAt > MODEL_HEALTH_TTL) {
            expired++;
            continue;
          }
          const val = v && typeof v === "object" ? v.count : v;
          modelHealth.set(k, val);
          loaded++;
        }
        log11.info(`\uD83D\uDCCA \u5DF2\u8F09\u5165 ${loaded} \u7B46\u6A21\u578B\u5065\u5EB7\u8A18\u9304${expired ? ` (${expired} \u7B46\u5DF2\u904E\u671F\u5FFD\u7565)` : ""} (${MODEL_HEALTH_FILE})`);
      }
    }
  } catch (e) {
    log11.debug(`\u6A21\u578B\u5065\u5EB7\u8F09\u5165\u7565\u904E: ${e.message}`);
  }
}
function saveModelHealth() {
  try {
    const dir = path2.dirname(MODEL_HEALTH_FILE);
    fs3.mkdirSync(dir, { recursive: true });
    const obj = {};
    for (const [k, v] of modelHealth) {
      if (v && typeof v === "object") {
        obj[k] = v;
      } else if (typeof v === "number") {
        obj[k] = { count: v, updatedAt: Date.now() };
      }
    }
    fs3.writeFileSync(MODEL_HEALTH_FILE, JSON.stringify(obj, null, 2), "utf-8");
  } catch (e) {
    log11.debug(`\u6A21\u578B\u5065\u5EB7\u5132\u5B58\u7565\u904E: ${e.message}`);
  }
}
loadModelHealth();
setInterval(saveModelHealth, 300000);
process.on("exit", saveModelHealth);
function _hasAdequateMem() {
  try {
    const mem = os3.freemem ? os3.freemem() : 0;
    return mem > 2 * 1024 * 1024 * 1024;
  } catch {
    return true;
  }
}
var recordModelFailure = (model, cause = "model") => {
  if (!model)
    return 0;
  if (!_hasAdequateMem()) {
    log11.warn(`\uD83E\uDDE0 \u4F4E\u8A18\u61B6\u9AD4\u8DF3\u904E\u6A21\u578B\u5931\u6557\u8A18\u9304 (${model}) \u2014 \u7CFB\u7D71\u8CC7\u6E90\u4E0D\u8DB3`);
    return 0;
  }
  if (cause === "empty_content") {
    log11.warn(`\u26A0\uFE0F \u7A7A\u5167\u5BB9\u8DF3\u904E\u6A21\u578B\u5931\u6557\u8A18\u9304 (${model}) \u2014 \u53EF\u80FD\u70BA WAF \u963B\u64CB\uFF0C\u975E\u6A21\u578B\u554F\u984C`);
    return 0;
  }
  if (cause === "empty_consecutive") {
    log11.warn(`\u26A0\uFE0F \u9023\u7E8C\u7A7A\u5167\u5BB9\u9054\u5230\u95BE\u503C\uFF0C\u8A08\u5165\u6A21\u578B\u5931\u6557: ${model}`);
  }
  const now = Date.now();
  const existing = modelHealth.get(model);
  let count = 1;
  if (existing && typeof existing === "object") {
    count = (existing.count || 0) + 1;
  } else if (typeof existing === "number") {
    count = existing + 1;
  }
  modelHealth.set(model, { count, updatedAt: now });
  if (count >= MODEL_FAIL_THRESHOLD && envModels) {
    for (const level of ["small", "medium", "large"]) {
      const idx = envModels[level]?.indexOf(model);
      if (idx !== -1 && idx !== undefined) {
        envModels[level].splice(idx, 1);
        log11.warn(`\u26A0\uFE0F \u6A21\u578B ${model} \u5DF2\u5931\u6557 ${count} \u6B21\uFF0C\u5F9E ${level} \u8DEF\u7531\u6E05\u55AE\u79FB\u9664 (\u539F\u56E0: ${cause})`);
        break;
      }
    }
  }
  return count;
};
var isModelUnhealthy = (model) => {
  const v = modelHealth.get(model);
  const count = v && typeof v === "object" ? v.count || 0 : v || 0;
  return count >= MODEL_FAIL_THRESHOLD;
};
var isTextModel = (model) => {
  const n = (model || "").toLowerCase();
  return !n.includes("-image") && !n.includes("-video") && !n.includes("-image-edit");
};
var analyzeComplexity = (body) => {
  const { messages, tools, tool_choice } = body;
  let score = 0;
  let isCognitive = false;
  const text = (messages || []).map((m) => typeof m.content === "string" ? m.content : "").join(" ");
  const len = text.length;
  if (len > 2000)
    score += 3;
  else if (len > 800)
    score += 2;
  else if (len > 200)
    score += 1;
  const nTools = tools?.length || 0;
  if (nTools > 0)
    score += 2;
  if (nTools > 5)
    score += 1;
  if (nTools > 10)
    score += 1;
  if (tool_choice === "required")
    score += 2;
  const lower = text.toLowerCase();
  for (const kw of COMPLEX_KEYWORDS) {
    if (lower.includes(kw)) {
      score += getWeight(kw);
      break;
    }
  }
  for (const kw of COGNITIVE_KEYWORDS) {
    if (lower.includes(kw)) {
      isCognitive = true;
      score += getWeight(kw) * 2;
      break;
    }
  }
  if (lower.includes("step-by-step") || lower.includes("reasoning") || lower.includes("think carefully")) {
    isCognitive = true;
    score += 2;
  }
  const taskType = nTools > 0 ? "coding" : "chat";
  score += getPenalty(taskType);
  let level = "small";
  if (score >= 5)
    level = "large";
  else if (score >= 2)
    level = "medium";
  if (isCognitive && level !== "large") {
    log11.info(`\uD83E\uDDE0 \u8A8D\u77E5\u9700\u6C42\u5075\u6E2C (${score}\u5206)\uFF0C\u5F37\u5236\u5347\u7D1A\u81F3 large \u6A21\u578B`);
    level = "large";
  }
  return { level, isCognitive };
};
var routeModel = (body) => {
  if (process.env.PROXY_ROUTE === "off")
    return body.model || getModelForLevel("medium");
  const isGenericAlias = /^qwen[-/]?(?:plus|max|turbo)$/i.test(body.model || "");
  if (body.model && body.model !== "qwen" && body.model !== "default" && !isGenericAlias) {
    return body.model;
  }
  const { level: rawLevel } = analyzeComplexity(body);
  let level = rawLevel;
  const hw = detectHardware();
  const hwOrder = { small: 0, medium: 1, large: 2 };
  const taskOrder = hwOrder[level] ?? 1;
  const hwLimit = hwOrder[hw.level] ?? 1;
  if (hw.level === "small" && taskOrder > 1) {
    log11.info(`\uD83D\uDCE1 ${level}\u2192medium (\u786C\u9AD4\u9650\u5236: ${hw.reason})`);
    level = "medium";
  } else if (hw.level === "medium" && taskOrder > 1 && hw.ram?.freeGB < 2) {
    log11.info(`\uD83D\uDCE1 ${level}\u2192medium (\u53EF\u7528\u8A18\u61B6\u9AD4\u4E0D\u8DB3: ${hw.reason})`);
    level = "medium";
  } else if (hw.level !== taskOrder && taskOrder > hwLimit) {
    log11.debug(`\uD83D\uDCE1 ${level} (\u786C\u9AD4=${hw.level}, \u4E0D\u964D\u7D1A-\u96F2\u7AEF\u63A8\u7406)`);
  }
  let model = getModelForLevel(level);
  try {
    if (isModelTimingOut(model) || isModelStalling(model)) {
      const downMap = { large: "medium", medium: "small", small: null };
      const next = downMap[level];
      if (next) {
        log11.warn(`\uD83D\uDCE1 ${level}\u2192${next} (${model} ${isModelTimingOut(model) ? "\u9AD8\u8D85\u6642\u7387" : "\u9AD8\u505C\u6EEF\u7387"}, \u81EA\u52D5\u964D\u7D1A)`);
        level = next;
        model = getModelForLevel(level);
      }
    }
  } catch (_) {}
  try {
    const hint = getRoutingHint(model);
    if (hint && hint.level === "downgrade") {
      const downMap = { large: "medium", medium: "small", small: null };
      const next = downMap[level];
      if (next) {
        log11.warn(`\uD83D\uDCE1 ${level}\u2192${next} (${model} ${hint.reason}, tuning \u9ED1\u540D\u55AE)`);
        level = next;
        model = getModelForLevel(level);
      }
    }
  } catch (_) {}
  const orig = body.model || "";
  if (model !== orig && orig.toLowerCase().includes("thinking")) {
    const base = model.replace(/-thinking$/i, "");
    model = `${base}-thinking`;
  }
  if (model !== orig && orig) {
    log11.debug(`\uD83D\uDCE1 ${level} (${orig} \u2192 ${model})`);
  }
  return model;
};
var authHeaders = {
  Authorization: `Bearer ${API_KEY}`
};
var delay = (ms) => new Promise((r) => setTimeout(r, ms));
var postStream = async (url, body, timeout = 120000, externalSignal = null) => {
  const controller = new AbortController;
  const timer2 = setTimeout(() => controller.abort(), timeout);
  const onExternalAbort = () => {
    clearTimeout(timer2);
    controller.abort(externalSignal?.reason || new Error("external abort"));
  };
  if (externalSignal)
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer2);
    if (externalSignal)
      externalSignal.removeEventListener("abort", onExternalAbort);
    return res;
  } catch (e) {
    clearTimeout(timer2);
    if (externalSignal)
      externalSignal.removeEventListener("abort", onExternalAbort);
    throw e;
  }
};
var postJSON = async (url, body, timeout = 60000, retries = 2, externalSignal = null) => {
  let lastErr;
  for (let attempt = 0;attempt <= retries; attempt++) {
    if (externalSignal?.aborted) {
      throw externalSignal.reason || new Error("external abort");
    }
    const controller = new AbortController;
    const timer2 = setTimeout(() => controller.abort(), timeout);
    const onExternalAbort = () => {
      clearTimeout(timer2);
      controller.abort(externalSignal.reason || new Error("external abort"));
    };
    if (externalSignal) {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timer2);
      if (externalSignal)
        externalSignal.removeEventListener("abort", onExternalAbort);
      const txt = await res.text();
      try {
        return JSON.parse(txt);
      } catch {
        return { content: txt };
      }
    } catch (e) {
      clearTimeout(timer2);
      if (externalSignal)
        externalSignal.removeEventListener("abort", onExternalAbort);
      lastErr = e;
      const isTimeout = e.name === "AbortError";
      const isExternalAbort = isTimeout && externalSignal?.aborted;
      if (isExternalAbort) {
        log11.warn(`\uD83D\uDCE4 postJSON \u88AB\u5916\u90E8\u4E2D\u65B7 (total timeout)`);
        throw e;
      }
      if (attempt < retries) {
        const wait = Math.min(1000 * 2 ** attempt, 5000);
        log11.warn(`\uD83D\uDCE4 postJSON \u91CD\u8A66 ${attempt + 1}/${retries} (${isTimeout ? "timeout" : e.message})\uFF0C\u7B49\u5F85 ${wait}ms...`);
        await delay(wait);
        continue;
      }
      if (isTimeout)
        throw new Error("timeout");
      throw e;
    }
  }
  throw lastErr;
};
var getJSON = async (url, timeout = 15000, retries = 2, externalSignal = null) => {
  let lastErr;
  for (let attempt = 0;attempt <= retries; attempt++) {
    if (externalSignal?.aborted) {
      throw externalSignal.reason || new Error("external abort");
    }
    const controller = new AbortController;
    const timer2 = setTimeout(() => controller.abort(), timeout);
    const onExternalAbort = () => {
      clearTimeout(timer2);
      controller.abort(externalSignal.reason || new Error("external abort"));
    };
    if (externalSignal) {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
    try {
      const res = await fetch(url, {
        headers: authHeaders,
        signal: controller.signal
      });
      clearTimeout(timer2);
      if (externalSignal)
        externalSignal.removeEventListener("abort", onExternalAbort);
      const txt = await res.text();
      try {
        return JSON.parse(txt);
      } catch {
        return null;
      }
    } catch (e) {
      clearTimeout(timer2);
      if (externalSignal)
        externalSignal.removeEventListener("abort", onExternalAbort);
      lastErr = e;
      const isTimeout = e.name === "AbortError";
      if (attempt < retries) {
        const wait = Math.min(1000 * 2 ** attempt, 5000);
        log11.warn(`\uD83D\uDCE4 getJSON \u91CD\u8A66 ${attempt + 1}/${retries} (${isTimeout ? "timeout" : e.message})\uFF0C\u7B49\u5F85 ${wait}ms...`);
        await delay(wait);
        continue;
      }
      if (isTimeout)
        throw new Error("timeout");
      throw e;
    }
  }
  throw lastErr;
};
var requestUpstream = async (path3, body, opts = {}) => {
  if (_router) {
    try {
      const result = await _router.exec("POST", path3, body, {
        timeout: opts.timeout || 120000,
        retries: opts.retries ?? 2,
        trace: opts.trace || "upstream"
      });
      return result.data;
    } catch (e) {
      log11.warn(`\u2B07\uFE0F Router failover \u5168\u90E8\u5931\u6557\uFF0C\u964D\u7D1A\u76F4\u9023: ${(e.message || "").slice(0, 80)}`);
    }
  }
  return postJSON(`${QWEN2API_URL}${path3}`, body, opts.timeout || 120000, opts.retries ?? 2, opts.signal || null);
};
var requestUpstreamStream = async (path3, body, opts = {}) => {
  if (_router) {
    try {
      const result = await _router.execStream(path3, body, {
        timeout: opts.timeout || 120000,
        retries: opts.retries ?? 1,
        trace: opts.trace || "stream"
      });
      return result.response;
    } catch (e) {
      log11.warn(`\u2B07\uFE0F Router stream failover \u5168\u90E8\u5931\u6557\uFF0C\u964D\u7D1A\u76F4\u9023: ${(e.message || "").slice(0, 80)}`);
    }
  }
  return postStream(`${QWEN2API_URL}${path3}`, body, opts.timeout || 120000, opts.signal || null);
};
var execTool = async (name, args) => {
  switch (name) {
    case "read": {
      const fp = args.filePath || args.path;
      if (!fp)
        return "";
      try {
        return await Bun.file(fp).text();
      } catch {
        try {
          return fs3.readFileSync(fp, "utf-8");
        } catch (e) {
          return `[\u7121\u6CD5\u8B80\u53D6 ${fp}: ${e.message}]`;
        }
      }
    }
    case "write": {
      const fp = args.filePath || args.path;
      const content = args.content || "";
      if (!fp)
        return "";
      try {
        const dir = path2.dirname(fp);
        if (dir && dir !== "." && dir !== "/") {
          fs3.mkdirSync(dir, { recursive: true });
        }
      } catch {}
      try {
        await Bun.write(fp, content);
        return `\u2713 \u5DF2\u5BEB\u5165 ${fp}`;
      } catch {
        try {
          fs3.writeFileSync(fp, content, "utf-8");
          return `\u2713 \u5DF2\u5BEB\u5165 ${fp}`;
        } catch (e) {
          return `[\u5BEB\u5165\u5931\u6557 ${fp}: ${e.message}]`;
        }
      }
    }
    case "bash":
    case "execute": {
      const cmd = args.command || args.cmd || "";
      if (!cmd)
        return "";
      const cwd = args.cwd || args.dir || args.workdir || "";
      const bashOpts = { timeout: 60000 };
      if (cwd)
        bashOpts.cwd = cwd;
      const {
        stdout: out,
        stderr: err,
        exitCode
      } = await execShellAsync(cmd, bashOpts);
      const MAX_LEN = 8192;
      const safeOut = out.length > MAX_LEN ? out.slice(0, MAX_LEN) + `
... [output truncated]` : out;
      const safeErr = err?.length > MAX_LEN ? err.slice(0, MAX_LEN) + `
... [error truncated]` : err;
      const combined = exitCode !== 0 ? safeOut + (safeErr ? `
[stderr]
${safeErr}` : "") : safeOut;
      return combined || `[\u6307\u4EE4\u57F7\u884C\u5B8C\u7562\uFF0C\u7121\u8F38\u51FA]`;
    }
    case "edit": {
      const fp = args.filePath || args.path;
      const oldStr = args.oldString;
      const newStr = args.newString;
      if (!fp || !oldStr)
        return "";
      try {
        let content = fs3.readFileSync(fp, "utf-8");
        if (!content.includes(oldStr))
          return `[\u672A\u627E\u5230: ${oldStr}]`;
        content = content.replace(oldStr, newStr || "");
        fs3.writeFileSync(fp, content, "utf-8");
        return `\u2713 \u5DF2\u7DE8\u8F2F ${fp}`;
      } catch (e) {
        return `[\u7DE8\u8F2F\u5931\u6557 ${fp}: ${e.message}]`;
      }
    }
    case "glob": {
      const pattern = args.pattern || "";
      const cwd = args.path || args.dir || ".";
      if (!pattern)
        return "";
      try {
        const g = new Bun.Glob(pattern);
        const results = [...g.scanSync({ cwd })];
        return results.join(`
`) || "\u7121\u5339\u914D\u7D50\u679C";
      } catch (e) {
        try {
          const { execSync: execSync4 } = await import("child_process");
          const out = execSync4(`find ${cwd} -path '${pattern}' 2>/dev/null || true`, { encoding: "utf-8", timeout: 1e4 });
          return out || "\u7121\u5339\u914D\u7D50\u679C";
        } catch (e2) {
          return `[\u641C\u5C0B\u5931\u6557: ${e.message}]`;
        }
      }
    }
    case "grep":
    case "search": {
      const pattern = args.pattern || args.query || "";
      const fp = args.filePath || args.path || args.dir || ".";
      if (!pattern)
        return "";
      try {
        const { stdout } = execGrep(pattern, fp, ["*.ts", "*.tsx", "*.js"]);
        return stdout || "\u7121\u5339\u914D\u7D50\u679C";
      } catch (e) {
        return `[\u641C\u5C0B\u5931\u6557: ${e.message}]`;
      }
    }
    default:
      return `[\u672A\u77E5\u5DE5\u5177: ${name}]`;
  }
};
var mcpCall = async (name, args) => {
  try {
    return await execTool(name, args);
  } catch (e) {
    return `\u274C \u5DE5\u5177\u57F7\u884C\u5931\u6557: ${e.message}`;
  }
};
var _TOOL_FMT_GUIDE = [
  "\u53EF\u7528\u5DE5\u5177: ${names}\u3002",
  "",
  "\u3010\u8F38\u51FA\u683C\u5F0F\u3011\u4F7F\u7528\u5DE5\u5177\u6642\u8ACB\u9075\u5FAA\u4EE5\u4E0B\u683C\u5F0F\uFF1A",
  "",
  "  bash\uFF08\u57F7\u884C\u547D\u4EE4\uFF09\u2192",
  "    ```bash",
  "    ls -la",
  "    ```",
  "",
  "  read\uFF08\u8B80\u53D6\u6A94\u6848\uFF09\u2192 \u7528 cat \u900F\u904E bash",
  "    ```bash",
  "    cat /path/to/file",
  "    ```",
  "",
  "  write\uFF08\u5EFA\u7ACB/\u7DE8\u8F2F\u6A94\u6848\uFF09\u2192",
  "    ```",
  "    \u6A94\u6848\u5167\u5BB9",
  "    ```",
  "",
  "  grep\uFF08\u641C\u5C0B\u5167\u5BB9\uFF09\u2192 \u900F\u904E bash",
  "    ```bash",
  "    grep pattern /path/to/file",
  "    ```",
  "",
  "  glob\uFF08\u641C\u5C0B\u6A94\u6848\uFF09\u2192 \u900F\u904E bash",
  "    ```bash",
  "    find /path -name '*.ts'",
  "    ```",
  "",
  "  edit\uFF08\u7DE8\u8F2F\u6A94\u6848\uFF09\u2192 \u900F\u904E bash",
  "    ```bash",
  "    sed -i 's/old/new/g' /path/to/file",
  "    ```",
  "",
  "\u8ACB\u76F4\u63A5\u8F38\u51FA\u5DE5\u5177\u5340\u584A\uFF0C\u4E0D\u8981\u53EA\u63CF\u8FF0\u8981\u505A\u4EC0\u9EBC\u3002",
  "\u4E0D\u8981\u4F7F\u7528 <tool_call> XML \u683C\u5F0F\u3002"
].join(`
`);
var buildToolPrompt = (tools, model = "") => {
  if (!tools?.length)
    return null;
  try {
    const adaptive = buildAdaptivePrompt(tools, model);
    if (adaptive)
      return adaptive;
  } catch (_) {}
  const names = tools.map((t) => t.function?.name || t.name).join(", ");
  return _TOOL_FMT_GUIDE.replace("${names}", names);
};
var genDesc = (cmd) => {
  const s = cmd.trim().slice(0, 60);
  const first = s.split(/\s+/)[0];
  const map = {
    ls: "Lists directory contents",
    cat: "Reads file content",
    grep: "Searches file content",
    find: "Finds files",
    mkdir: "Creates directory",
    rm: "Removes files",
    cp: "Copies files",
    mv: "Moves files",
    echo: "Outputs text",
    cd: "Changes directory",
    bun: "Runs bun command",
    npm: "Runs npm command",
    node: "Runs node command",
    git: "Runs git command",
    curl: "Makes HTTP request",
    systemctl: "Controls systemd service"
  };
  return map[first] || `Executes: ${s}`;
};
var normalizeWinPath = (cmd) => {
  return cmd.replace(/([A-Za-z]):\\([^\\\s"'])/g, (m, d, rest) => `${d}:/${rest}`);
};
var _CODE_EXT_MAP = {
  js: ".js",
  javascript: ".js",
  mjs: ".mjs",
  cjs: ".cjs",
  jsx: ".jsx",
  ts: ".ts",
  typescript: ".ts",
  mts: ".mts",
  cts: ".cts",
  tsx: ".tsx",
  py: ".py",
  python: ".py",
  css: ".css",
  html: ".html",
  htm: ".html",
  json: ".json",
  jsonc: ".json",
  yaml: ".yml",
  yml: ".yml",
  toml: ".toml",
  xml: ".xml",
  svg: ".svg",
  md: ".md",
  markdown: ".md",
  mdx: ".mdx",
  sh: ".sh",
  bash: ".sh",
  shell: ".sh",
  zsh: ".sh",
  dockerfile: "Dockerfile",
  docker: "Dockerfile",
  go: ".go",
  rs: ".rs",
  rust: ".rs",
  java: ".java",
  kt: ".kt",
  kotlin: ".kt",
  scala: ".scala",
  swift: ".swift",
  c: ".c",
  cpp: ".cpp",
  cxx: ".cpp",
  cc: ".cpp",
  h: ".h",
  hpp: ".hpp",
  cs: ".cs",
  csharp: ".cs",
  "c#": ".cs",
  dart: ".dart",
  lua: ".lua",
  r: ".r",
  sql: ".sql",
  vue: ".vue",
  svelte: ".svelte",
  php: ".php",
  rb: ".rb",
  ruby: ".rb",
  prisma: ".prisma",
  graphql: ".graphql",
  gql: ".graphql",
  proto: ".proto",
  makefile: "Makefile",
  cmake: "CMakeLists.txt",
  txt: ".txt",
  env: ".env",
  cfg: ".cfg",
  ini: ".ini",
  conf: ".conf",
  nix: ".nix",
  terraform: ".tf",
  tf: ".tf",
  dockercompose: "docker-compose.yml",
  compose: "docker-compose.yml"
};
var _guessExtFromContent = (code, langTag = "") => {
  const s = code.trim();
  const tagExtMatch = langTag.match(/\.(\w+)$/);
  if (tagExtMatch)
    return `.${tagExtMatch[1]}`;
  const firstLine = s.split(`
`)[0]?.trim() || "";
  if (/^<!DOCTYPE html/i.test(firstLine) || /^<html/i.test(firstLine) || /^<[a-z]+[\s>]/i.test(firstLine))
    return ".html";
  if (/import\s+(React|useState|useEffect|\w+\s+from\s+['"]react)/.test(s) || /export\s+default\s+function\s+\w+/.test(s) && /return\s*\(?\s*</.test(s))
    return ".tsx";
  if (/^<template>/.test(s) || /^<script\s+setup>/.test(s))
    return ".vue";
  if (/^import\s+\w+|^from\s+\w+\s+import|^def\s+\w+|^class\s+\w+[:]/.test(s) || /if\s+__name__\s*==\s*['"]__main__['"]/.test(s))
    return ".py";
  if (/^package\s+\w+/.test(s) && (/^import\s*\(/m.test(s) || /^func\s+\w+/.test(s)))
    return ".go";
  if (/^use\s+\w+/.test(s) && /^fn\s+\w+/.test(s))
    return ".rs";
  if (/^public\s+(class|interface|enum)\s+\w+/.test(s) || /^package\s+[\w.]+/.test(s))
    return ".java";
  if (/^#include\s*[<"]/.test(s) || /^using\s+namespace/.test(s))
    return s.includes("class ") && s.includes("public:") ? ".hpp" : ".cpp";
  if (/^(SELECT|CREATE|INSERT|UPDATE|DELETE|ALTER|DROP|TABLE|INDEX)\s/i.test(s))
    return ".sql";
  if (/^\s*[{[]\s*$/.test(s) && s.includes('":'))
    return ".json";
  if (/^\s*\w+:\s/.test(s) && !/^\s*\/\//.test(s) && !s.includes("===") && !s.includes("=>"))
    return ".yml";
  if (/^[.#@]\w+\s*\{/.test(s) || s.includes("@media") || s.includes("flexbox") || s.includes("grid"))
    return ".css";
  if (/^#!/.test(s) || /^(sudo|apt|npm|yarn|pip|docker|git|ls|cd|rm|mkdir|touch|echo)\s/.test(s))
    return ".sh";
  if (/^#\s+\w+/.test(s) && s.includes("##"))
    return ".md";
  if (/^FROM\s+\w+/i.test(s) || /^RUN\s+/i.test(s))
    return "Dockerfile";
  if (/^(model|enum|generator|datasource)\s+\w+/.test(s))
    return ".prisma";
  return ".txt";
};
var _extractFilePath = (lang, precedingText, codeContent) => {
  const ext = _CODE_EXT_MAP[lang.toLowerCase()];
  if (!ext || ext === ".sh")
    return null;
  const headLines = codeContent.split(`
`).slice(0, 8).join(`
`);
  const searchSpace = (precedingText || "") + `
` + headLines;
  const markerMatch = searchSpace.match(/(?:filepath|path|file|\u5BEB\u5165[\s]*(?:\u5230|\u81F3)?)\s*[:\uFF1A=]\s*[`"']?([a-zA-Z0-9_\-./]+(?:\.\w{1,4}))[`"']?/i);
  if (markerMatch && markerMatch[1].endsWith(ext) && /^[a-zA-Z0-9_\-./]+$/.test(markerMatch[1]) && !markerMatch[1].includes("://")) {
    return markerMatch[1];
  }
  const fileRefs = [
    ...(precedingText || "").matchAll(/[`"']?([a-zA-Z0-9_\-./]+(?:\.\w{1,4}))[`"']?/g)
  ];
  const validRefs = [...fileRefs].map((m) => m[1]).filter((p) => p.endsWith(ext) && /^[a-zA-Z0-9_\-./]+$/.test(p) && !p.includes("://"));
  if (validRefs.length > 0)
    return validRefs[0];
  const commentLines = codeContent.split(`
`).slice(0, 8);
  for (const line of commentLines) {
    const pathMatch = line.match(/(?:\/\/|#|<!--|{\/\*|@)\s*(?:file|path|type)?\s*[:\uFF1A=]?\s*([a-zA-Z0-9_\-./]+(?:\.\w{1,4}))\s*(?:\*\/|-->)?/);
    if (pathMatch && pathMatch[1].endsWith(ext) && /^[a-zA-Z0-9_\-./]+$/.test(pathMatch[1]) && !pathMatch[1].includes("://")) {
      return pathMatch[1];
    }
  }
  const firstExport = codeContent.match(/(?:export\s+(?:default\s+)?(?:function|class|const|let|var)|module\.exports)\s+(\w+)/);
  if (firstExport) {
    const name = firstExport[1];
    const pascalMatch = name.match(/^[A-Z][a-zA-Z0-9]+/);
    const hookMatch = name.match(/^use[A-Z][a-zA-Z0-9]+/);
    const utilMatch = name.match(/^[a-z][a-zA-Z0-9]+/);
    if (pascalMatch && ext === ".tsx")
      return `src/components/${name}${ext}`;
    if (pascalMatch && ext === ".ts")
      return `src/lib/${name}${ext}`;
    if (hookMatch && ext === ".ts")
      return `src/hooks/${name}${ext}`;
    if (utilMatch && ext === ".ts")
      return `src/lib/${name}${ext}`;
    if (pascalMatch && ext === ".jsx")
      return `src/components/${name}${ext}`;
    if (ext === ".css" || ext === ".scss") {
      const cssName = name.toLowerCase();
      return `src/styles/${cssName}${ext}`;
    }
  }
  const firstLine = codeContent.split(`
`)[0]?.trim();
  const namedMatch = firstLine?.match(/@(?:file|name|type)\s+([a-zA-Z0-9_\-./]+(?:\.\w{1,4}))/i);
  if (namedMatch && /^[a-zA-Z0-9_\-./]+$/.test(namedMatch[1]) && !namedMatch[1].includes("://")) {
    return namedMatch[1];
  }
  const defaultPaths = {
    ".ts": "src/index.ts",
    ".tsx": "src/index.tsx",
    ".js": "src/index.js",
    ".jsx": "src/index.jsx",
    ".py": "main.py",
    ".css": "src/styles/styles.css",
    ".html": "index.html",
    ".json": "config.json",
    ".md": "README.md",
    ".sql": "migration/init.sql",
    ".go": "main.go",
    ".rs": "src/main.rs",
    ".java": "src/Main.java",
    ".vue": "src/App.vue",
    ".svelte": "src/App.svelte",
    ".prisma": "schema.prisma",
    ".proto": "proto/main.proto",
    ".yml": "config.yml",
    ".yaml": "config.yaml",
    ".toml": "config.toml",
    ".xml": "config.xml",
    ".svg": "assets/icon.svg",
    ".env": ".env",
    ".txt": "output.txt"
  };
  if (defaultPaths[ext])
    return defaultPaths[ext];
  log11.warn(`\u26A0\uFE0F \u7121\u6CD5\u63A8\u65B7 ${lang} \u5340\u584A\u6A94\u540D\uFF0C\u4F7F\u7528 fallback \u8DEF\u5F91 (${ext})`);
  return `src/generated/file${ext}`;
};
var nonBashBlockToToolCalls = (content, tools, precedingContent = "") => {
  const hasWrite = tools?.some((t) => (t.function?.name || t.name) === "write");
  if (!hasWrite)
    return null;
  const CODE_RE = /```(\w+)\s*\n?([\s\S]*?)```/gi;
  const writes = [];
  let m;
  while ((m = CODE_RE.exec(content)) !== null) {
    const lang = m[1].toLowerCase().trim();
    const code = m[2];
    if (["bash", "sh", "shell", "zsh", "text", "plaintext", ""].includes(lang))
      continue;
    if (!code.trim())
      continue;
    if (code.trim().length < 20 && !code.includes(`
`))
      continue;
    const ext = _CODE_EXT_MAP[lang.toLowerCase()];
    if (!ext) {
      const guessExt = _guessExtFromContent(code, lang);
      const safeName = lang.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase() || "unknown";
      const fallbackFp = `src/generated/${safeName}${guessExt}`;
      log11.warn(`\u26A0\uFE0F \u672A\u77E5\u8A9E\u8A00\u6A19\u7C64\u300C${lang}\u300D\uFF0C\u4F7F\u7528 fallback \u8DEF\u5F91 ${fallbackFp}\uFF08\u5167\u5BB9: ${code.trim().slice(0, 60)}...\uFF09`);
      writes.push({
        id: `call-${Date.now()}-write-${writes.length}`,
        type: "function",
        function: {
          name: "write",
          arguments: JSON.stringify({
            filePath: fallbackFp,
            content: code
          })
        }
      });
      continue;
    }
    const fp = _extractFilePath(lang, precedingContent || content.slice(0, Math.max(0, m.index - 200)), code);
    if (!fp) {
      const fallbackFp = `src/generated/block-${writes.length + 1}.${ext.replace(".", "")}`;
      log11.warn(`\u26A0\uFE0F _extractFilePath \u56DE\u50B3 null for lang=${lang}\uFF0C\u4F7F\u7528 fallback ${fallbackFp}`);
      writes.push({
        id: `call-${Date.now()}-write-${writes.length}`,
        type: "function",
        function: {
          name: "write",
          arguments: JSON.stringify({
            filePath: fallbackFp,
            content: code
          })
        }
      });
      continue;
    }
    log11.info(`\uD83D\uDCDD \u975E bash \u5340\u584A (${lang}) \u2192 write ${fp}`);
    writes.push({
      id: `call-${Date.now()}-write-${writes.length}`,
      type: "function",
      function: {
        name: "write",
        arguments: JSON.stringify({
          filePath: fp,
          content: code
        })
      }
    });
  }
  return writes.length > 0 ? writes : null;
};
var bashBlockToToolCalls = (content, tools) => {
  const hasBash = tools?.some((t) => (t.function?.name || t.name) === "bash");
  if (!hasBash)
    return null;
  const BASH_RE = /```(?:bash|sh|shell)\s*\n?([\s\S]*?)```/gi;
  const cmds = [];
  let m;
  while ((m = BASH_RE.exec(content)) !== null) {
    const c = m[1].trim();
    if (c && !c.startsWith("#") && !c.startsWith("//"))
      cmds.push(c);
  }
  if (!cmds.length)
    return null;
  const unique = [...new Set(cmds)];
  return unique.map((cmd, i) => {
    const norm = normalizeWinPath(cmd);
    if (norm !== cmd)
      log11.debug(`\uD83D\uDD04 \u8DEF\u5F91\u6B63\u898F\u5316: ${cmd.slice(0, 60)} \u2192 ${norm.slice(0, 60)}`);
    return {
      id: `call-${Date.now()}-${i}`,
      type: "function",
      function: {
        name: "bash",
        arguments: JSON.stringify({
          command: norm,
          description: genDesc(norm)
        })
      }
    };
  });
};
var looseBlockToToolCalls = (content, tools) => {
  const text = (content || "").trim();
  if (!text || text.includes("```"))
    return null;
  const hasBash = tools?.some((t) => (t.function?.name || t.name) === "bash");
  const hasWrite = tools?.some((t) => (t.function?.name || t.name) === "write");
  if (!hasBash && !hasWrite)
    return null;
  const heredocRe = /cat\s+(?:<<['"]?[A-Za-z0-9_]+['"]?\s*>\s*([^\s'"]+)|>\s*([^\s'"]+)\s*<<['"]?[A-Za-z0-9_]+['"]?)\s*\n([\s\S]*?)\n[A-Za-z0-9_]+\s*$/;
  const hm = text.match(heredocRe);
  if (hm) {
    const fp = (hm[1] || hm[2] || "").trim();
    const body = (hm[3] || "").replace(/\nEOF\s*$/, "").trim();
    if (fp && hasWrite) {
      log11.warn(`\uD83D\uDCDD \u5BEC\u9B06\u88DC\u6551: heredoc \u2192 write ${fp}`);
      return [
        {
          id: `call-loose-${Date.now()}-w`,
          type: "function",
          function: {
            name: "write",
            arguments: JSON.stringify({ filePath: fp, content: body })
          }
        }
      ];
    }
  }
  const echoRe = /^(?:echo|printf)\s+(['"]?)([\s\S]*?)\1\s*>\s*([^\s'"]+)\s*$/m;
  const em = text.match(echoRe);
  if (em && hasWrite) {
    const fp = em[3].trim();
    const body = em[2];
    if (fp && body) {
      log11.warn(`\uD83D\uDCDD \u5BEC\u9B06\u88DC\u6551: echo > \u2192 write ${fp}`);
      return [
        {
          id: `call-loose-${Date.now()}-w`,
          type: "function",
          function: {
            name: "write",
            arguments: JSON.stringify({ filePath: fp, content: body })
          }
        }
      ];
    }
  }
  const codeSig = /^\s*(?:import\s|from\s|def\s|class\s|function\s|const\s|let\s|var\s|export\s|#!\/|package\s|#include|public\s+class|fn\s+)/m;
  if (codeSig.test(text) && text.length > 50 && hasWrite) {
    const ext = (() => {
      if (/^\s*(import|from|export|const|let|var|function)/.test(text))
        return ".js";
      if (/^\s*def\s|^\s*import\s+\w+\s*$|if\s+__name__/.test(text))
        return ".py";
      if (/^\s*package\s/.test(text))
        return ".go";
      if (/^\s*#include|^\s*using\s+namespace/.test(text))
        return ".cpp";
      if (/^\s*public\s+class/.test(text))
        return ".java";
      return ".txt";
    })();
    const fp = `src/generated/file${ext}`;
    log11.warn(`\uD83D\uDCDD \u5BEC\u9B06\u88DC\u6551: \u88F8\u7A0B\u5F0F\u78BC \u2192 write ${fp}`);
    return [
      {
        id: `call-loose-${Date.now()}-w`,
        type: "function",
        function: {
          name: "write",
          arguments: JSON.stringify({ filePath: fp, content: text })
        }
      }
    ];
  }
  if (hasBash && /(^|\n)\s*(?:cat|echo|printf|node|bun|npm|python|cp|mv|touch|mkdir)\b[\s\S]*>\s*\S/.test(text)) {
    log11.warn(`\uD83D\uDD27 \u5BEC\u9B06\u88DC\u6551: shell \u91CD\u5B9A\u5411 \u2192 bash`);
    return [
      {
        id: `call-loose-${Date.now()}-b`,
        type: "function",
        function: {
          name: "bash",
          arguments: JSON.stringify({
            command: text,
            description: "Executes shell"
          })
        }
      }
    ];
  }
  return null;
};
var safeWrite = (res, data) => {
  try {
    if (!res.destroyed && res.writable) {
      res.write(data);
      return true;
    }
  } catch {}
  return false;
};
var safeEnd = (res) => {
  try {
    if (!res.destroyed && res.writable)
      res.end();
  } catch {}
};
var streamChunk = (res, msgId, model, data) => {
  safeWrite(res, `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created: Math.round(Date.now() / 1000), model, ...data })}

`);
};
var CHUNK = 32;
var runSinglePass = async (body, isClientGone = null) => {
  const _baseTimeout = parseInt(process.env.PROXY_TIMEOUT_MS || "120000");
  const TIMEOUT_MS = (() => {
    try {
      return getTimeoutMs(body?.model || "unknown", _baseTimeout);
    } catch {
      return _baseTimeout;
    }
  })();
  const _startTs2 = Date.now();
  const _totalAbort = new AbortController;
  const _timer = setTimeout(() => {
    _totalAbort.abort(new Error(`\u8ACB\u6C42\u7E3D\u8D85\u6642 (${TIMEOUT_MS}ms)`));
    log11.warn(`\u23F0 \u8ACB\u6C42\u7E3D\u8D85\u6642\u89F8\u767C (${TIMEOUT_MS}ms)`);
    try {
      const model = body?.model || "unknown";
      recordModelLatency(model, TIMEOUT_MS, true);
      recordStallEvent({
        model,
        latencyMs: TIMEOUT_MS,
        isTimeout: true,
        taskType: (body?.tools?.length || 0) > 0 ? "coding" : "chat",
        prompt: (body?.messages?.[body.messages.length - 1]?.content || "").slice(0, 100)
      });
    } catch (_) {}
  }, TIMEOUT_MS);
  const _goneWatch = setInterval(() => {
    if (isClientGone?.()) {
      try {
        _totalAbort.abort(new Error("client disconnected"));
      } catch {}
    }
  }, 200);
  let _progressTimer = null;
  try {
    const { messages, tools, tool_choice, stream, ...rest } = body;
    let msgs = [...messages || []];
    const promptText = (messages || []).map((m) => (typeof m.content === "string" ? m.content : "") + (m.role || "")).join(" ");
    const _hasToolBeforeTransform = msgs.some((m) => m.role === "assistant" && m.tool_calls?.length > 0);
    const cmdMap = new Map;
    for (const m of msgs) {
      if (m.role === "assistant" && m.tool_calls) {
        for (const tc of m.tool_calls) {
          try {
            const args = JSON.parse(tc.function?.arguments || "{}");
            if (args.command)
              cmdMap.set(tc.id, args.command);
          } catch {}
        }
      }
    }
    msgs = msgs.map((m) => {
      if (m.role === "tool") {
        const raw2 = m.content || "";
        const origCmd = cmdMap.get(m.tool_call_id) || "";
        const exitMatch = raw2.match(/exit code[:\s]*(\d+)/i);
        const exitInfo = exitMatch ? `(exit code: ${exitMatch[1]})` : "";
        const hasOutput = raw2.replace(/\[exit code[:\]]+\d+/gi, "").replace(/stdout:|stderr:/gi, "").trim().length > 20;
        const verdict = exitMatch ? exitMatch[1] === "0" ? "\u2705 \u547D\u4EE4\u6210\u529F\u57F7\u884C" : `\u274C \u547D\u4EE4\u5931\u6557 (exit ${exitMatch[1]})` : "";
        const summary = [
          `\u547D\u4EE4: ${origCmd || "(\u672A\u77E5)"}`,
          verdict,
          exitInfo,
          hasOutput ? `
\u8F38\u51FA:
${raw2}` : `
(\u547D\u4EE4\u57F7\u884C\u5B8C\u7562\uFF0C\u7121\u8F38\u51FA\u5167\u5BB9)`
        ].filter(Boolean).join(" ");
        return {
          role: "user",
          content: `[\u5DE5\u5177\u57F7\u884C\u7D50\u679C] ${summary}`
        };
      }
      if (m.role === "assistant" && m.tool_calls) {
        const { tool_calls, ...rest2 } = m;
        return rest2;
      }
      return m;
    });
    const _dropNoise = (msgs2) => {
      return msgs2.filter((m) => {
        const c = typeof m.content === "string" ? m.content : "";
        if (!c.trim() && !m.tool_calls)
          return false;
        if (c.length < 15 && !m.tool_calls && m.role === "assistant")
          return false;
        return true;
      });
    };
    const _hasImportantContent = (c) => {
      return /`{3,}/.test(c) || /\/[a-zA-Z0-9_\-./]+\.[a-z]{1,4}\b/.test(c) || /Error|exit code|\u274C|\u2705/.test(c) || /axios\.(get|post|put|delete)|fetch\(|curl\s/.test(c) || /\b(function|class|import|export|const\s+\w+\s*[:=])/.test(c);
    };
    const _splitCandidates = (msgs2) => {
      const keep = [];
      const sumz = [];
      for (const m of msgs2) {
        const c = typeof m.content === "string" ? m.content : "";
        if (c.startsWith("[\u5DE5\u5177\u57F7\u884C\u7D50\u679C]") || m.tool_calls)
          keep.push(m);
        else if (c.length > 200 && !_hasImportantContent(c))
          sumz.push(m);
        else
          keep.push(m);
      }
      return { keep, sumz };
    };
    const _hashKey = (msgs2) => {
      const raw2 = msgs2.map((m) => `${m.role}:${(typeof m.content === "string" ? m.content : "").slice(0, 80)}`).join("|");
      let h = 0;
      for (let i = 0;i < raw2.length; i++)
        h = (h << 5) - h + raw2.charCodeAt(i) | 0;
      return `s:${h.toString(36)}`;
    };
    const _summarizeAsync = async (msgs2, ck) => {
      const sysPrompt = `\u5C07\u4EE5\u4E0B\u5C0D\u8A71\u6B77\u53F2\u58D3\u7E2E\u70BA\u7E41\u9AD4\u4E2D\u6587\u91CD\u9EDE\u6458\u8981\uFF0C\u56B4\u683C\u4FDD\u7559\u5177\u9AD4\u6280\u8853\u7D30\u7BC0\u3002
` + `\u683C\u5F0F\uFF08\u5B8C\u6574\u4FDD\u7559\uFF0C\u4E0D\u53EF\u7701\u7565\uFF09\uFF1A
` + `## \u76EE\u6A19
- \u7528\u6236\u6700\u7D42\u60F3\u9054\u6210\u4EC0\u9EBC

` + `## \u64CD\u4F5C\u8A18\u9304
- \u4F9D\u5E8F\u5217\u51FA\u6BCF\u6B65\u95DC\u9375\u52D5\u4F5C\uFF08\u6A94\u6848\u8DEF\u5F91\u3001\u51FD\u6578\u540D\u7A31\u3001\u547D\u4EE4\uFF09

` + `## \u6A94\u6848/\u7A0B\u5F0F\u78BC
- \u65B0\u589E/\u4FEE\u6539\u7684\u8DEF\u5F91\u3001\u4E3B\u8981\u985E\u5225/\u51FD\u6578/\u8B8A\u6578\u540D\u7A31

` + `## \u7D50\u679C
- \u6210\u529F/\u5931\u6557\u72C0\u614B\uFF0Cexit code\uFF0C\u932F\u8AA4\u8A0A\u606F\u539F\u6587

` + `## \u5F85\u8FA6
- \u5C1A\u672A\u5B8C\u6210\u7684\u9805\u76EE

` + `\u898F\u5247\uFF1A
` + `1. \u7701\u7565\u8A9E\u6C23\u8A5E\u3001\u91CD\u8907\u5617\u8A66\u3001\u6A21\u578B\u601D\u8003\u904E\u7A0B
` + `2. \u6240\u6709\u6A94\u6848\u8DEF\u5F91\u3001\u51FD\u6578\u540D\u3001\u8B8A\u6578\u540D\u3001error message **\u5FC5\u9808\u4FDD\u7559\u539F\u6587**
` + `3. \u9577\u5EA6\u63A7\u5236\u5728\u539F\u6587 15% \u4EE5\u5167\uFF0C\u4F46\u8A0A\u606F\u5BC6\u5EA6\u8981\u9AD8
` + "4. \u82E5\u6709\u4E0D\u78BA\u5B9A\u7684\u8CC7\u8A0A\uFF0C\u5BE7\u53EF\u7559\u8457\u4E0D\u8981\u522A";
      const body2 = msgs2.map((m) => `[${m.role}]
${typeof m.content === "string" ? m.content : ""}`).join(`
---
`);
      try {
        const res = await requestUpstream("/v1/chat/completions", {
          model: SUMMARY_MODEL,
          messages: [
            { role: "system", content: sysPrompt },
            { role: "user", content: body2 }
          ],
          stream: false,
          max_tokens: 2048
        }, { timeout: 60000, retries: 1, trace: "summary" });
        const s = res?.choices?.[0]?.message?.content || "";
        if (s.length > 20) {
          _convSummaryCache.set(ck, { summary: s, ts: Date.now() });
          log11.info(`\uD83E\uDDE0 AI \u6458\u8981\u5B8C\u6210: ${s.length}ch (key=${ck.slice(0, 8)}...)`);
        }
      } catch (e) {
        log11.warn(`\uD83E\uDDE0 AI \u6458\u8981\u5931\u6557: ${(e.message || "").slice(0, 60)}`);
      }
    };
    const _totalSize = msgs.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : 0), 0);
    if (_totalSize > CONTEXT_COMPRESS_THRESHOLD) {
      const _before = msgs.length;
      const sys = msgs.filter((m) => m.role === "system");
      const recent = msgs.slice(-CONTEXT_KEEP_RECENT);
      const candidates = msgs.slice(sys.length, msgs.length - CONTEXT_KEEP_RECENT);
      let cached = null;
      let sumz = [];
      if (candidates.length > 0) {
        const clean = _dropNoise(candidates);
        const ck = _hashKey(clean);
        cached = _convSummaryCache.get(ck);
        if (cached && Date.now() - cached.ts < SUMMARY_CACHE_TTL) {
          const cleanSys = sys.filter((m) => !m.content.startsWith("\uD83D\uDCCB \u4EE5\u4E0B\u70BA\u8F03\u65E9\u7684\u5C0D\u8A71\u6458\u8981"));
          msgs = [
            ...cleanSys,
            {
              role: "system",
              content: `\uD83D\uDCCB \u4EE5\u4E0B\u70BA\u8F03\u65E9\u7684\u5C0D\u8A71\u6458\u8981\uFF08\u539F\u59CB ${_totalSize}ch \u2192 ${cached.summary.length}ch\uFF09\uFF1A
${cached.summary}`
            },
            ...recent
          ];
          log11.info(`\uD83E\uDDE0 AI \u6458\u8981\u5FEB\u53D6\u547D\u4E2D (key=${ck.slice(0, 8)}... ${cached.summary.length}ch)`);
        } else {
          const { keep, sumz: sumArr } = _splitCandidates(clean);
          sumz = sumArr;
          const sysSize = sys.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : 0), 0);
          const keepSize = keep.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : 0), 0);
          const recentSize = recent.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : 0), 0);
          const overhead = sumz.length * 30;
          const quota = Math.max(500, CONTEXT_COMPRESS_THRESHOLD - sysSize - keepSize - recentSize - overhead);
          const perMsg = sumz.length > 0 ? Math.floor(quota / sumz.length) : 500;
          const headLen = Math.min(Math.floor(perMsg * 0.7), 1e4);
          const tailLen = Math.min(perMsg - headLen, 5000);
          const truncated = sumz.map((m) => {
            const c = typeof m.content === "string" ? m.content : "";
            const head = c.slice(0, headLen);
            const tail = c.length > headLen + 20 ? c.slice(-tailLen) : "";
            const sep = head.length + tail.length < c.length ? " ..." : "";
            const tailSep = tail ? ` ...${tail}` : "";
            return {
              role: m.role,
              content: `[${m.role} \u8A0A\u606F (${c.length}ch)] ${head}${sep}${tailSep}`
            };
          });
          const compressed = [...keep, ...truncated];
          msgs = [...sys, ...compressed, ...recent];
          if (sumz.length > 0)
            _summarizeAsync(sumz, ck);
        }
      }
      log11.warn(`\uD83D\uDCCF \u5C0D\u8A71\u58D3\u7E2E: ${_before}\u2192${msgs.length} \u5247 (${_totalSize}\u2192${msgs.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : 0), 0)}ch)` + (cached ? ` [AI\u6458\u8981]` : sumz?.length ? ` [\u6458\u8981\u9032\u884C\u4E2D: ${sumz.length}\u5247]` : ""));
    }
    const currentModel = routeModel(body);
    if (tools?.length > 0) {
      const toolPrompt = buildToolPrompt(tools, currentModel);
      const sysIdx = msgs.findIndex((m) => m.role === "system");
      if (sysIdx >= 0) {
        msgs = msgs.map((m, i) => i === sysIdx ? { ...m, content: `${m.content}

${toolPrompt}` } : m);
      } else {
        msgs = [{ role: "system", content: toolPrompt }, ...msgs];
      }
    }
    const isThinking = body.enable_thinking ?? body.model?.toLowerCase().includes("thinking");
    const up = {
      ...rest,
      model: currentModel,
      messages: msgs,
      stream: false,
      enable_thinking: isThinking
    };
    const _upContentSize = up.messages.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : 0), 0);
    log11.info(`\uD83D\uDCE4 model=${up.model} msgs=${up.messages.length} ctx=${_upContentSize}ch tools=${tools?.length || 0}`);
    _progressTimer = setTimeout(() => {
      log11.warn(`\u23F3 \u4E0A\u6E38\u4ECD\u7121\u56DE\u61C9 (${Math.round((Date.now() - _startTs2) / 1000)}s), model=${currentModel}`);
    }, 30000);
    const result = await requestUpstream("/v1/chat/completions", up, {
      timeout: 120000,
      retries: 1,
      signal: _totalAbort.signal,
      trace: "chat"
    });
    clearTimeout(_progressTimer);
    const _latencyMs = Date.now() - _startTs2;
    try {
      recordModelLatency(currentModel, _latencyMs, false);
    } catch (_) {}
    try {
      const _respHasContent = result?.choices?.[0]?.message?.content?.trim();
      const _respHasTools = result?.choices?.[0]?.message?.tool_calls?.length;
      recordResponse(currentModel, _respHasTools ? "tool_call" : _respHasContent ? "complete" : "empty", _latencyMs);
    } catch (_) {}
    const _responseHasContent = result?.choices?.[0]?.message?.content?.trim();
    const _responseHasTools = result?.choices?.[0]?.message?.tool_calls?.length;
    if (_responseHasContent || _responseHasTools) {
      _consecutiveEmpty.delete(currentModel);
    }
    const choice = result?.choices?.[0];
    if (!choice) {
      return buildErrorResponse("\u4E0A\u6E38\u7121\u56DE\u61C9", currentModel);
    }
    const msg = choice.message;
    let raw = msg?.content || "";
    if (isClientGone?.()) {
      log11.warn(`\u23F9\uFE0F client \u5DF2\u65B7\u7DDA\uFF0C\u8DF3\u904E\u7A7A\u5167\u5BB9\u964D\u7D1A\u91CD\u8A66`);
      return buildErrorResponse("\u8655\u7406\u4E2D\u65B7\uFF08client \u65B7\u7DDA\uFF09", currentModel);
    }
    if (!raw.trim() && !msg?.tool_calls?.length) {
      log11.warn(`\u26A0\uFE0F \u4E0A\u6E38\u56DE\u50B3\u7A7A\u5167\u5BB9 (model=${currentModel})\uFF0C\u5617\u8A66\u964D\u7D1A\u91CD\u8A66`);
      const consec = (_consecutiveEmpty.get(currentModel) || 0) + 1;
      _consecutiveEmpty.set(currentModel, consec);
      if (consec >= CONSECUTIVE_EMPTY_THRESHOLD) {
        log11.warn(`\u26A0\uFE0F \u6A21\u578B ${currentModel} \u9023\u7E8C ${consec} \u6B21\u7A7A\u5167\u5BB9\uFF0C\u8996\u70BA\u771F\u5BE6\u6A21\u578B\u5931\u6557`);
        recordModelFailure(currentModel, "empty_consecutive");
        _consecutiveEmpty.delete(currentModel);
      } else {
        log11.warn(`\u26A0\uFE0F \u9023\u7E8C\u7A7A\u5167\u5BB9 (${consec}/${CONSECUTIVE_EMPTY_THRESHOLD})\uFF0C\u8DF3\u904E\u6A21\u578B\u5065\u5EB7\u6A19\u8A18\uFF08\u53EF\u80FD\u70BA WAF \u963B\u64CB\uFF09`);
      }
      const _isWafLike = consec < CONSECUTIVE_EMPTY_THRESHOLD;
      try {
        recordModelLatency(currentModel, Date.now() - _startTs2, true, _isWafLike);
      } catch (_) {}
      const _ctxHash = _contextHash(msgs);
      const _now = Date.now();
      if (_globalEmptyCooldown.lastContextHash === _ctxHash && _globalEmptyCooldown.count >= GLOBAL_EMPTY_THRESHOLD && _now < _globalEmptyCooldown.resetAt) {
        log11.warn(`\u26A0\uFE0F \u5168\u57DF\u7A7A\u5167\u5BB9\u7194\u65B7: \u76F8\u540C context \u9023\u7E8C ${_globalEmptyCooldown.count} \u6B21\u7A7A\u5167\u5BB9\uFF0C\u8DF3\u904E\u91CD\u8A66 (\u51B7\u537B ${Math.round((_globalEmptyCooldown.resetAt - _now) / 1000)}s)`);
        return buildErrorResponse(`\u4E0A\u6E38\u6A21\u578B ${currentModel} \u50B3\u56DE\u7A7A\u767D\uFF08context \u904E\u5927\u6216 API \u7570\u5E38\uFF0C\u7194\u65B7\u4E2D\uFF09`, currentModel);
      }
      if (_globalEmptyCooldown.lastContextHash !== _ctxHash) {
        _globalEmptyCooldown.lastContextHash = _ctxHash;
        _globalEmptyCooldown.count = 0;
      }
      const curLevel = classifyModel(currentModel);
      const candidates = [];
      const filterCandidate = (m) => isTextModel(m) && !isModelUnhealthy(m) && !isBlockedOnDevice(m);
      const origModel = body?.model || "";
      if (origModel && origModel !== currentModel && filterCandidate(origModel)) {
        candidates.push({ tag: "\u539F\u59CB\u6307\u5B9A", model: origModel });
      }
      try {
        const hcCtrl = new AbortController;
        const hcTimer = setTimeout(() => hcCtrl.abort(), 3000);
        const hc = await fetch(`${QWEN2API_URL}/health`, {
          signal: hcCtrl.signal
        });
        clearTimeout(hcTimer);
        if (!hc.ok)
          throw new Error(`health: ${hc.status}`);
      } catch (healthErr) {
        log11.warn(`\u26A0\uFE0F qwen2api \u96E2\u7DDA (${healthErr.message})\uFF0C\u8DF3\u904E\u6240\u6709\u7A7A\u5167\u5BB9\u6A21\u578B\u91CD\u8A66`);
        return buildErrorResponse(`\u4E0A\u6E38 qwen2api \u670D\u52D9\u96E2\u7DDA\uFF0C\u7121\u6CD5\u8655\u7406\u8ACB\u6C42\u3002\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002`, currentModel);
      }
      if (envModels?.[curLevel]?.length > 1) {
        for (const m of envModels[curLevel]) {
          if (m !== currentModel && filterCandidate(m) && !candidates.find((c) => c.model === m))
            candidates.push({ tag: "\u540C\u7D1A\u5099\u7528", model: m });
        }
      }
      if (!_isTopTier(currentModel)) {
        const downMap = { large: "medium", medium: "small" };
        if (downMap[curLevel]) {
          const m = getModelForLevel(downMap[curLevel]);
          if (m && filterCandidate(m))
            candidates.push({ tag: "\u964D\u7D1A", model: m });
        }
      } else {
        log11.warn(`\uD83C\uDFC6 top-tier \u6A21\u578B ${currentModel} \u4E0D\u964D\u7D1A\uFF0C\u50C5\u5617\u8A66\u540C\u7D1A\u5099\u7528`);
      }
      if (candidates.length > MAX_RETRY_CANDIDATES) {
        log11.warn(`\uD83D\uDCE1 \u5019\u9078\u904E\u591A (${candidates.length})\uFF0C\u622A\u65B7\u81F3 ${MAX_RETRY_CANDIDATES} \u500B`);
        candidates.length = MAX_RETRY_CANDIDATES;
      }
      let found = false;
      for (const c of candidates) {
        log11.warn(`\uD83D\uDCE1 \u7A7A\u5167\u5BB9\u91CD\u8A66: ${currentModel} \u2192 ${c.tag} ${c.model}`);
        const retryUp = {
          ...rest,
          model: c.model,
          messages: msgs,
          stream: false,
          enable_thinking: isThinking
        };
        try {
          const retryResult = await requestUpstream("/v1/chat/completions", retryUp, { timeout: 15000, retries: 1, trace: "retry" });
          const rc2 = retryResult?.choices?.[0];
          if (rc2?.message?.content?.trim()) {
            log11.info(`\u2705 ${c.tag}\u91CD\u8A66\u6210\u529F (${c.model})`);
            _consecutiveEmpty.delete(c.model);
            msg.content = rc2.message.content;
            msg.tool_calls = rc2.message.tool_calls;
            raw = msg.content || "";
            found = true;
            break;
          }
          log11.warn(`\u26A0\uFE0F \u91CD\u8A66 ${c.model} \u4E5F\u56DE\u50B3\u7A7A\u5167\u5BB9\uFF08\u53EF\u80FD\u70BA WAF \u5168\u57DF\u963B\u64CB\uFF09`);
        } catch (retryErr) {
          log11.warn(`\u26A0\uFE0F \u91CD\u8A66\u5931\u6557 ${c.model}: ${retryErr.message}`);
          recordModelFailure(c.model);
        }
      }
      try {
        recordResponse(currentModel, "empty", Date.now() - _startTs2);
      } catch (_) {}
      if (!found) {
        const errText = `\u4E0A\u6E38\u6A21\u578B ${currentModel} \u50B3\u56DE\u7A7A\u767D\uFF0C\u6240\u6709\u5099\u7528\u6A21\u578B\u7686\u7121\u56DE\u61C9\u3002\u8ACB\u6AA2\u67E5 API \u72C0\u614B\u3002`;
        log11.sysError(errText);
        return buildErrorResponse(errText, currentModel);
      }
      try {
        recordResponse(currentModel, "complete", Date.now() - _startTs2);
      } catch (_) {}
    }
    const rc = choice.message?.reasoning_content || "";
    const fallbackThink = rc ? "" : (() => {
      const m = raw.match(/<think>([\s\S]*?)<\/think>/);
      return m ? m[1].trim() : "";
    })();
    const reasoning = rc || fallbackThink;
    const stripped = reasoning ? raw.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim() : raw;
    const nativeCalls = msg?.tool_calls;
    if (nativeCalls?.length > 0) {
      for (const tc of nativeCalls) {
        try {
          const args = JSON.parse(tc.function?.arguments || "{}");
          const cmd = args.command || "";
          const fp = args.filePath || "";
          log11.info(`  \uD83D\uDEE0  ${tc.function?.name}${cmd ? `: ${cmd.slice(0, 120)}` : ""}${fp ? ` \u2192 ${fp}` : ""}`);
        } catch {
          log11.info(`  \uD83D\uDEE0  ${tc.function?.name} ${tc.function?.arguments?.slice(0, 80)}`);
        }
      }
      log11.info(`\uD83D\uDCEC \u539F\u751F tool_calls x${nativeCalls.length}\uFF0C\u900F\u50B3\u7D66 opencode`);
      return buildToolCallResponse(nativeCalls, stripped || msg?.content, currentModel, promptText, reasoning);
    }
    const bashCalls = bashBlockToToolCalls(stripped, tools);
    if (bashCalls?.length > 0) {
      const extractCore = (cmd) => {
        let c = cmd.replace(/^cd\s+[^&&]*&&\s*/, "").trim();
        c = c.replace(/^ls\s+/, "");
        c = c.replace(/\s*2>&1\s*/, "").replace(/\s*\|\s*head\s*.*$/, "");
        return c.trim();
      };
      const prevCores = new Set;
      for (let i = msgs.length - 1;i >= 0; i--) {
        const m = msgs[i];
        if (m.role === "assistant" && m.tool_calls?.length > 0) {
          for (const tc of m.tool_calls) {
            try {
              const cmd = JSON.parse(tc.function?.arguments || "{}")?.command || "";
              if (cmd)
                prevCores.add(extractCore(cmd));
            } catch {}
          }
        }
        if (m.role === "user")
          break;
      }
      const currCores = bashCalls.map((bc) => {
        try {
          return extractCore(JSON.parse(bc.function?.arguments || "{}")?.command || "");
        } catch {
          return "";
        }
      }).filter(Boolean);
      let hasDup = false;
      let dupCmd = "";
      for (const cur of currCores) {
        for (const prev of prevCores) {
          if (cur === prev) {
            hasDup = true;
            dupCmd = cur;
            break;
          }
          const curFirst = cur.split(/\s+/)[0] || "";
          const prevFirst = prev.split(/\s+/)[0] || "";
          const minLen = Math.min(cur.length, prev.length);
          if (curFirst === prevFirst && curFirst.length >= 3 && minLen >= 4 && (cur.startsWith(prev) || prev.startsWith(cur))) {
            hasDup = true;
            dupCmd = cur;
            break;
          }
        }
        if (hasDup)
          break;
      }
      if (hasDup) {
        log11.warn(`\u26D4 \u91CD\u8907\u547D\u4EE4\u5075\u6E2C\uFF08\u6838\u5FC3: ${dupCmd}\uFF09\uFF0C\u5F37\u5236\u505C\u6B62\u8FF4\u5708`);
        return buildTextResponse(`\u2713 \u547D\u4EE4\u300C${dupCmd}\u300D\u5DF2\u57F7\u884C\u6210\u529F\uFF08exit code: 0\uFF09\u3002\u4EFB\u52D9\u7E7C\u7E8C\u9032\u884C\uFF0C\u7121\u9700\u91CD\u8907\u57F7\u884C\u3002`, currentModel, promptText, reasoning);
      }
      const writeCalls2 = nonBashBlockToToolCalls(stripped, tools, raw);
      const mergedCalls = writeCalls2?.length > 0 ? [...bashCalls, ...writeCalls2] : bashCalls;
      for (const bc of mergedCalls) {
        try {
          const args = JSON.parse(bc.function?.arguments || "{}");
          if (args.command)
            log11.info(`  \uD83D\uDEE0  bash: ${args.command.slice(0, 120)}`);
          if (args.filePath)
            log11.info(`  \uD83D\uDEE0  write: ${args.filePath}`);
        } catch {}
      }
      log11.info(`\uD83D\uDD27 bash-block x${bashCalls.length}${writeCalls2?.length ? ` + write x${writeCalls2.length}` : ""} \u2192 tool_calls\uFF0C\u4EA4\u7D66 opencode \u57F7\u884C`);
      const contentBeforeBash = stripped.replace(/```(?:bash|sh|shell)[\s\S]*?```/g, "").trim();
      return buildToolCallResponse(mergedCalls, contentBeforeBash || "", currentModel, promptText, reasoning);
    }
    const writeCalls = nonBashBlockToToolCalls(stripped, tools, raw);
    if (writeCalls?.length > 0) {
      log11.info(`\uD83D\uDCDD \u975E bash \u5340\u584A x${writeCalls.length} \u2192 write tool_calls\uFF0C\u4EA4\u7D66 opencode \u57F7\u884C`);
      const contentBeforeCode = stripped.replace(/```\w+\s*\n?[\s\S]*?```/g, "").trim();
      return buildToolCallResponse(writeCalls, contentBeforeCode || "", currentModel, promptText, reasoning);
    }
    const looseCalls = looseBlockToToolCalls(stripped, tools);
    if (looseCalls?.length > 0) {
      log11.info(`\uD83D\uDD27 \u5BEC\u9B06\u88DC\u6551 x${looseCalls.length} \u2192 tool_calls\uFF0C\u4EA4\u7D66 opencode \u57F7\u884C`);
      return buildToolCallResponse(looseCalls, "", currentModel, promptText, reasoning);
    }
    if (nativeCalls?.length > 0) {
      try {
        recordResponse(currentModel, "tool_call", _latencyMs);
      } catch (_) {}
    }
    if (bashCalls?.length > 0) {
      try {
        recordResponse(currentModel, "tool_call", _latencyMs);
      } catch (_) {}
    }
    const _stallParams = (() => {
      try {
        return getStallParams(currentModel);
      } catch {
        return { threshold: 30000, sensitivity: 1, maxRetries: 2 };
      }
    })();
    const _isStalling = (() => {
      const s = stripped.toLowerCase().trim();
      if (s.length > 30 || bashCalls?.length > 0)
        return false;
      const hasToolHistory = _hasToolBeforeTransform;
      if (!s || s.length < 5) {
        if (hasToolHistory)
          return false;
        const affirms = [
          "\u597D\u7684",
          "\u597D",
          "\u4E86\u89E3",
          "ok",
          "done",
          "\u5B8C\u6210",
          "\u7E7C\u7E8C",
          "\u6536\u5230",
          "\u660E\u767D",
          "\u662F\u7684",
          "yes",
          "no",
          "\uD83D\uDC4D",
          "\u2705",
          "\uD83D\uDC4C"
        ];
        if (affirms.some((a) => s.includes(a)))
          return false;
        return true;
      }
      const stuck = [
        "\u6211\u4E0D\u77E5\u9053",
        "\u65E0\u6CD5",
        "\u6211\u4E0D\u80FD",
        "\u6211\u4E0D\u78BA\u5B9A",
        "\u6211\u4E0D\u786E\u5B9A",
        "i don't know",
        "i cannot",
        "i'm stuck",
        "i am stuck",
        "i'm not sure",
        "sorry,",
        "apolog",
        "can't"
      ];
      const isStuck = stuck.some((k) => s.includes(k));
      return isStuck && !hasToolHistory;
    })();
    if (_isStalling) {
      if (isClientGone?.()) {
        log11.warn(`\u23F9\uFE0F client \u5DF2\u65B7\u7DDA\uFF0C\u8DF3\u904E\u505C\u6EEF\u77EF\u6B63`);
        return buildTextResponse(raw, currentModel, promptText, reasoning);
      }
      try {
        recordResponse(currentModel, "stall", Date.now() - _startTs2);
      } catch (_) {}
      log11.warn(`\uD83E\uDDDF \u5075\u6E2C\u5230\u505C\u6EEF\uFF1A\u6A21\u578B\u53EA\u8AAA\u4E0D\u505A\uFF0C\u81EA\u52D5\u77EF\u6B63\u4E2D...`);
      try {
        recordStallEvent({
          model: currentModel,
          latencyMs: Date.now() - _startTs2,
          isTimeout: false,
          taskType: "coding",
          prompt: (messages?.[messages.length - 1]?.content || "").slice(0, 100),
          note: "stall_detected: talked_without_action"
        });
      } catch (_) {}
      const _retryCount = (() => {
        try {
          return _stallParams.maxRetries - 1;
        } catch {
          return 0;
        }
      })();
      const fixMsg = {
        role: "user",
        content: (() => {
          try {
            return getCorrectionMessage(currentModel, _retryCount);
          } catch {
            return "\u3010\u77EF\u6B63\u3011\u4F60\u525B\u525B\u63CF\u8FF0\u4E86\u8981\u505A\u4EC0\u9EBC\uFF0C\u4F46\u6C92\u6709\u8F38\u51FA\u4EFB\u4F55\u547D\u4EE4\u3002\u8ACB\u76F4\u63A5\u8F38\u51FA ```bash \u547D\u4EE4 ``` \u5340\u584A\u3002\u4E0D\u8981\u89E3\u91CB\u3001\u4E0D\u8981\u63CF\u8FF0\u3001\u4E0D\u8981\u8AAA\u4F60\u6253\u7B97\u505A\u4EC0\u9EBC\u2014\u2014\u76F4\u63A5\u8F38\u51FA\u547D\u4EE4\u3002";
          }
        })()
      };
      msgs.push(fixMsg);
      const retryUp = {
        ...rest,
        model: currentModel,
        messages: msgs,
        stream: false,
        enable_thinking: isThinking
      };
      try {
        const retryResult = await requestUpstream("/v1/chat/completions", retryUp, { timeout: 120000, retries: 1, trace: "stall-fix" });
        const retryChoice = retryResult?.choices?.[0];
        if (retryChoice) {
          const retryMsg = retryChoice.message;
          const retryRaw = retryMsg?.content || "";
          const retryReasoning = retryMsg?.reasoning_content || "";
          const retryNative = retryMsg?.tool_calls;
          if (retryNative?.length > 0) {
            log11.info(`\uD83D\uDCEC \u77EF\u6B63\u6210\u529F\uFF1A\u539F\u751F tool_calls x${retryNative.length}`);
            return buildToolCallResponse(retryNative, retryMsg?.content, currentModel, promptText, retryReasoning);
          }
          const retryBash = bashBlockToToolCalls(retryRaw, tools);
          if (retryBash?.length > 0) {
            log11.info(`\uD83D\uDD27 \u77EF\u6B63\u6210\u529F\uFF1Abash-block x${retryBash.length}`);
            return buildToolCallResponse(retryBash, retryRaw, currentModel, promptText, retryReasoning);
          }
          const retryWrite = nonBashBlockToToolCalls(retryRaw, tools, raw);
          if (retryWrite?.length > 0) {
            log11.info(`\uD83D\uDCDD \u77EF\u6B63\u6210\u529F\uFF1A\u975E bash \u5340\u584A x${retryWrite.length}`);
            return buildToolCallResponse(retryWrite, retryRaw, currentModel, promptText, retryReasoning);
          }
          log11.warn(`\u26A0\uFE0F \u77EF\u6B63\u5F8C\u4ECD\u7136\u6C92\u6709\u5DE5\u5177\u547C\u53EB\uFF0C\u56DE\u50B3\u539F\u59CB\u6587\u5B57`);
          return buildTextResponse(retryRaw || raw, currentModel, promptText, retryReasoning || reasoning);
        }
      } catch (retryErr) {
        log11.warn(`\u26A0\uFE0F \u77EF\u6B63\u91CD\u8A66\u5931\u6557: ${retryErr.message}\uFF0C\u56DE\u50B3\u539F\u59CB\u7D50\u679C`);
      }
    }
    log11.debug(`\u2705 \u7D14\u6587\u5B57\u56DE\u61C9 ${raw.length}ch`);
    if (!raw?.trim())
      raw = "";
    return buildTextResponse(raw, currentModel, promptText, reasoning);
  } catch (e) {
    clearTimeout(_timer);
    clearTimeout(_progressTimer);
    clearInterval(_goneWatch);
    return buildErrorResponse(`runSinglePass: ${e?.message || e}`, "qwen");
  } finally {
    clearTimeout(_timer);
    clearTimeout(_progressTimer);
    clearInterval(_goneWatch);
  }
};
var totalTokens = 0;
var countTokens = (s) => Math.ceil((s || "").length / 4);
var trackUsage = (prompt, completion) => {
  const p = countTokens(prompt);
  const c = countTokens(completion);
  totalTokens += p + c;
  return { prompt_tokens: p, completion_tokens: c, total_tokens: p + c };
};
var buildTextResponse = (content, model, promptMsgs = "", reasoning = "") => {
  const msg = { role: "assistant" };
  msg.content = content ?? "";
  if (reasoning)
    msg.reasoning_content = reasoning;
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.round(Date.now() / 1000),
    model: model || "qwen",
    choices: [{ index: 0, message: msg, finish_reason: "stop" }],
    usage: trackUsage(promptMsgs, content || "")
  };
};
var buildToolCallResponse = (toolCalls, content, model, promptMsgs = "", reasoning = "") => {
  const argsStr = (toolCalls || []).map((tc) => tc.function?.arguments || "").join("");
  const msg = {
    role: "assistant",
    tool_calls: toolCalls
  };
  msg.content = content ?? "";
  if (reasoning)
    msg.reasoning_content = reasoning;
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.round(Date.now() / 1000),
    model: model || "qwen",
    choices: [{ index: 0, message: msg, finish_reason: "tool_calls" }],
    usage: trackUsage(promptMsgs, argsStr)
  };
};
var buildErrorResponse = (msg, model) => {
  log11.sysError(msg);
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.round(Date.now() / 1000),
    model: model || "qwen",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: ""
        },
        finish_reason: "stop"
      }
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  };
};
var streamResponse = (res, msgId, model, result) => {
  const choice = result.choices[0];
  const msg = choice.message;
  const toolCalls = msg?.tool_calls;
  const reasoningContent = msg?.reasoning_content;
  if (reasoningContent) {
    for (let i = 0;i < reasoningContent.length; i += CHUNK) {
      streamChunk(res, msgId, model, {
        choices: [
          {
            index: 0,
            delta: {
              content: "",
              reasoning_content: reasoningContent.slice(i, i + CHUNK)
            },
            finish_reason: null
          }
        ]
      });
    }
  }
  if (toolCalls?.length > 0) {
    streamChunk(res, msgId, model, {
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            ...msg.content != null ? { content: msg.content } : {}
          },
          finish_reason: null
        }
      ]
    });
    for (let i = 0;i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      streamChunk(res, msgId, model, {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: i,
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments
                  }
                }
              ]
            },
            finish_reason: null
          }
        ]
      });
    }
    streamChunk(res, msgId, model, {
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }]
    });
  } else {
    const content = msg?.content || "";
    for (let i = 0;i < content.length; i += CHUNK) {
      streamChunk(res, msgId, model, {
        choices: [
          {
            index: 0,
            delta: { content: content.slice(i, i + CHUNK) },
            finish_reason: null
          }
        ]
      });
    }
    streamChunk(res, msgId, model, {
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
    });
  }
  safeWrite(res, `data: [DONE]

`);
  safeEnd(res);
};
var proxyRequest = (req, res) => {
  const url = `${QWEN2API_URL}${req.url}`;
  const method = req.method;
  if (method === "GET") {
    getJSON(url).then((data) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    }).catch((err) => {
      res.writeHead(502);
      res.end(JSON.stringify({ error: "Upstream error" }));
    });
    return;
  }
  if (method === "POST") {
    let body = "";
    let rejected = false;
    req.on("data", (c) => {
      if (rejected)
        return;
      body += c;
      if (body.length > MAX_BODY) {
        rejected = true;
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: `Request body too large (max ${Math.round(MAX_BODY / 1024)}KB)`
        }));
        req.destroy();
      }
    });
    req.on("error", () => {
      rejected = true;
    });
    req.on("end", () => {
      if (rejected)
        return;
      try {
        const parsed = JSON.parse(body);
        postJSON(url, parsed).then((data) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
        }).catch((err) => {
          res.writeHead(502);
          res.end(JSON.stringify({ error: "Upstream error" }));
        });
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }
  res.writeHead(405);
  res.end("Method Not Allowed");
};
var handleRequest = async (req, res) => {
  markActivity();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = req.url;
  if (url !== "/health") {
    const ip = req.socket.remoteAddress || "unknown";
    if (!checkRL(ip)) {
      log11.warn(`\u26A0\uFE0F Rate limit \u89F8\u767C: ${ip}`);
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "Too Many Requests",
        retryAfter: Math.ceil(RL_WIN / 1000)
      }));
      return;
    }
  }
  if (url !== "/health" && !_inGrace() && !AUTH_DISABLED) {
    const auth = req.headers.authorization;
    const normalized = (auth || "").replace(/\s+/g, " ").trim();
    const expected = `Bearer ${API_KEY}`;
    if (!auth || normalized.toLowerCase() !== expected.toLowerCase()) {
      const clientIp = req.socket?.remoteAddress || req.headers["x-forwarded-for"] || "unknown";
      log11.warn(`\u26A0\uFE0F \u62D2\u7D55\u672A\u7D93\u6388\u6B0A\u7684\u8ACB\u6C42: ${req.method} ${url} (from: ${clientIp}, hasAuth: ${!!auth})`);
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized: Invalid API Key" }));
      return;
    }
  }
  if (url === "/health") {
    let upstreamStatus = "unknown";
    try {
      const h = await getJSON(`${QWEN2API_URL}/health`, 3000, 0);
      upstreamStatus = h?.status || h?.upstream || "ok";
    } catch (e) {
      if (_upstreamHealthy) {
        log11.warn(`\u26A0\uFE0F \u4E0A\u6E38\u96E2\u7DDA: ${e.message}`);
        _upstreamHealthy = false;
      }
      upstreamStatus = "unreachable";
    }
    if (upstreamStatus !== "unreachable" && !_upstreamHealthy) {
      log11.info(`\u2705 \u4E0A\u6E38\u5DF2\u6062\u5FA9`);
      _upstreamHealthy = true;
    }
    const hw = detectHardware();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      proxy: "running",
      upstream: upstreamStatus,
      port: PROXY_PORT,
      routing: getRouteInfo(),
      hardware: {
        level: hw.level,
        reason: hw.reason,
        env: hw.env,
        cpu: `${hw.cpu.cores}\u6838`,
        ram: `${hw.ram.freeGB}GB/${hw.ram.totalGB}GB`,
        gpu: hw.gpu.model,
        load: hw.load.perCore,
        platform: hw.platform
      }
    }));
    return;
  }
  if (url === "/mcp" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body);
        const name = parsed.params?.name;
        const args = parsed.params?.arguments || {};
        const result = await mcpCall(name, args);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result: { content: [{ text: result }] } }));
      } catch (e) {
        log11.error(`\u274C MCP \u57F7\u884C\u5931\u6557:`, e?.message || e);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
      }
    });
    return;
  }
  if (url === "/v1/chat/completions" && req.method === "POST") {
    let body = "";
    let rejected = false;
    req.on("data", (c) => {
      if (rejected)
        return;
      body += c;
      if (body.length > MAX_BODY) {
        rejected = true;
        log11.warn(`\u274C \u8ACB\u6C42 body \u904E\u5927 (${body.length} bytes)\uFF0C\u5DF2\u62D2\u7D55`);
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: `Request body too large (max ${Math.round(MAX_BODY / 1024)}KB)`
        }));
        req.destroy();
      }
    });
    req.on("error", (e) => {
      if (!rejected) {
        log11.error(`\u274C \u8ACB\u6C42\u4E32\u6D41\u932F\u8AA4:`, e?.message || e);
      }
    });
    req.on("end", async () => {
      if (rejected)
        return;
      try {
        const parsed = JSON.parse(body);
        const msgId = `chatcmpl-${Date.now()}`;
        const model = parsed.model || "qwen";
        log11.info(`\uD83D\uDCE8 \u8ACB\u6C42 model=${parsed.model} tools=${parsed.tools?.length || 0} stream=${parsed.stream}`);
        if (parsed.stream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive"
          });
          _activeSSE.add(res);
          const keepalive = setInterval(() => {
            safeWrite(res, `: heartbeat

`);
          }, 15000);
          let _clientGone2 = false;
          const cleanupSSE = () => {
            _clientGone2 = true;
            clearInterval(keepalive);
            _activeSSE.delete(res);
          };
          res.on("close", cleanupSSE);
          res.on("error", cleanupSSE);
          const noTools = !parsed.tools || parsed.tools.length === 0;
          if (noTools) {
            clearInterval(keepalive);
            log11.info(`\uD83D\uDCE1 \u4E32\u6D41\u76F4\u901A model=${parsed.model}`);
            try {
              const up = {
                ...parsed,
                model: routeModel(parsed),
                stream: true
              };
              const upRes = await requestUpstreamStream("/v1/chat/completions", up, { timeout: 120000, trace: "passthrough" });
              if (!upRes.ok || !upRes.body) {
                log11.warn(`\u2B06\uFE0F \u4E0A\u6E38\u932F\u8AA4 (HTTP ${upRes?.status})\uFF0C\u5DF2\u5207\u65B7\u4E32\u6D41`);
                safeWrite(res, `data: [DONE]

`);
                safeEnd(res);
                return;
              }
              const reader = upRes.body.getReader();
              const decoder = new TextDecoder;
              try {
                while (true) {
                  if (_clientGone2) {
                    reader.cancel();
                    return;
                  }
                  const { done, value } = await reader.read();
                  if (done)
                    break;
                  safeWrite(res, decoder.decode(value, { stream: true }));
                }
              } catch (e) {
                if (!_clientGone2)
                  log11.warn(`\u4E32\u6D41\u76F4\u901A\u4E2D\u65B7: ${e.message}`);
              }
              if (!_clientGone2) {
                safeWrite(res, `data: [DONE]

`);
                safeEnd(res);
              }
            } catch (e) {
              log11.error(`\u274C \u4E32\u6D41\u76F4\u901A\u5931\u6557:`, e?.message || e);
              if (!_clientGone2) {
                safeWrite(res, `data: [DONE]

`);
                safeEnd(res);
              }
            }
            return;
          }
          let _progressCount = 0;
          const progressTimer = setInterval(() => {
            _progressCount++;
            safeWrite(res, `data: ${JSON.stringify({
              id: `chatcmpl-${Date.now()}`,
              object: "chat.completion.chunk",
              created: Math.round(Date.now() / 1000),
              model: parsed.model || "qwen",
              choices: [
                {
                  index: 0,
                  delta: { content: "" },
                  finish_reason: null
                }
              ]
            })}

`);
          }, 8000);
          try {
            const result2 = await runSinglePass(parsed, () => _clientGone2);
            clearInterval(progressTimer);
            clearInterval(keepalive);
            if (_clientGone2) {
              safeEnd(res);
              return;
            }
            try {
              const lastP = parsed?.messages?.[parsed.messages.length - 1]?.content || "";
              const respC = result2?.choices?.[0]?.message?.content || "";
              recordInteraction(lastP, respC, "accepted", {
                modelUsed: model,
                taskType: (parsed?.tools?.length || 0) > 0 ? "coding" : "chat",
                latencyMs: 0,
                isCognitive: false
              });
            } catch (_) {}
            const c2 = result2?.choices?.[0];
            const hasCalls2 = c2?.message?.tool_calls?.length > 0;
            log11.info(`\u2705 \u4E32\u6D41\u56DE\u61C9 ${hasCalls2 ? `tool_calls x${c2.message.tool_calls.length}` : `content=${(c2?.message?.content || "").length}ch`}`);
            streamResponse(res, msgId, model, result2);
          } catch (e) {
            clearInterval(progressTimer);
            clearInterval(keepalive);
            if (_clientGone2) {
              safeEnd(res);
              return;
            }
            log11.error(`\u274C \u4E32\u6D41\u8655\u7406\u5931\u6557:`, e?.message || e);
            safeWrite(res, `data: [DONE]

`);
            safeEnd(res);
          }
          return;
        }
        let _clientGone = false;
        res.on("close", () => {
          _clientGone = true;
        });
        const result = await runSinglePass(parsed, () => _clientGone);
        if (_clientGone) {
          log11.warn(`\u23F9\uFE0F \u975E\u4E32\u6D41: client \u5DF2\u65B7\u7DDA\uFF0C\u8DF3\u904E\u56DE\u5BEB`);
          safeEnd(res);
          return;
        }
        try {
          const lastP = parsed?.messages?.[parsed.messages.length - 1]?.content || "";
          const respC = result?.choices?.[0]?.message?.content || "";
          recordInteraction(lastP, respC, "accepted", {
            modelUsed: model,
            taskType: (parsed?.tools?.length || 0) > 0 ? "coding" : "chat",
            latencyMs: 0,
            isCognitive: false
          });
        } catch (_) {}
        const c = result?.choices?.[0];
        const hasCalls = c?.message?.tool_calls?.length > 0;
        log11.info(`\u2705 \u56DE\u61C9 ${hasCalls ? `tool_calls x${c.message.tool_calls.length}` : `content=${(c?.message?.content || "").length}ch`}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (e) {
        log11.error(`\u274C \u8ACB\u6C42\u5931\u6557:`, e?.message || e);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: Math.round(Date.now() / 1000),
          model: "qwen",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "" },
              finish_reason: "stop"
            }
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        }));
      }
    });
    return;
  }
  proxyRequest(req, res);
};
var getActiveSSECount = () => _activeSSE.size;
var drain = (timeoutMs = 5000) => {
  if (_activeSSE.size === 0)
    return Promise.resolve();
  log11.info(`\u23F3 \u7B49\u5F85 ${_activeSSE.size} \u500B\u6D3B\u8E8D SSE \u4E32\u6D41\u5B8C\u6210...`);
  return new Promise((resolve2) => {
    const timer2 = setTimeout(() => {
      log11.warn(`\u23F0 ${_activeSSE.size} \u500B SSE \u4E32\u6D41\u672A\u5B8C\u6210\uFF0C\u5F37\u5236\u95DC\u9589`);
      for (const s of _activeSSE) {
        try {
          s.end();
        } catch {}
      }
      _activeSSE.clear();
      resolve2();
    }, timeoutMs);
    const check = setInterval(() => {
      if (_activeSSE.size === 0) {
        clearTimeout(timer2);
        clearInterval(check);
        resolve2();
      }
    }, 200);
  });
};
var drainAndClose = (server, timeoutMs = 5000) => {
  return drain(timeoutMs).then(() => {
    server.closeAllConnections?.();
    return new Promise((resolve2) => server.close(resolve2));
  });
};
var startProxy = () => {
  const server = http.createServer(handleRequest);
  detectEnv();
  try {
    const providerNames = (() => {
      try {
        const raw = process.env.PROVIDER_NAMES;
        if (raw)
          return JSON.parse(raw);
      } catch {}
      return ["qwen2api"];
    })();
    _router = createRouter({
      PROVIDER_NAMES: providerNames,
      QWEN2API_HOST,
      QWEN2API_PORT,
      API_KEY
    });
    log11.info(`\uD83D\uDD0C Provider Router: ${providerNames.length} providers (failover \u5C31\u7DD2)`);
  } catch (e) {
    log11.warn(`\uD83D\uDD0C Provider Router \u521D\u59CB\u5316\u7565\u904E: ${e.message}`);
  }
  try {
    const cfg = getConfig();
    if (cfg)
      updateConfig({ learningConsent: true });
    getLearningMetrics();
    log11.info("\uD83D\uDCDA \u81EA\u6211\u5B78\u7FD2\u7CFB\u7D71\u5DF2\u521D\u59CB\u5316");
  } catch (e) {
    log11.warn(`\uD83D\uDCDA \u81EA\u6211\u5B78\u7FD2\u521D\u59CB\u5316\u7565\u904E: ${e.message}`);
  }
  try {
    init({
      selfLearning: exports_self_learning,
      complexKeywords: COMPLEX_KEYWORDS,
      cognitiveKeywords: COGNITIVE_KEYWORDS
    });
  } catch (e) {
    log11.warn(`\uD83E\uDDEC \u9032\u5316\u5F15\u64CE\u521D\u59CB\u5316\u7565\u904E: ${e.message}`);
  }
  return new Promise((resolve2, reject) => {
    server.on("error", (e) => {
      if (e.code === "EADDRINUSE") {
        log11.error(`\u274C Port ${PROXY_PORT} \u5DF2\u88AB\u4F54\u7528\uFF0C\u7121\u6CD5\u555F\u52D5 Proxy`);
      } else {
        log11.error(`\u274C Proxy \u555F\u52D5\u5931\u6557: ${e.message}`);
      }
      reject(e);
    });
    server.listen(PROXY_PORT, "127.0.0.1", () => {
      log11.info(`\uD83E\uDD16 Chat Proxy running on http://127.0.0.1:${PROXY_PORT}`);
      if (process.env.PROXY_ROUTE !== "off") {
        log11.info("\uD83E\uDDE0 \u6A21\u578B\u8DEF\u7531: \u555F\u7528\uFF08\u81EA\u52D5\u4F9D\u4EFB\u52D9\u8907\u96DC\u5EA6\u5207\u63DB\uFF09");
      }
      _alive.lastBeat = Date.now();
      const _ka = setInterval(() => {
        _alive.lastBeat = Date.now();
      }, 60000);
      server.on("close", () => clearInterval(_ka));
      resolve2(server);
    });
  });
};
var getRouteInfo = () => ({
  enabled: process.env.PROXY_ROUTE !== "off",
  levels: {
    small: getModelForLevel("small"),
    medium: getModelForLevel("medium"),
    large: getModelForLevel("large")
  },
  detected: envModels ? {
    small: envModels.small.length,
    medium: envModels.medium.length,
    large: envModels.large.length
  } : null,
  evolution: {
    enabled: isRunning(),
    mode: "event-driven",
    pendingCount: getTriggerState().count,
    threshold: getTriggerState().threshold,
    suggestions: getSuggestions()
  }
});
export {
  startProxy,
  getRouteInfo,
  getActiveSSECount,
  drainAndClose,
  drain,
  PROXY_PORT
};
