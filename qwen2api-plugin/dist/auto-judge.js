/**
 * auto-judge.js — 經驗自動判斷引擎
 *
 * 功能：
 * • 接收錯誤/修復/重複事件
 * • 智慧判斷是否值得記錄為 lesson / knowledge / wiki
 * • 自動寫入 lesson-learned + wiki，更新索引
 * • 純事件驅動，非常駐
 *
 * 使用方式：
 *   import { autoJudge } from "./auto-judge.js"
 *   await autoJudge({ type: "error", title: "...", detail: "..." })
 *
 * 判斷規則：
 *   error   → 根據嚴重度寫 P0~P3 lesson
 *   repeat  → 同錯誤 ≥2 次強制寫 lesson
 *   fix     → 修復成功寫 wiki + knowledge
 *   feedback→ 用戶糾正/偏好寫 lesson/knowledge
 */
import { readFile, writeFile, mkdir, readdir, appendFile, } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { makeLogger } from "./color.js";
// ─── 路徑 ───
import { OPENCODE_DIR, LESSON_DIR, WIKI_DIR } from "./config/paths.js";
const KNOWLEDGE_AUTOSAVE = join(OPENCODE_DIR, "skill", "knowledge-autosave", "scripts", "knowledge-autosave.mjs");
const LESSON_INDEX = join(LESSON_DIR, "index.md");
const WIKI_INDEX = join(WIKI_DIR, "wiki-index-full.json");
const alog = makeLogger("auto-judge", "warning");
// ─── 分類對應 ───
const CATEGORIES = {
    "01-技術主題": ["技術", "架構", "API", "原理", "pattern", "設計"],
    "02-專案管理": ["專案", "進度", "需求", "remaster", "天堂R"],
    "03-問題修復": ["修復", "bug", "error", "fix", "除錯", "問題"],
    "04-工具配置": ["安裝", "配置", "CLI", "設定", "tool"],
    "05-整合紀錄": ["整合", "deploy", "CI/CD", "部署", "sync"],
    "06-學習筆記": ["學習", "筆記", "tutorial", "心得"],
    "08-討論決策": ["決策", "討論", "選擇", "ADR"],
    "09-記憶系統": ["記憶", "偏好", "習慣", "preference"],
};
// ─── 嚴重度判斷關鍵字 ───
const SEVERITY_RULES = [
    {
        level: "P0",
        keywords: [
            "crash",
            "崩潰",
            "fatal",
            "記憶體洩漏",
            "oom",
            "out of memory",
            "資料遺失",
        ],
    },
    {
        level: "P1",
        keywords: [
            "error",
            "錯誤",
            "fail",
            "失敗",
            "reject",
            "拒絕",
            "編譯失敗",
            "無法啟動",
        ],
    },
    {
        level: "P2",
        keywords: [
            "timeout",
            "逾時",
            "slow",
            "慢",
            "hang",
            "卡住",
            "效能",
            "無限迴圈",
        ],
    },
    { level: "P3", keywords: ["warning", "警告", "不便", "體驗", "ui", "顯示"] },
];
// ─── 強制記錄關鍵字（用戶反饋） ───
const FORCE_LESSON_KEYWORDS = [
    "注意",
    "錯了",
    "不要",
    "改成",
    "切記",
    "必須",
    "記得",
];
const FORCE_KNOWLEDGE_KEYWORDS = ["記住", "記下來", "記錄", "儲存", "學會"];
// ─── 低置信度詞彙（跳過用） ───
const LOW_CONFIDENCE = [
    "可能",
    "也許",
    "應該",
    "猜測",
    "不確定",
    "聽說",
    "據說",
];
// ─── 錯誤頻率記憶（避免重複寫入） ───
const recentErrors = new Map(); // key → { count, firstSeen, lastSeen }
// ════════════════════════════════════════
//  核心判斷邏輯
// ════════════════════════════════════════
/**
 * 自動判斷入口
 * @param {Object} ctx
 * @param {"error"|"fix"|"repeat"|"feedback"} ctx.type
 * @param {string} ctx.title - 簡短標題
 * @param {string} ctx.detail - 詳細描述/錯誤訊息
 * @param {string} [ctx.fix] - 解決方案（type=fix 時必填）
 * @param {number} [ctx.count=1] - 發生次數
 * @param {string} [ctx.source] - 來源（request/event/tool）
 * @returns {Promise<{action: string, target: string|null}>}
 */
