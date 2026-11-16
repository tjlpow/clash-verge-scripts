#!/bin/sh
# Clash Verge 安全版的 macOS PF 断网开关。
# 先运行「sh clash-guard.sh preflight」，再由用户运行「sudo sh clash-guard.sh install」。
# 关闭命令：sudo sh "/Library/Application Support/clash-guard/off.sh"

set -u

guard_dir='/Library/Application Support/clash-guard'
guard_script="$guard_dir/guard.sh"
plist='/Library/LaunchDaemons/local.clash-guard.plist'
anchor='com.apple/clash-guard'
core_pattern='^/Library/Application Support/clash-verge-service/cores/verge-mihomo '

# 安装时记录当前 macOS 用户。LaunchDaemon 以 root 运行时读取这份本机记录。
profile_user="${SUDO_USER:-$(/usr/bin/id -un)}"
if [ -z "${SUDO_USER:-}" ] && [ -r "$guard_dir/profile-user" ]; then
  profile_user="$(/bin/cat "$guard_dir/profile-user")"
fi
case "$profile_user" in
  ''|*[!a-zA-Z0-9._-]*) echo '无法识别 Clash Verge 用户' >&2; exit 1 ;;
esac
profile_uid="$(/usr/bin/id -u "$profile_user")" || exit 1
profile_home="$(/usr/bin/dscl . -read "/Users/$profile_user" NFSHomeDirectory 2>/dev/null | /usr/bin/sed 's/^NFSHomeDirectory: //')"
[ -n "$profile_home" ] || { echo '无法读取用户目录' >&2; exit 1; }
controller="/var/run/clash-verge-service/users/$profile_uid/verge-mihomo.sock"
app_dir="$profile_home/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev"
active="$app_dir/profiles/Script.js"

need_root() {
  if [ "$(/usr/bin/id -u)" -ne 0 ]; then
    echo '此操作需要 sudo sh；安装前可先运行 preflight' >&2
    exit 1
  fi
}

safe_running() {
  [ -r "$active" ] || return 1
  /usr/bin/head -n 1 "$active" | /usr/bin/grep -Fxq '// CLASH_VARIANT: safe' || return 1
  /usr/bin/pgrep -f "$core_pattern" >/dev/null 2>&1 || return 1
  /usr/bin/curl --silent --fail --max-time 2 --unix-socket "$controller" \
    http://localhost/configs | /usr/bin/ruby -rjson -e '
      c=JSON.parse(STDIN.read)
      exit(c["mode"] == "rule" && c["ipv6"] == false && c.dig("tun", "enable") == true ? 0 : 1)
    ' || return 1
  /usr/bin/curl --silent --fail --max-time 2 --unix-socket "$controller" \
    http://localhost/proxies | /usr/bin/grep -Fq '🌍 Overseas Exit'
}

config_sane() {
  /usr/bin/ruby -ryaml -e '
    dir=ARGV.fetch(0)
    verge=YAML.load_file("#{dir}/verge.yaml")
    profiles=YAML.load_file("#{dir}/profiles.yaml")
    config=YAML.load_file("#{dir}/clash-verge.yaml")
    current=profiles.fetch("current")
    dns=config.fetch("dns")
    groups=config.fetch("proxy-groups")
    exit_group=groups.find { |g| g["name"] == "🌍 Overseas Exit" }
    abort unless verge["enable_tun_mode"] == true && verge["enable_auto_launch"] == true
    abort unless verge.dig("profile_dns_settings", current, "enabled") == false
    abort unless config["mode"] == "rule" && config["ipv6"] == false && config.dig("tun", "enable") == true
    abort unless dns["ipv6"] == false && dns["enhanced-mode"] == "fake-ip"
    abort unless dns.fetch("nameserver").any? { |x| x.include?("#🌍 Overseas Exit") }
    abort unless exit_group && !exit_group.fetch("proxies", []).include?("DIRECT")
    abort unless config.fetch("rules").last(2) == ["MATCH,🌍 Overseas Exit", "MATCH,REJECT"]
  ' "$app_dir" >/dev/null 2>&1
}

