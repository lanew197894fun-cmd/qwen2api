/**
 * hardware-detect.js — 硬體環境自動偵測與模型等級建議
 *
 * 跨平台支援 Linux / Windows / macOS。
 * 根據 CPU、RAM、GPU、系統負載自動評分，推薦合適的模型等級：
 *   small   — 輕量級硬體（<4GB RAM / 老舊 CPU）→ 27B 以下模型
 *   medium  — 中階硬體（4-8GB RAM / 4+ cores）→ Plus 等級
 *   large   — 高效能硬體（>8GB RAM / GPU 可用）→ Max/235B 等級
 */

import * as os from "node:os";
import { execSync } from "node:child_process";
import { detectGpuMac } from "./platform.js";

// ─── 快取（每 30 秒重新偵測） ───
let cache = null;
let cacheTime = 0;
const TTL = 30000;
const isWin = process.platform === "win32";

// ─── 環境類型 ───
const getEnvType = () => {
  // 檢查是否為筆電（有電池 = 筆電）
  let isLaptop = false;
  let onBattery = false;
  try {
    if (isWin) {
      const out = execSync(
        "wmic path Win32_Battery get BatteryStatus /format:csv 2>nul",
        { timeout: 3000, encoding: "utf8" },
      );
      const status = parseInt(
        out.trim().split("\n").filter(Boolean).pop()?.split(",").pop(),
      );
      if (!isNaN(status)) {
        isLaptop = true;
        onBattery = status === 1; // 1=discharging
      }
    } else {
      // Linux: 檢查 /sys/class/power_supply/BAT*
      const bats = execSync(
        "ls /sys/class/power_supply/BAT*/status 2>/dev/null",
        {
          timeout: 3000,
          encoding: "utf8",
        },
      )
        .trim()
        .split("\n")
        .filter(Boolean);
      if (bats.length > 0) {
        isLaptop = true;
        const st = execSync(
          "cat /sys/class/power_supply/BAT*/status 2>/dev/null",
          {
            timeout: 3000,
            encoding: "utf8",
          },
        ).trim();
        onBattery = st.toLowerCase().includes("discharging");
      }
      // macOS: pmset
      if (process.platform === "darwin") {
        const out = execSync("pmset -g batt 2>/dev/null", {
          timeout: 3000,
          encoding: "utf8",
        });
        isLaptop = out.includes("InternalBattery");
        onBattery = out.includes("discharging");
      }
    }
  } catch {}
  const type = isLaptop
    ? onBattery
      ? "筆電（電池模式）"
      : "筆電（電源模式）"
    : "桌機/伺服器";
  return { type, isLaptop, onBattery };
};

// ─── CPU ───
const getCpuInfo = () => {
  const cores = os.cpus().length;
  const model = os.cpus()[0]?.model || "unknown";
  const baseFreq = parseFloat(model.match(/(\d+\.?\d*)GHz/i)?.[1]) || 2.0;
  let s = 0;
  if (cores >= 8) s = 3;
  else if (cores >= 4) s = 2;
  else s = 1;
  if (baseFreq >= 3.0) s += 1;
  else if (baseFreq >= 2.0) s;
  else s -= 1;
  return { cores, model, baseFreq, score: Math.max(1, Math.min(5, s)) };
};

// ─── RAM ───
const getRamInfo = () => {
  const total = os.totalmem();
  const free = os.freemem();
  const totalGB = total / 1024 / 1024 / 1024;
  const freeGB = free / 1024 / 1024 / 1024;
  let s = 0;
  if (totalGB >= 16) s = 3;
  else if (totalGB >= 8) s = 2;
  else if (totalGB >= 4) s = 1;
  if (freeGB >= 4) s += 1;
  return {
    totalGB: +totalGB.toFixed(1),
    freeGB: +freeGB.toFixed(1),
    score: Math.max(0, Math.min(4, s)),
  };
};

