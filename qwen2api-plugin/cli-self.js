#!/usr/bin/env bun
/**
 * cli-self.js — 自我學習系統 CLI（可直接在終端機執行）
 *
 * 用法：
 *   bun cli-self.js config                    # 檢視配置
 *   bun cli-self.js config --key level2At --value 5   # 修改配置
 *   bun cli-self.js status                    # 學習狀態
 *   bun cli-self.js analyze --msg "你的問題"   # 分析用戶程度
 *   bun cli-self.js learn --path ./src         # 分析程式碼風格
 *   bun cli-self.js export                     # 匯出模型
 *   bun cli-self.js import --file path.json     # 匯入模型
 *   bun cli-self.js reset                      # 重置資料
 *   bun cli-self.js recommend                  # 個人化推薦
 *   bun cli-self.js record --feedback accepted # 記錄反饋
 *   bun cli-self.js roles                      # 列出所有角色
 *   bun cli-self.js help                       # 顯示說明
 */

import {
  getConfig,
  updateConfig,
  getLearningMetrics,
  getPersonalRecommendation,
  getProLevel,
  getPersona,
  getPersonaList,
  getProLevelPrompt,
  analyzeUserLevel,
  getLearningSuggestions,
  summarizeMetrics,
  getPrivacyInfo,
  learnCodeStyle,
  learnResponseStyle,
  learnProblemSolving,
  recordInteraction,
  getInteractions,
  resetLearningData,
  exportModel,
  importModel,
  getTraits,
  setTrait,
} from "./src/self-learning.js";

const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const v = rest[i + 1];
    if (v && !v.startsWith("--")) {
      args[k] = v;
      i++;
    } else {
      args[k] = true;
    }
  }
}

const hr = () => console.log("─".repeat(50));

