#!/bin/zsh
set -eu

SCRIPT_DIRECTORY="${0:A:h}"
DASHBOARD_URL="http://127.0.0.1:5180"

cd "$SCRIPT_DIRECTORY"

if ! command -v corepack >/dev/null 2>&1; then
  echo "没有找到 Node.js/Corepack。请先安装项目要求的 Node.js，再重新双击此文件。"
  read -k 1 "?按任意键关闭…"
  exit 1
fi

if ! command -v tcb >/dev/null 2>&1; then
  echo "没有找到 CloudBase CLI。请先安装 CloudBase CLI，再重新双击此文件。"
  read -k 1 "?按任意键关闭…"
  exit 1
fi

if ! tcb env list -r ap-shanghai --json >/dev/null 2>&1; then
  echo "CloudBase 登录已失效，正在打开一次性授权流程…"
  tcb login
fi

if curl -fsS "$DASHBOARD_URL" >/dev/null 2>&1; then
  open "$DASHBOARD_URL"
  exit 0
fi

if [[ ! -x "node_modules/.bin/vite" ]]; then
  echo "首次启动正在准备管理后台依赖…"
  corepack pnpm install --frozen-lockfile
fi

(
  for attempt in {1..60}; do
    if curl -fsS "$DASHBOARD_URL" >/dev/null 2>&1; then
      open "$DASHBOARD_URL"
      exit 0
    fi
    sleep 0.5
  done
) &

echo "管理后台启动后会自动在浏览器打开。关闭此窗口即可停止本机服务。"
exec corepack pnpm telemetry:dev
