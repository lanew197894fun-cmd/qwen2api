// color.js — 統一色彩日誌系統 (零相依, 2026-07-03)
// 語義色彩：primary(藍), secondary(紫), accent(橙), success(綠),
//           warning(黃), error(紅), info(青), muted(灰)
// 使用方式:
//   import { makeLogger } from "./color.js";
//   const log = makeLogger("proxy", "primary");
const IS_WIN = process.platform === "win32";
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
const USE_COLOR = _supportsColor();
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const fg = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;
const PALETTE = {
    primary: [92, 156, 245],
    secondary: [157, 124, 216],
    accent: [250, 178, 131],
    success: [127, 216, 143],
    warning: [245, 167, 66],
    error: [224, 108, 117],
    info: [86, 182, 194],
    muted: [128, 128, 128],
};
const LEVEL_COLORS = {
    debug: PALETTE.muted,
    info: PALETTE.info,
    warn: PALETTE.warning,
    error: PALETTE.error,
};
const TAG_COLORS = {
    proxy: "primary",
    plugin: "primary",
    router: "info",
    auth: "success",
    "auth:oauth": "success",
    "auth:cookie": "success",
    learning: "success",
    evolution: "secondary",
    provider: "primary",
    "auto-judge": "warning",
    hardware: "accent",
    "resolve-deps": "muted",
};
const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const _levelNum = (() => {
    const raw = process.env.PROXY_LOG_LEVEL;
    if (raw && LOG_LEVELS[raw] !== undefined)
        return LOG_LEVELS[raw];
    if (process.env.PROXY_QUIET === "true" || process.env.PROXY_QUIET === "1")
        return 0;
    // 預設 warn 級別，log.warn/info/error 可見，log.debug 靜默
    // 如需除錯：PROXY_LOG_LEVEL=debug 或 PROXY_LOG_LEVEL=silent
    return LOG_LEVELS.warn;
})();
function _colorize(rgb, text) {
    if (!USE_COLOR || !text)
        return text || "";
    return fg(rgb[0], rgb[1], rgb[2]) + text + RESET;
}
function _tag(colorKey, name) {
    const key = TAG_COLORS[colorKey] || "primary";
    const col = PALETTE[key];
    const inner = USE_COLOR ? _colorize(col, name) : name;
    return "[" + inner + "]";
}
function _level(lvl) {
    const col = LEVEL_COLORS[lvl] || PALETTE.muted;
    const text = lvl.toUpperCase().padEnd(5);
    return USE_COLOR ? DIM + _colorize(col, text) : text;
}
export function makeLogger(tag, colorKey) {
    const tagStr = _tag(colorKey || tag, tag);
    const shouldLog = (lvl) => _levelNum >= (LOG_LEVELS[lvl] ?? 0);
    const emit = (lvl, method, args) => {
        if (!shouldLog(lvl))
            return;
        method(tagStr, _level(lvl), args.join(" "));
    };
    return {
        debug: (...a) => emit("debug", console.log, a),
        info: (...a) => emit("info", console.log, a),
        warn: (...a) => emit("warn", console.log, a),
        error: (...a) => emit("error", console.log, a),
        sysError: (...a) => {
            if (!shouldLog("error"))
                return;
            const sysTag = _tag("muted", "系統");
            const prefix = USE_COLOR
                ? BOLD + fg(224, 108, 117) + "[系統錯誤]" + RESET
                : "[系統錯誤]";
            const msg = [sysTag, _level("error"), prefix, a.join(" ")].join(" ") + "\n";
            process.stderr.write(msg);
        },
    };
}
//# sourceMappingURL=color.js.map