export async function autoJudge(ctx) {
    const { type, title, detail, fix, count = 1, source } = ctx;
    if (!title && !detail)
        return { action: "skip", target: null };
    const content = `${title || ""} ${detail || ""} ${fix || ""}`.toLowerCase();
    // 1️⃣ 低置信度過濾
    const lowCount = LOW_CONFIDENCE.filter((w) => content.includes(w)).length;
    if (lowCount >= 3) {
        alog.info(`⏭️ 跳過（低置信度詞彙 ${lowCount} 個）: ${title}`);
        return { action: "skip_low_confidence", target: null };
    }
    // 2️⃣ 去重檢查：是否已存在相同標題的 lesson
    const exists = await lessonExists(title);
    if (exists) {
        alog.info(`⏭️ 跳過（已存在相同 lesson）: ${title}`);
        return { action: "skip_duplicate", target: exists };
    }
    // 3️⃣ 錯誤頻率 + 強制觸發
    const errorKey = `${type}:${title}`;
    const prev = recentErrors.get(errorKey) || {
        count: 0,
        firstSeen: Date.now(),
        lastSeen: 0,
    };
    prev.count += count;
    prev.lastSeen = Date.now();
    recentErrors.set(errorKey, prev);
    // 限制記憶大小
    if (recentErrors.size > 100) {
        const oldest = [...recentErrors.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
        recentErrors.delete(oldest[0]);
    }
    // 4️⃣ 根據 type 走不同判斷路徑
    switch (type) {
        case "error":
            return handleError(ctx, content, prev);
        case "repeat":
            return handleRepeat(ctx, content, prev);
        case "fix":
            return handleFix(ctx, content);
        case "feedback":
            return handleFeedback(ctx, content);
        default:
            return { action: "skip_unknown_type", target: null };
    }
}
// ════════════════════════════════════════
//  各類型處理
// ════════════════════════════════════════
/** 錯誤 → 判斷嚴重度寫 lesson */
async function handleError(ctx, content, freq) {
    const { title, detail, source } = ctx;
    const severity = judgeSeverity(content);
    const isCritical = severity === "P0" || severity === "P1";
    // P0/P1 直接寫
    if (isCritical) {
        return writeLesson({
            level: severity,
            title: title || detail?.slice(0, 60) || "未知錯誤",
            context: detail || "",
            cause: "",
            fix: "",
            source: source || "auto-detect",
        });
    }
    // P2+ 且連續出現 ≥2 次才寫
    if (freq.count >= 2) {
        return writeLesson({
            level: severity,
            title: title || detail?.slice(0, 60) || "重複錯誤",
            context: detail || "",
            cause: "",
            fix: "",
            source: source || "auto-detect",
        });
    }
    // 低頻率非關鍵錯誤 → 跳過（等下次再出現才處理）
    alog.debug(`⏭️ 錯誤未達寫入閾值 (count=${freq.count}, severity=${severity}): ${title}`);
    return { action: "skip_low_severity", target: null };
}
/** 重複錯誤 → 強制寫 lesson */
async function handleRepeat(ctx, content, freq) {
    const { title, detail, source } = ctx;
    const severity = judgeSeverity(content);
    return writeLesson({
        level: severity,
        title: `[重複] ${title || detail?.slice(0, 50) || "未知錯誤"}`,
        context: `發生 ${freq.count} 次\n${detail || ""}`,
        cause: "",
        fix: "",
        source: source || "auto-detect",
    });
}
/** 修復成功 → 寫 lesson（P4） + 條件寫 wiki（去重） */
async function handleFix(ctx, content) {
    const { title, detail, fix, source } = ctx;
    if (!fix) {
        alog.debug(`⏭️ 跳過（無修復內容）: ${title}`);
        return { action: "skip_no_fix", target: null };
    }
    // 一律寫 lesson（P4 最佳實踐）
    const lessonResult = await writeLesson({
        level: "P4",
        title: title || "修復記錄",
        context: detail || "",
        cause: "",
        fix,
        source: source || "auto-detect",
    });
    // 寫 wiki 前先查重，避免重複條目
    const wikiDups = await searchWiki(title);
    if (wikiDups.length > 0) {
        alog.info(`⏭️ Wiki 已存在相關條目（最高分 ${wikiDups[0].score}），跳過 wiki 寫入`);
        return {
            action: "written",
            target: lessonResult.target,
        };
    }
    const wikiResult = await writeWiki({
        title: title || detail?.slice(0, 60) || "修復記錄",
        content: detail || "",
        fix,
        source: source || "auto-detect",
    });
    return {
        action: "written",
        target: [lessonResult.target, wikiResult.target].filter(Boolean).join(", "),
    };
}
/** 用戶反饋/糾正 → 判斷寫 lesson 或 knowledge */
async function handleFeedback(ctx, content) {
    const { title, detail, source } = ctx;
    const hasForceLesson = FORCE_LESSON_KEYWORDS.some((k) => content.includes(k));
    const hasForceKnowledge = FORCE_KNOWLEDGE_KEYWORDS.some((k) => content.includes(k));
    if (hasForceLesson) {
        return writeLesson({
            level: "P3",
            title: title || "用戶提醒",
            context: detail || "",
            cause: "",
            fix: "",
            source: source || "user-feedback",
        });
    }
    if (hasForceKnowledge) {
        return writeWiki({
            title: title || detail?.slice(0, 60) || "用戶偏好",
            content: detail || "",
            fix: "",
            source: source || "user-feedback",
        });
    }
    alog.debug(`⏭️ 跳過（無觸發關鍵字）: ${title}`);
    return { action: "skip_no_keyword", target: null };
}
// ════════════════════════════════════════
//  寫入工具
// ════════════════════════════════════════
/**
 * 搜尋 wiki 索引，檢查是否有相關條目（去重用）
 * @param {string} query - 標題/關鍵字
 * @returns {Promise<Array<{title:string, score:number}>>}
 */
async function searchWiki(query) {
    if (!query)
        return [];
    try {
        const raw = await readFile(WIKI_INDEX, "utf-8");
        const index = JSON.parse(raw);
        const terms = query.toLowerCase().split(/\s+/);
        const results = [];
        for (const entry of index.entries || []) {
            let score = 0;
            const text = `${entry.title} ${(entry.tags || []).join(" ")} ${entry.category || ""}`.toLowerCase();
            for (const t of terms) {
                if (t.length < 2)
                    continue; // 忽略單字元
                if (entry.title.toLowerCase().includes(t))
                    score += 5;
                if ((entry.tags || []).some((tag) => tag.toLowerCase().includes(t)))
                    score += 2;
                if (text.includes(t))
                    score += 1;
            }
            if (score > 0)
                results.push({
                    title: entry.title,
                    score,
                    path: (entry.wikiLinks || [])[0] || "",
                });
        }
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, 3);
    }
    catch {
        return [];
    }
}
/**
 * 寫入 lesson-learned
 */
