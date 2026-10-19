#!/bin/bash
# 飞书 → Hexo 同步入口,供 launchd 定时任务调用。
set -euo pipefail

REPO="/Users/Admin/code/hexo-repository"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME="${HOME:-/Users/Admin}"

cd "$REPO"
exec /opt/homebrew/bin/node scripts/feishu-sync/sync.mjs "$@"