tun_interface() {
  /sbin/ifconfig -a | /usr/bin/awk '
    /^[[:alnum:]_]+:/ { name=$1; sub(/:$/, "", name) }
    /inet 198\.18\.0\.1 / && name ~ /^utun[0-9]+$/ { print name; exit }
  '
}

lan_interfaces() {
  /sbin/ifconfig -a | /usr/bin/awk '
    /^[[:alnum:]_]+:/ { name=$1; sub(/:$/, "", name) }
    /inet [0-9]/ && name ~ /^(en|bridge)[0-9]+$/ { print name }
  ' | /usr/bin/sort -u
}

write_rules() {
  target="$1"
  tun="$(tun_interface)"
  {
    echo 'pass quick on lo0 all'
    for lan in $(lan_interfaces); do
      echo "pass out quick on $lan inet proto { tcp udp } from any to ($lan:network) user != 0"
    done
    if [ -n "$tun" ] && safe_running; then
      echo "pass out quick on $tun proto { tcp udp } from any to any user != 0"
    fi
    echo 'block drop out quick proto { tcp udp } from any to any user != 0'
  } > "$target"
}

pf_enabled() {
  /sbin/pfctl -s info 2>/dev/null | /usr/bin/grep -q 'Status: Enabled'
}

ensure_pf() {
  if pf_enabled; then return 0; fi
  result="$(/sbin/pfctl -E 2>&1)" || { echo "$result" >&2; return 1; }
  token="$(/bin/echo "$result" | /usr/bin/sed -n 's/.*Token : \([0-9]*\).*/\1/p')"
  if [ -z "$token" ]; then
    echo 'PF 已启动，但未能读取启用令牌；请先执行 off.sh 并检查 PF 状态' >&2
    return 1
  fi
  /bin/echo "$token" >> "$guard_dir/pf-token"
  /bin/chmod 600 "$guard_dir/pf-token"
}

apply_once() {
  repair_main="${1:-false}"
  next="$guard_dir/rules.next"
  write_rules "$next" || return 1
  /sbin/pfctl -n -a "$anchor" -f "$next" >/dev/null 2>&1 || return 1
  if ! /sbin/pfctl -sr 2>/dev/null | /usr/bin/grep -Fq 'com.apple/*'; then
    if [ "$repair_main" != true ]; then
      echo '主规则集缺少 com.apple/*，安装程序拒绝覆盖系统 PF 规则' >&2
      return 1
    fi
    # 已安装后的监控进程才可补回 macOS 默认主规则集。
    /sbin/pfctl -n -f /etc/pf.conf >/dev/null 2>&1 || return 1
    /sbin/pfctl -f /etc/pf.conf >/dev/null 2>&1 || return 1
  fi
  ensure_pf || return 1
  if [ -f "$guard_dir/rules.pf" ] \
    && /usr/bin/cmp -s "$next" "$guard_dir/rules.pf" \
    && /sbin/pfctl -a "$anchor" -sr 2>/dev/null | /usr/bin/grep -Fq 'block drop out quick'; then
    /bin/rm -f "$next"
    return 0
  fi
  /sbin/pfctl -a "$anchor" -f "$next" >/dev/null 2>&1 || return 1
  /bin/mv -f "$next" "$guard_dir/rules.pf"
  /bin/chmod 600 "$guard_dir/rules.pf"
}

