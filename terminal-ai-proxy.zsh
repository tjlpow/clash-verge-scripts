# Terminal / Cursor 交互终端的规则代理入口。
# 国内模型由 Clash 的 terminal-ai 子规则直连，其余请求使用「国外AI」。
# Clash 停止时保留代理变量，让遵循这些变量的命令连接失败，不自动改为直连。
# 已打开的终端可手动 source 本文件；不遵循代理变量的程序仍依赖 TUN。
[[ -o interactive ]] || return 0

_terminal_ai_configure_proxy() {
  local terminal_ai_target=0
  local terminal_ai_pid=$PPID
  local terminal_ai_command terminal_ai_parent
  local terminal_ai_depth=0

  if [[ ${TERM_PROGRAM:-} == Apple_Terminal || ${__CFBundleIdentifier:-} == com.todesktop.230313mzl4w4u92 ]]; then
    terminal_ai_target=1
  else
    # Cursor 与 VS Code 的 TERM_PROGRAM 都可能为 vscode，按父进程路径区分。
    while (( terminal_ai_pid > 1 && terminal_ai_depth < 16 )); do
      terminal_ai_command=$(/bin/ps -p "$terminal_ai_pid" -o comm= 2>/dev/null) || break
      case "$terminal_ai_command" in
        */Cursor.app/Contents/*|*/Terminal.app/Contents/*)
          terminal_ai_target=1
          break
          ;;
      esac
      terminal_ai_parent=$(/bin/ps -p "$terminal_ai_pid" -o ppid= 2>/dev/null) || break
      terminal_ai_parent=${terminal_ai_parent//[[:space:]]/}
      [[ $terminal_ai_parent == <-> ]] || break
      terminal_ai_pid=$terminal_ai_parent
      (( terminal_ai_depth++ ))
    done
  fi
  (( terminal_ai_target )) || return 0

  export HTTP_PROXY=http://127.0.0.1:7898
  export HTTPS_PROXY=$HTTP_PROXY
  export ALL_PROXY=$HTTP_PROXY
  export http_proxy=$HTTP_PROXY
  export https_proxy=$HTTPS_PROXY
  export all_proxy=$ALL_PROXY
  # 仅回环地址绕过入口；国内模型也须先进入 Clash，由规则决定直连。
  export NO_PROXY=localhost,127.0.0.1,::1
  export no_proxy=$NO_PROXY
}

_terminal_ai_configure_proxy
unfunction _terminal_ai_configure_proxy