switch (cmd) {
  // ═══ 配置 ═══
  case "config": {
    if (args.key && args.value !== undefined) {
      if (args.key === "personality" && args.value === "?") {
        hr();
        console.log("🧑 可用角色：\n");
        for (const p of getPersonaList()) {
          console.log(`  ${p.label}`);
          console.log(`   ${p.desc}`);
          console.log(
            `   → bun cli-self.js config --key personality --value ${p.name}`,
          );
          console.log();
        }
        break;
      }
      let val = args.value;
      if (val === "true") val = true;
      else if (val === "false") val = false;
      else if (/^\d+$/.test(val)) val = parseInt(val, 10);
      else if (/^\d+\.\d+$/.test(val)) val = parseFloat(val);
      const r = updateConfig({ [args.key]: val });
      hr();
      if (r.changed.length) {
        console.log(`✅ 已更新: ${r.changed.join(", ")}`);
        if (args.key === "personality") {
          const info = getPersona(val);
          console.log(`\n📖 ${info.label}`);
          console.log(`   ${info.desc}`);
        }
      } else {
        console.log(`⚠️ 無效欄位: ${args.key}`);
      }
    } else {
      const cfg = getConfig();
      const priv = getPrivacyInfo();
      const pro = getProLevel();
      const persona = getPersona();
      hr();
      console.log("⚙️ 自我學習配置\n");
      console.log(
        `  學習功能:     ${cfg.learningConsent ? "🟢 開啟" : "🔴 關閉"}`,
      );
      console.log(`  Level 2 門檻: ${cfg.level2At} 次互動`);
      console.log(`  Level 3 門檻: ${cfg.level3At} 次互動`);
      console.log(`  資料保留:     ${cfg.dataRetention} 天`);
      console.log(`  語言偏好:     ${cfg.responseLang}`);
      console.log(`  回應詳細度:   ${cfg.responseVerbosity}/5`);
      console.log(`  專業水平:     ${pro.label} (${cfg.proLevel}/5)`);
      console.log(`  固定角色:     ${persona.label || "無"}`);
      console.log(`  自動偵測:     ${cfg.autoPersona ? "🟢 開啟" : "⚪ 關閉"}`);
      if (cfg.customPrompt)
        console.log(`  自定義提示:   ${cfg.customPrompt.slice(0, 60)}`);
      console.log(
        `  自動學程式碼: ${cfg.autoLearnCodeStyle ? "開啟" : "關閉"}`,
      );
      console.log(
        `  自動學回應:   ${cfg.autoLearnResponseStyle ? "開啟" : "關閉"}`,
      );
      console.log(`  自動記錄工具: ${cfg.autoRecordTools ? "開啟" : "關閉"}`);

      // 個性維度
      const traits = getTraits();
      console.log(`\n🧬 個性維度:`);
      for (const [k, v] of Object.entries(traits)) {
        const meta =
          {
            warmth: "🤗貼心",
            proactive: "⚡積極",
            depth: "📚深度",
            patience: "🧘耐心",
            humor: "😄幽默",
          }[k] || k;
        const bar = "█".repeat(v) + "░".repeat(5 - v);
        console.log(`  ${meta}: ${bar} (${v}/5)`);
      }
      console.log(`  修改: bun cli-self.js trait --key warmth --value 4`);

      console.log(`\n  資料大小:     ${priv.diskUsage}`);
      console.log(`  資料目錄:     ${priv.dataDir}`);
      console.log(`  雲端同步:     ${priv.allowCloudSync}`);
      hr();
      console.log("修改：bun cli-self.js config --key [欄位] --value [值]\n");
    }
    break;
  }

  // ═══ 狀態 ═══
  case "status": {
    hr();
    console.log(summarizeMetrics());
    hr();
    break;
  }

  // ═══ 分析用戶程度 ═══
  case "analyze": {
    const msg = args.msg || args.message;
    if (!msg) {
      console.log("⚠️ 請提供 --msg 參數，例如：");
      console.log('  bun cli-self.js analyze --msg "什麼是 API？"');
      break;
    }
    const r = analyzeUserLevel(msg);
    hr();
    console.log("🔍 用戶程度分析\n");
    console.log(`  輸入: ${msg.slice(0, 100)}`);
    console.log(`  推薦: ${r.label}`);
    if (r.reason) console.log(`  依據: ${r.reason}`);
    console.log();
    if (r.persona) {
      const info = getPersona(r.persona);
      console.log(`  ${info.label} 模式說明:`);
      console.log(`  ${info.desc}`);
      console.log(
        `\n  套用: bun cli-self.js config --key personality --value ${r.persona}`,
      );
    }
    hr();
    break;
  }

  // ═══ 學習程式碼風格 ═══
  case "learn": {
    const projectPath = args.path || args.dir || ".";
    console.log(`📊 分析程式碼風格: ${projectPath}`);
    const r = await learnCodeStyle(projectPath);
    if (r.error) {
      console.log(`❌ ${r.error}`);
      break;
    }
    hr();
    console.log("📊 程式碼風格分析結果\n");
    console.log(`  檔案: ${r.totalFiles} | 行數: ${r.totalLines}`);
    console.log(
      `  命名: camelCase ${r.naming.camelCase}% | snake_case ${r.naming.snake_case}% | PascalCase ${r.naming.PascalCase}%`,
    );
    console.log(
      `  縮排: 2空格 ${r.indent.spaces2}% | 4空格 ${r.indent.spaces4}% | Tab ${r.indent.tabs}%`,
    );
    console.log(
      `  錯誤處理: tryCatch ${r.errorHandling.tryCatch}次 | earlyReturn ${r.errorHandling.earlyReturn}次`,
    );
    console.log(
      `  註解: ${r.comments.total} 處 | ESM: ${r.imports.esm} | CJS: ${r.imports.cjs}`,
    );
    hr();
    break;
  }

  // ═══ 回應風格 ═══
  case "response": {
    const interactions = getInteractions();
    const r = learnResponseStyle(interactions);
    hr();
    console.log("💬 回應風格分析\n");
    const len = r.responseLength;
    const tot = len.short + len.medium + len.long || 1;
    console.log(
      `  短回應:   ${len.short} (${+((len.short / tot) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  中回應:   ${len.medium} (${+((len.medium / tot) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  長回應:   ${len.long} (${+((len.long / tot) * 100).toFixed(1)}%)`,
    );
    console.log(`  程式碼區塊: ${r.codeBlockUsage} 次`);
    console.log(`  解釋深度: ${r.explanationDepth}`);
    hr();
    break;
  }

  // ═══ 記錄反饋 ═══
  case "record": {
    const fb = args.feedback || "accepted";
    const m = recordInteraction(
      args.prompt || "(CLI)",
      args.response || "",
      fb,
    );
    console.log(`📝 反饋已記錄: ${fb}`);
    console.log(
      `  總互動: ${m.dataPoints} | 準確度: ${(m.accuracy * 100).toFixed(1)}%`,
    );
    break;
  }

  // ═══ 角色列表 ═══
  case "roles": {
    hr();
    console.log("🧑 可用角色：\n");
    for (const p of getPersonaList()) {
      console.log(`  ${p.label}`);
      console.log(`  ${p.desc}`);
      console.log();
    }
    console.log(
      "設定角色：bun cli-self.js config --key personality --value [名稱]",
    );
    console.log(
      "自定義：  bun cli-self.js config --key customPrompt --value [描述]",
    );
    hr();
    break;
  }

  // ═══ 推薦 ═══
  case "recommend": {
    const r = getPersonalRecommendation();
    hr();
    console.log("🎯 個人化推薦\n");
    console.log(`  信心指數: ${(r.confidence * 100).toFixed(1)}%`);
    console.log(`  命名風格: ${r.codeStyle.naming}`);
    console.log(
      `  縮排:     ${r.codeStyle.indent > 0 ? `${r.codeStyle.indent} 空格` : "Tab"}`,
    );
    console.log(`  策略:     ${r.strategy}`);
    if (r.tools.length) console.log(`  常用工具: ${r.tools.join(", ")}`);
    hr();
    break;
  }

  // ═══ 匯出/匯入 ═══
  case "export": {
    const r = exportModel(args.out || args.dir);
    console.log(`📦 模型已匯出: ${r.path}`);
    console.log(`  大小: ${(r.size / 1024).toFixed(1)} KB`);
    break;
  }

  case "import": {
    const fp = args.file || args.path;
    if (!fp) {
      console.log("⚠️ 請提供 --file 參數");
      break;
    }
    const r = importModel(fp);
    if (r.error) console.log(`❌ ${r.error}`);
    else console.log(`📥 已匯入: ${r.dataPoints} 數據點`);
    break;
  }

  // ═══ 提示預覽 ═══
  case "prompt": {
    const msg = args.msg || args.message || "";
    const p = getProLevelPrompt(
      args.level ? parseInt(args.level) : undefined,
      args.persona || undefined,
      msg,
    );
    hr();
    console.log("📋 System Prompt 預覽：\n");
    console.log(p);
    hr();
    break;
  }

  // ═══ 個性維度 ═══
  case "trait": {
    if (args.key && args.value !== undefined) {
      const r = setTrait(args.key, args.value);
      if (!r.ok) {
        console.log("❌ " + r.error);
        break;
      }
      const meta =
        {
          warmth: "🤗貼心",
          proactive: "⚡積極",
          depth: "📚深度",
          patience: "🧘耐心",
          humor: "😄幽默",
        }[r.trait] || r.trait;
      const bar = "█".repeat(r.val) + "░".repeat(5 - r.val);
      console.log(`✅ ${meta} 設為 ${r.val}/5`);
      console.log(`   ${bar}`);
    } else {
      console.log("🧬 個性維度\n");
      const traits = getTraits();
      for (const [k, v] of Object.entries(traits)) {
        const meta =
          {
            warmth: "🤗貼心",
            proactive: "⚡積極",
            depth: "📚深度",
            patience: "🧘耐心",
            humor: "😄幽默",
          }[k] || k;
        const desc =
          {
            warmth: "冷靜↔溫暖",
            proactive: "被動↔主動",
            depth: "淺顯↔深入",
            patience: "直接↔耐心",
            humor: "嚴肅↔幽默",
          }[k] || "";
        const bar = "█".repeat(v) + "░".repeat(5 - v);
        console.log(`  ${meta}: ${bar} (${v}/5)  ${desc}`);
      }
      console.log("\n設定範例: bun cli-self.js trait --key warmth --value 4");
      console.log("         bun cli-self.js trait --key depth --value 2");
    }
    break;
  }

  // ═══ 重置 ═══
  case "reset": {
    console.log("⚠️ 確定要重置所有學習資料？(y/N)");
    // 非互動模式直接重置
    resetLearningData();
    console.log("🔄 已清空所有學習資料");
    break;
  }

  // ═══ 幫助 ═══
  default: {
    hr();
    console.log("🧠 自我學習系統 CLI\n");
    console.log("用法：bun cli-self.js <命令> [參數]\n");
    console.log("命令：");
    console.log("  config                    檢視/修改配置");
    console.log("  status                    學習狀態摘要");
    console.log('  analyze --msg "問題"       分析用戶程度');
    console.log("  learn --path ./src         分析程式碼風格");
    console.log("  response                   分析回應偏好");
    console.log("  record --feedback accepted  記錄反饋");
    console.log("  roles                      列出所有角色");
    console.log("  trait                      檢視/設定個性維度");
    console.log("  recommend                  個人化推薦");
    console.log("  export                     匯出模型");
    console.log("  import --file path.json    匯入模型");
    console.log('  prompt --msg "問題"         預覽 system prompt');
    console.log("  reset                      重置資料\n");
    console.log("範例：");
    console.log(
      "  bun cli-self.js config --key personality --value programmer",
    );
    console.log("  bun cli-self.js config --key autoPersona --value true");
    console.log(
      '  bun cli-self.js config --key customPrompt --value "你是貓咪專家"',
    );
    console.log('  bun cli-self.js analyze --msg "什麼是變數？"');
    console.log("  bun cli-self.js learn --path /home/user/my-project");
    hr();
  }
}