async function writeLesson({ level, title, context, cause, fix, source }) {
    const date = new Date().toISOString().slice(0, 10);
    const slug = title
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 80);
    const fileName = `${slug}-${date}.md`;
    const levelMap = {
        P0: "P0-嚴重翻車",
        P1: "P1-功能錯誤",
        P2: "P2-功能錯誤",
        P3: "P3-體驗不佳",
        P4: "P4-最佳實踐",
    };
    const subDir = levelMap[level] || "P3-體驗不佳";
    const dir = join(LESSON_DIR, subDir);
    const filePath = join(dir, fileName);
    // 確保目錄存在
    await mkdir(dir, { recursive: true });
    // 判斷分類
    const category = classify(`${title} ${context} ${fix}`);
    const content = [
        `# [${level}] ${title}`,
        "",
        `> 等級：${level}`,
        `> 日期：${date}`,
        `> 分類：${category}`,
        `> 來源：${source || "auto-detect"}`,
        "",
        "---",
        "",
        "## 情境",
        "",
        context || "自動偵測",
        "",
        ...(cause ? ["## 錯誤做法", "", cause, ""] : []),
        ...(fix ? ["## 正確做法", "", fix, ""] : []),
        "",
        "---",
        "",
        "## 預防措施",
        "",
        "- 自動偵測記錄",
        "",
    ].join("\n");
    await writeFile(filePath, content, "utf-8");
    alog.info(`✅ Lesson 已寫入: ${filePath}`);
    await updateLessonIndex({
        level,
        title,
        date,
        fileName: `${subDir}/${fileName}`,
    });
    return { action: "written", target: filePath };
}
/**
 * 寫入 wiki（透過 knowledge-autosave 腳本）
 */
