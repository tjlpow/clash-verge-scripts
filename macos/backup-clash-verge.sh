#!/bin/sh
# 在用户目录创建完整配置快照，并附带可离线运行的 restore.sh。
set -eu

if [ "$(/usr/bin/id -u)" -eq 0 ]; then
  echo '请以普通用户运行备份命令' >&2
  exit 1
fi

config="$HOME/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev"
restore="$(/usr/bin/dirname "$0")/restore-clash-verge.sh"
if [ ! -f "$config/profiles/Script.js" ] || [ ! -f "$restore" ]; then
  echo '找不到 Clash Verge 配置或恢复脚本' >&2
  exit 1
fi
if /usr/bin/pgrep -f '^/Applications/Clash Verge.app/Contents/MacOS/clash-verge$' >/dev/null 2>&1; then
  echo '请先完全退出 Clash Verge，再运行备份命令' >&2
  exit 1
fi

snapshot="$HOME/clash-guard-backup/$(/bin/date +%Y%m%d-%H%M%S)"
/bin/mkdir -m 700 -p "$snapshot"
/usr/bin/ditto "$config" "$snapshot/config"
/usr/bin/install -m 700 "$restore" "$snapshot/restore.sh"
echo "备份完成：$snapshot"
echo "恢复命令：sudo sh \"$snapshot/restore.sh\""
