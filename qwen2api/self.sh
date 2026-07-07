#!/bin/bash
# self.sh — 自我學習系統 CLI 捷徑
# 用法: ./self.sh config | status | analyze --msg "..." | learn --path ... | roles
export PATH="$HOME/.bun/bin:$PATH"
cd "$(dirname "$0")/../qwen2api-plugin" && bun cli-self.js "$@"
