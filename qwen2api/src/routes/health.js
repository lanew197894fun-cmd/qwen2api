const express = require("express");
const router = express.Router();
const config = require("../config/index.js");
const { logger } = require("../utils/logger");
const fs = require("fs");
const path = require("path");

// 健康檢查端點
router.get("/health", async (req, res) => {
  const healthStatus = {
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "qwen2api",
    version: require("../../package.json").version,
    checks: {},
  };

  // 檢查服務基本狀態
  try {
    healthStatus.checks.service = {
      status: "ok",
      message: "Service is running",
    };
  } catch (error) {
    healthStatus.status = "error";
    healthStatus.checks.service = {
      status: "error",
      message: error.message,
    };
    logger.error("Health check service failed", "HEALTH", {}, error);
  }

  // 設定整體狀態 - 為了與 plugin 相容，使用 "healthy" 而不是 "ok"
  // 但保留原始 status 供其他用途
  const overallStatus =
    healthStatus.status === "error"
      ? "error"
      : healthStatus.status === "warning"
        ? "warning"
        : "healthy";

  // 覆寫 status 欄位以符合 plugin 期望
  healthStatus.status = overallStatus;

  // 檢查檔案系統訪問 (如果使用 file 模式)
  if (config.dataSaveMode === "file") {
    try {
      const dataFilePath = path.join(__dirname, "../../data/data.json");
      await fs.promises.access(
        dataFilePath,
        fs.constants.R_OK | fs.constants.W_OK,
      );
      healthStatus.checks.filesystem = {
        status: "ok",
        message: "File system accessible",
        path: dataFilePath,
      };
    } catch (error) {
      healthStatus.status = error.code === "ENOENT" ? "warning" : "error";
      healthStatus.checks.filesystem = {
        status: error.code === "ENOENT" ? "warning" : "error",
        message:
          error.code === "ENOENT"
            ? "Data file not found"
            : "File system access failed",
        error: error.message,
      };
      if (error.code !== "ENOENT") {
        logger.error("Health check filesystem failed", "HEALTH", {}, error);
      }
    }
  }

  // 檢查 Redis 連線 (如果配置了 Redis)
  if (config.redisURL && config.dataSaveMode === "redis") {
    try {
      // 這裡應該實際檢查 Redis 連線
      // 為了簡化，我們假設如果配置了 Redis URL 則嘗試連線
      // 實際實現應該使用 redis 客戶端進行 ping 檢查
      healthStatus.checks.redis = {
        status: "warning",
        message: "Redis health check not implemented yet",
        note: "Redis configuration detected but health check not implemented",
      };
    } catch (error) {
      healthStatus.status = "error";
      healthStatus.checks.redis = {
        status: "error",
        message: "Redis connection failed",
        error: error.message,
      };
      logger.error("Health check Redis failed", "HEALTH", {}, error);
    }
  }

  // 檢查環境變數
  try {
    const requiredEnvVars = [];
    if (!config.apiKeys || config.apiKeys.length === 0) {
      requiredEnvVars.push("API_KEY");
    }

    if (requiredEnvVars.length > 0) {
      healthStatus.status = "warning";
      healthStatus.checks.environment = {
        status: "warning",
        message: `Missing environment variables: ${requiredEnvVars.join(", ")}`,
        missing: requiredEnvVars,
      };
      logger.warn("Health check environment variables missing", "HEALTH", {
        missing: requiredEnvVars,
      });
    } else {
      healthStatus.checks.environment = {
        status: "ok",
        message: "All required environment variables set",
      };
    }
  } catch (error) {
    logger.error("Health check environment failed", "HEALTH", {}, error);
  }

  // 設定適當的 HTTP 狀態碼
  let statusCode = 200;
  if (healthStatus.status === "error") {
    statusCode = 503;
  } else if (healthStatus.status === "warning") {
    statusCode = 200; // 仍然返回 200 但帶有警告狀態
  }

  res.status(statusCode).json(healthStatus);
});

// 簡易健康檢查 (僅回傳 200 OK)
router.get("/ping", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

module.exports = router;