// ─── GPU（跨平台） ───
const getGpuInfo = () => {
  let gpu = null;
  try {
    if (isWin) {
      const out = execSync(
        "wmic path win32_VideoController get name /format:csv 2>nul",
        { timeout: 3000, encoding: "utf8" },
      );
      for (const line of out.split("\n")) {
        if (
          line.includes("NVIDIA") ||
          line.includes("AMD") ||
          line.includes("Intel") ||
          line.includes("Microsoft")
        ) {
          gpu = line.replace(/^[^,]*,/, "").trim();
          if (gpu && !gpu.includes("Microsoft")) break;
        }
      }
    } else if (process.platform === "darwin") {
      // macOS: system_profiler
      const model = detectGpuMac();
      if (model) gpu = model;
    } else {
      // Linux: lspci
      const out = execSync("lspci 2>/dev/null | grep -iE 'vga|3d|display'", {
        timeout: 3000,
        encoding: "utf8",
      });
      for (const line of out.trim().split("\n").filter(Boolean)) {
        if (
          line.includes("NVIDIA") ||
          line.includes("AMD") ||
          line.includes("Intel")
        ) {
          gpu = line.replace(/^\S+\s+/, "").trim();
          break;
        }
      }
    }
  } catch {}
  let s = 0;
  if (gpu?.includes("NVIDIA")) {
    try {
      const nvidia = execSync(
        isWin
          ? "nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits"
          : "nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null",
        { timeout: 3000, encoding: "utf8" },
      );
      const mem = parseInt(nvidia.trim());
      if (mem >= 4096) s = 3;
      else if (mem >= 2048) s = 2;
      else s = 1;
    } catch {
      s = 1;
    }
  } else if (gpu?.includes("AMD")) {
    s = 2;
  } else if (gpu?.includes("Intel")) {
    s = 1;
  }
  return { model: gpu || "無獨立 GPU", score: s };
};

// ─── 系統負載（跨平台） ───
const getLoadInfo = () => {
  const cores = os.cpus().length;
  let load1 = 0;
  try {
    if (isWin) {
      // Windows: wmic 取得 CPU 使用率
      const out = execSync(
        "wmic path Win32_Processor get LoadPercentage /format:csv 2>nul",
        { timeout: 3000, encoding: "utf8" },
      );
      const pct = parseFloat(
        out.trim().split("\n").filter(Boolean).pop()?.split(",").pop(),
      );
      load1 = isNaN(pct) ? 0.5 : pct / 100;
    } else {
      const load = os.loadavg();
      load1 = load[0] / cores;
    }
  } catch {
    load1 = 0.5;
  }
  let s = 2;
  if (load1 < 0.3) s = 3;
  else if (load1 < 0.7) s = 2;
  else s = 1;
  return { perCore: +load1.toFixed(2), score: s };
};

// ─── 主偵測 ───
export const detectHardware = () => {
  const now = Date.now();
  if (cache && now - cacheTime < TTL) return cache;

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
    reason.push("硬體評分偏低");
  } else if (total >= 10) {
    level = "large";
    reason.push("硬體充足");
  } else reason.push("硬體中等");

  if (ram.freeGB < 2) {
    level = "small";
    reason.push("可用記憶體不足 2GB");
  }
  if (load.perCore > 0.8) {
    if (level !== "small") level = "medium";
    reason.push("系統負載偏高");
  }
  // 筆電電池模式 → 降級以省電
  if (env.onBattery && level !== "small") {
    level = level === "large" ? "medium" : "small";
    reason.push("筆電電池模式，節省電量");
  }

  cache = {
    ts: new Date().toISOString(),
    level,
    reason: reason.join("；"),
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
      total,
    },
    platform: process.platform,
  };
  cacheTime = now;
  return cache;
};

export const getHardwareLevel = () => detectHardware().level;

export const getHardwareInfo = () => {
  const h = detectHardware();
  return [
    `🖥 **硬體偵測** [${h.level}] (${h.platform})`,
    `  環境: ${h.env}`,
    `  CPU: ${h.cpu.model} (${h.cpu.cores}核)`,
    `  RAM: ${h.ram.totalGB}GB (可用 ${h.ram.freeGB}GB)`,
    `  GPU: ${h.gpu.model}`,
    `  負載: ${h.load.perCore}/core`,
    `  評分: ${h.scores.total}/12 (cpu=${h.scores.cpu} ram=${h.scores.ram} gpu=${h.scores.gpu} load=${h.scores.load})`,
    `  建議: ${h.reason}`,
  ].join("\n");
};