preflight() {
  tmp="$(/usr/bin/mktemp /private/tmp/clash-guard-rules.XXXXXX)" || exit 1
  trap '/bin/rm -f "$tmp"' EXIT HUP INT TERM
  write_rules "$tmp"
  /sbin/pfctl -n -a "$anchor" -f "$tmp" >/dev/null 2>&1 || {
    echo 'PF 规则语法检查失败' >&2; exit 1;
  }
  if [ -z "$(tun_interface)" ]; then echo '未检测到 Clash TUN 接口' >&2; exit 1; fi
  if ! safe_running; then echo '运行内核尚未加载安全版；现在不能安装断网开关' >&2; exit 1; fi
  if ! config_sane; then echo '安全版运行配置、DNS 覆写或开机自启未满足要求' >&2; exit 1; fi
  if [ -f "$plist" ]; then
    echo 'PF 语法、TUN、安全版运行配置及开机自启检查通过；断网开关已安装'
  else
    echo 'PF 语法、TUN、安全版运行配置及开机自启检查通过；断网开关尚未安装'
  fi
}

install_guard() {
  need_root
  if [ -z "${SUDO_USER:-}" ]; then
    echo '请从 Clash Verge 所在用户的 Terminal 使用 sudo 安装' >&2
    exit 1
  fi
  if [ -z "$(tun_interface)" ] || ! safe_running || ! config_sane; then
    echo '必须先启动符合检查要求的安全版和 TUN，再安装断网开关' >&2
    exit 1
  fi
  /bin/mkdir -p "$guard_dir" || exit 1
  /bin/chmod 700 "$guard_dir"
  /bin/echo "$profile_user" > "$guard_dir/profile-user"
  /bin/chmod 600 "$guard_dir/profile-user"
  /usr/bin/install -m 700 "$0" "$guard_script" || exit 1
  /bin/ln -sf guard.sh "$guard_dir/off.sh" || exit 1
  apply_once || { echo 'PF 安装失败；请运行 off.sh 清理' >&2; exit 1; }
  /bin/cat > "$plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>local.clash-guard</string>
  <key>ProgramArguments</key><array>
    <string>/bin/sh</string>
    <string>/Library/Application Support/clash-guard/guard.sh</string>
    <string>watch</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Library/Application Support/clash-guard/watch.log</string>
  <key>StandardErrorPath</key><string>/Library/Application Support/clash-guard/watch.err</string>
</dict></plist>
PLIST
  /usr/sbin/chown root:wheel "$plist"
  /bin/chmod 644 "$plist"
  /usr/bin/plutil -lint "$plist" >/dev/null || exit 1
  /bin/launchctl bootout system "$plist" >/dev/null 2>&1 || :
  /bin/launchctl bootstrap system "$plist" || exit 1
  echo '断网开关已安装；可用 sudo sh "/Library/Application Support/clash-guard/off.sh" 解除'
}

watch_guard() {
  need_root
  trap 'exit 0' TERM INT
  while :; do
    apply_once true || echo 'PF 规则补回失败，下一轮重试' >&2
    /bin/sleep 2
  done
}

off_guard() {
  need_root
  /bin/launchctl bootout system "$plist" >/dev/null 2>&1 || :
  /bin/rm -f "$plist"
  /sbin/pfctl -a "$anchor" -F rules >/dev/null 2>&1 || :
  if [ -f "$guard_dir/pf-token" ]; then
    while IFS= read -r token; do
      [ -n "$token" ] && /sbin/pfctl -X "$token" >/dev/null 2>&1 || :
    done < "$guard_dir/pf-token"
    /bin/rm -f "$guard_dir/pf-token"
  fi
  echo 'Clash 断网开关已解除；其他 PF 规则保持原状'
}

status_guard() {
  need_root
  if [ -f "$plist" ]; then echo 'LaunchDaemon: 已安装'; else echo 'LaunchDaemon: 未安装'; fi
  if pf_enabled; then echo 'PF: 已启用'; else echo 'PF: 未启用'; fi
  /sbin/pfctl -a "$anchor" -sr 2>/dev/null || :
}

case "${0##*/}:${1:-}" in
  off.sh:*|*:off) off_guard ;;
  *:preflight) preflight ;;
  *:install) install_guard ;;
  *:watch) watch_guard ;;
  *:status) status_guard ;;
  *) echo '用法：sh clash-guard.sh [preflight|install|watch|off|status]' >&2; exit 2 ;;
esac
