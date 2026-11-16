#!/bin/sh
# 此脚本由 backup-clash-verge.sh 复制到快照目录后使用。
set -u

if [ "$(/usr/bin/id -u)" -ne 0 ] || [ -z "${SUDO_USER:-}" ]; then
  echo '请从原 Clash Verge 用户的 Terminal 使用 sudo sh 运行' >&2
  exit 1
fi

owner="$SUDO_USER"
uid="$(/usr/bin/id -u "$owner")" || exit 1
profile_home="$(/usr/bin/dscl . -read "/Users/$owner" NFSHomeDirectory 2>/dev/null | /usr/bin/sed 's/^NFSHomeDirectory: //')"
[ -n "$profile_home" ] || { echo '无法读取用户目录' >&2; exit 1; }
snapshot="$(CDPATH= cd -- "$(/usr/bin/dirname "$0")" && /bin/pwd -P)"
backup="$snapshot/config"
config="$profile_home/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev"
guard_off='/Library/Application Support/clash-guard/off.sh'
app='/Applications/Clash Verge.app'
errors=0

if [ ! -f "$backup/profiles/Script.js" ]; then
  echo '配置快照缺失；当前配置未改动' >&2
  exit 1
fi

if [ -f "$guard_off" ]; then
  /bin/sh "$guard_off" || errors=$((errors + 1))
fi

# 先关闭运行中的客户端与核心，避免旧配置写回。
/usr/bin/pkill -TERM -f '^/Applications/Clash Verge.app/Contents/MacOS/clash-verge$' 2>/dev/null || :
/usr/bin/pkill -TERM -f '^/Library/Application Support/clash-verge-service/cores/verge-mihomo ' 2>/dev/null || :
/bin/sleep 2
/usr/bin/pkill -KILL -f '^/Applications/Clash Verge.app/Contents/MacOS/clash-verge$' 2>/dev/null || :
/usr/bin/pkill -KILL -f '^/Library/Application Support/clash-verge-service/cores/verge-mihomo ' 2>/dev/null || :

previous="${config}.before-restore.$(/bin/date +%Y%m%d-%H%M%S)"
if [ -d "$config" ]; then
  /bin/mv "$config" "$previous" || errors=$((errors + 1))
fi
if /usr/bin/ditto "$backup" "$config"; then
  /usr/sbin/chown -R "$owner":staff "$config" || errors=$((errors + 1))
else
  errors=$((errors + 1))
  echo '复制快照失败，尝试还原刚才移动的目录' >&2
  if [ -d "$previous" ]; then
    /bin/mv "$config" "${config}.failed-restore" 2>/dev/null || :
    /bin/mv "$previous" "$config" || errors=$((errors + 1))
  fi
fi

start_client() {
  /bin/launchctl asuser "$uid" /usr/bin/sudo -u "$owner" /usr/bin/open -a "$app"
}
wait_port() {
  count=0
  while [ "$count" -lt 30 ]; do
    if /usr/bin/nc -z -G 1 127.0.0.1 7897 >/dev/null 2>&1; then return 0; fi
    /bin/sleep 1
    count=$((count + 1))
  done
  return 1
}

start_client || errors=$((errors + 1))
if ! wait_port; then
  echo '代理端口尚未就绪，重试启动一次' >&2
  start_client || errors=$((errors + 1))
  wait_port || errors=$((errors + 1))
fi

if [ "$errors" -eq 0 ]; then
  echo '配置已恢复，Clash Verge 代理端口已就绪'
else
  echo "恢复已尽量执行完毕，但有 $errors 项失败；请检查上述信息" >&2
fi
exit "$errors"
