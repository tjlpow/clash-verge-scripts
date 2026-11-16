# Clash Verge 与 Shadowrocket 分流配置

本仓库保存两套 Clash Verge 脚本、两套 Shadowrocket 配置，以及 macOS 安装和恢复工具。**新设备的文件位置、首次启用顺序和命令见 [安装部署.md](安装部署.md)。**

## 文件

| 文件 | 用途 |
| --- | --- |
| [clash-verge.js](clash-verge.js) | Clash Verge `current`：常用服务分组，Claude 可选链式出口 |
| [clash-verge-safe.js](clash-verge-safe.js) | Clash Verge `safe`：国内直连，其余固定走手选 ISP 链式出口 |
| [switch-clash-verge.js](switch-clash-verge.js) | 在两版之间切换，写入 Clash 登记的 `Script.js` |
| [templates/Merge.yaml](templates/Merge.yaml) | 无凭据模板；填好后仅保存到本机 `profiles/Merge.yaml` |
| [macos/](macos/) | 断网开关、终端代理入口、配置备份及恢复脚本 |
| [shadowrocket.conf](shadowrocket.conf) | Shadowrocket 常用服务分组版 |
| [shadowrocket-safe.conf](shadowrocket-safe.conf) | Shadowrocket 国内直连、其余走首页节点版 |

## Clash Verge

- **current**：国内 AI 直连；Claude 经 `🧠 Claude` 中转，可在 `🌐 Claude Exit` 选择 ISP 出口；其他服务按策略组和规则分流，未命中流量走 `🐟 Fallback`。`Exit Off` 表示仅使用 Claude 中转，`REJECT` 表示断流。
- **safe**：国内 AI、微信、B 站、国内域名及中国 IP 直连；其他流量走 `🪜 Jump` → `🌍 Overseas Exit`。两个组都手选，没有 DIRECT 或自动回退。出口和跳板任一不可用，海外流量断流。
- **切换**：在 Clash 的 `profiles` 目录运行 `node switch-clash-verge.js status`、`node switch-clash-verge.js current` 或 `node switch-clash-verge.js safe`。命令只改 `Script.js`；用户随后自行重启 Clash Verge 并检查策略组。切回 current 前须先解除 safe 版系统断网开关。
- **私有信息**：真实 `Merge.yaml` 含订阅链接与 ISP 账号密码，不提交仓库。`Script.js` 是生成的运行副本；`safe-*.yaml` 是本机规则缓存，也不提交。

Clash 的 Claude IPv4 辅助进程由 `clash-verge.js` 提供，首次安装或转发逻辑更新后运行 `node clash-verge.js --install-claude-ipv4`。Terminal 和 Cursor 交互终端可加载 [macos/terminal-ai-proxy.zsh](macos/terminal-ai-proxy.zsh)，让遵循代理变量的命令进入 Clash 完整规则；其他程序仍依赖 TUN。

safe 版系统断网开关由 [macos/clash-guard.sh](macos/clash-guard.sh) 安装。先备份配置、启用 safe 和 TUN，再运行无管理员权限的 `preflight`；通过后才安装。它在 Clash 或 TUN 消失时阻断普通用户的外网 TCP/UDP，保留回环和局域网；root 流量及其他协议不在该规则覆盖范围内。安装、解除和恢复步骤见[安装部署.md](安装部署.md#安全版断网开关与恢复)。

## Shadowrocket

- **常用版**：按站点、AI、iCloud 和兜底组分流；首页节点与配置中的策略组各自可选。
- **safe 版**：Claude 和海外名单优先走代理，国内名单直连，其余 `FINAL,PROXY`。`PROXY` 指首页选中的节点。它只定义规则，不包含节点、订阅或代理链。
- **同一出口**：若手机要使用与电脑注册 Claude 时相同的 ISP IP，应在 Shadowrocket 给 ISP Socks5 节点设置「代理通过」为中转节点，首页选 ISP 节点，并在手机核对最终出口 IP。配置文件本身无法保证两端 IP 相同。
- **边界**：两份 Shadowrocket 配置只在 App 连接时分流，不能在 App 关闭后提供 macOS 式系统断网保护。修改后提交配置文件，再由用户在手机重新导入并测试。

## 维护

- **Clash**：编辑对应源码，检查语法与分流；切换脚本验证后更新 `Script.js`。仅提交源码、模板和说明。提示用户重启 Clash 并实测；维护时不替用户切模式、节点或激活配置。
- **Shadowrocket**：编辑 iCloud 中的同名配置，核对后提交仓库；提示用户在手机重新导入。
- **发布前**：检查远程版本与本地文件哈希，确认提交中没有订阅、密码、控制 socket 或设备专用配置。

## 对话式流量检测

按 [traffic-monitor/README.md](traffic-monitor/README.md) 的“预载”阶段开始，在对话中选择检测步骤。
