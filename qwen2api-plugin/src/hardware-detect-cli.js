#!/usr/bin/env bun
/**
 * hardware-detect-cli.js — 硬體環境偵測 CLI
 *
 * 跨平台支援 Linux / Windows / macOS。
 * 用法:
 *   bun hardware-detect-cli.js          # 完整報表
 *   bun hardware-detect-cli.js --level   # 只顯示推薦等級 (small/medium/large)
 *   bun hardware-detect-cli.js --json    # JSON 格式輸出
 */
import { detectHardware, getHardwareInfo } from "./hardware-detect.js";

const args = process.argv.slice(2);

if (args.includes("--level")) {
  const hw = detectHardware();
  console.log(hw.level);
  process.exit(0);
}

if (args.includes("--json")) {
  console.log(JSON.stringify(detectHardware(), null, 2));
  process.exit(0);
}

// 預設：完整報表
const hw = detectHardware();
console.log("");
console.log("═══════════════════════════════");
console.log("  硬體環境偵測報告");
console.log("═══════════════════════════════");
console.log(`  平台:     ${hw.platform}`);
console.log(`  環境:     ${hw.env}`);
console.log(
  `  等級:     ${hw.level === "small" ? "🟢 輕量 (small)" : hw.level === "medium" ? "🟡 中等 (medium)" : "🔴 高效 (large)"}`,
);
console.log(`  評分:     ${hw.scores.total}/12`);
console.log("");
console.log("── CPU ──");
console.log(`  型號:     ${hw.cpu.model}`);
console.log(`  核心:     ${hw.cpu.cores}核`);
console.log("");
console.log("── 記憶體 ──");
console.log(`  總計:     ${hw.ram.totalGB}GB`);
console.log(`  可用:     ${hw.ram.freeGB}GB`);
console.log("");
console.log("── GPU ──");
console.log(`  型號:     ${hw.gpu.model}`);
console.log("");
console.log("── 系統負載 ──");
console.log(`  每核心:   ${hw.load.perCore}`);
console.log("");
console.log("── 建議 ──");
console.log(`  ${hw.reason}`);
console.log("═══════════════════════════════");
console.log("");