async function writeWiki({ title, content, fix, source }) {
    const date = new Date().toISOString().slice(0, 10);
    const category = classify(`${title} ${content} ${fix}`);
    // 確保 Wiki 目錄存在
    const catDir = join(WIKI_DIR, category);
    await mkdir(catDir, { recursive: true });
    const slug = title
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 80);
    const fullContent = [
        `# ${title}`,
        "",
        `> 分類：${category}`,
        `> 日期：${date}`,
        `> 來源：${source || "auto-detect"}`,
        "",
        "---",
        "",
        content || "",
        "",
        ...(fix ? ["", "## 解決方案", "", fix, ""] : []),
        "",
        "---",
        "",
        "## 元數據",
        "",
        `- 建立日期：${date}`,
        `- 來源：${source || "auto-detect"}`,
        "",
    ].join("\n");
    // 寫入 wiki 檔案
    const wikiFile = join(catDir, `${slug}.md`);
    await writeFile(wikiFile, fullContent, "utf-8");
    alog.info(`✅ Wiki 已寫入: ${wikiFile}`);
    // 嘗試透過 knowledge-autosave 同步（非同步，不阻塞）
    if (existsSync(KNOWLEDGE_AUTOSAVE)) {
        const kbPath = join(OPENCODE_DIR, "knowledge");
        try {
            execSync(`node "${KNOWLEDGE_AUTOSAVE}" --kb "${kbPath}" --title "${title}" --content "${fullContent}" --category "${category}" --source "${source || "auto-detect"}" --wiki`, { timeout: 10000, stdio: "pipe" });
            alog.debug(`✅ knowledge-autosave 同步完成`);
        }
        catch (e) {
            alog.warn(`⚠️ knowledge-autosave 同步失敗（非阻塞）: ${e.message}`);
        }
    }
    return { action: "written", target: wikiFile };
}
// ════════════════════════════════════════
//  輔助函數
// ════════════════════════════════════════
/** 判斷嚴重度等級 */
function judgeSeverity(content) {
    const lower = content.toLowerCase();
    for (const rule of SEVERITY_RULES) {
        if (rule.keywords.some((k) => lower.includes(k)))
            return rule.level;
    }
    return "P3";
}
/** 自動分類 */
function classify(content) {
    const lower = content.toLowerCase();
    let best = "03-問題修復";
    let bestScore = 0;
    for (const [cat, keywords] of Object.entries(CATEGORIES)) {
        const score = keywords.filter((k) => lower.includes(k)).length;
        if (score > bestScore) {
            bestScore = score;
            best = cat;
        }
    }
    return best;
}
/** 檢查 lesson 是否已存在 */
async function lessonExists(title) {
    if (!title)
        return null;
    const slug = title
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 80)
        .toLowerCase();
    try {
        const entries = await readdir(LESSON_DIR, { recursive: true });
        return entries.some((e) => e.toLowerCase().includes(slug)) ? slug : null;
    }
    catch {
        return null;
    }
}
/** 更新 lesson index.md */
async function updateLessonIndex({ level, title, date, fileName }) {
    try {
        const line = `| ${level} | ${title} | ${date} | [查看](${fileName}) |\n`;
        await appendFile(LESSON_INDEX, line, "utf-8");
    }
    catch { }
}
//# sourceMappingURL=auto-judge.js.map