# 代理分流配置

| 文件 | 用途 |
| --- | --- |
| [clash-verge.js](clash-verge.js) | Clash Verge 的全局扩展脚本 |
| [Shadowrocket.conf](Shadowrocket.conf) | Shadowrocket 的分流配置 |

两版都用国内域名规则集和 `GEOIP,CN` 补齐直连，并为常用服务保留独立策略组。机场订阅链接是凭证，请保存在本机的 `Merge.yaml` 或 Shadowrocket App 中。

两版的主代理组统一为 `🚀 main`，兜底组为 `🐟 Fallback`，国外 AI 组为 `🤖 AI`，Claude 使用独立的 `Claude` 组。

## Clash Verge

1. **添加机场**　在全局扩展配置 `Merge.yaml` 中声明 `proxy-providers`。每个机场一项，使用不同的缓存路径。
2. **安装脚本**　把 [clash-verge.js](clash-verge.js) 的内容保存到 Clash Verge 的全局扩展脚本 `Script.js`。macOS 上的目录是 `~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles/`。
3. **加载配置**　首次安装时选用一份订阅或本地配置作为载体。以后修改磁盘上的 `Script.js`，由用户自行重启 Clash Verge，再验证分流。

`Merge.yaml` 示例：

```yaml
profile:
  store-selected: true

proxy-providers:
  机场A:
    type: http
    url: "https://example.com/subscription"
    path: ./providers/airport-a.yaml
    interval: 3600
    exclude-filter: "有效期|剩余|当前流量|到期时间|官网|订阅|群组|重置"
    health-check:
      enable: true
      url: http://www.gstatic.com/generate_204
      interval: 300
```

脚本会用所有 provider 的节点重建策略组。没有 provider 时，脚本复用当前订阅的节点和策略组。

Clash 版按进程匹配 Claude 和微信。Terminal、Cursor 及其交互终端使用与其他应用相同的完整规则：国内模型直连、Claude 请求走 Claude 组、其他 AI 命中 AI 组，其余继续匹配站点组、国内通用规则和 Fallback。交互终端通过本机辅助脚本接入 `127.0.0.1:7898`，该入口不绑定单一策略或专用子规则。辅助脚本仅在本机维护。

Clash 版的 Claude 请求另经本机 IPv4 转发层：实时查询目标的 A 记录，再按 IPv4 地址通过 `Claude` 组选定的节点连接。TLS 数据原样转发，不解密对话。已收录国内 AI 仍先直连。

**首次启用 IPv4 转发**：安装 Node.js 后，在本机 `profiles` 目录运行 `node Script.js --install-claude-ipv4`。macOS 会安装随登录启动的本机辅助进程；然后由用户自行重启 Clash Verge。更新转发逻辑后重新运行同一命令。其他系统需自行常驻运行 `node Script.js --claude-ipv4-relay`。

**本机端口**：`7899` 为 IPv4 转发层，`7900` 为 Clash 内绑定 Claude 组的专用上游，两者均只监听 `127.0.0.1`。解析仅经选定节点访问加密 DNS，按 TTL 缓存，最长 5 分钟；无 A 记录、辅助进程或节点不可用时断流，不退回直连或 IPv6。其他组的出口方式保持原样。本机回环代理连接跳过域名嗅探，避免已解析的 IPv4 被改回域名；TUN 的嗅探设置保留。

## Shadowrocket

1. **添加机场**　在 App 首页添加订阅。
2. **匹配订阅名**　把 [Shadowrocket.conf](Shadowrocket.conf) 的 `[Proxy Group]` 中的 `Immtele` 和 `Shadowsocks` 换成 App 首页的真实订阅名。手选组用订阅名和 `use=true` 展开单个节点。增减订阅时同步更新组成员。
3. **导入并测试**　把配置放到 iCloud Drive 的 Shadowrocket 文件夹。在手机上从文件导入并启用当天正式配置，核对「通用 → DNS 覆写」地址末尾为 `#proxy`。将全局路由设为「配置」，再测试常用服务和策略组。

Shadowrocket 内置 `PROXY` 表示首页当前节点。常规代理组初始选择 `PROXY`，先在首页选中已验证可用的节点，再按需在各组中改选 `🚀 main`、地区组或单个节点。bilibili 初始直连，`🐟 Fallback` 和 iCloud 可手选直连。

Shadowrocket 按域名和 IP 分流。远程规则集随配置更新，自动测速子组在支持 `hidden=1` 的版本中隐藏。

## 策略组选项

| 流量 | 策略 |
| --- | --- |
| 已收录的国内 AI | 固定直连，优先于国外 AI |
| Claude 自有域名、认证/CDN 别名和 Anthropic 地址范围 | 独立的 `Claude` 手选组 |
| 其他国外 AI | `🤖 AI` 组 |
| YouTube、X、Google、Telegram、iCloud | 各自的策略组，iCloud 可手选直连 |
| 哔哩哔哩 | bilibili 组，默认直连 |
| 国内服务 | 国内域名规则集或中国 IP 命中后直连 |
| 出口检测站点 | browserleaks.com、whoer.net 和 ipinfo.io 走 `🚀 main` 组 |
| 未匹配流量 | 独立的 `🐟 Fallback` 组，可选 `🚀 main`、自动测速、地区组、单个节点、REJECT 或 DIRECT |

两版均在常规国内规则集之前匹配专属服务。Clash 的海外 DNS 跟随 `🐟 Fallback` 组。Shadowrocket 的海外 DoH 使用 `#proxy`，经首页当前节点转发，使用配置模式前先在首页选中已验证可用的节点。Clash 使用 SukkaW 和 MetaCubeX CN，Shadowrocket 使用 SukkaW 和同源的 ChinaMax_Domain。Shadowrocket 的 iCloud 规则放在 Apple 规则之前，以便命中专属策略组。

Clash 的 AI 原始规则集继续自动更新：

- **过滤范围**　本机辅助进程每 5 秒同步源缓存，仅去掉 Cursor、Terminal 的 PROCESS 条目，保留域名、IP 和其他应用条目。
- **缓存更新**　派生规则集 `profiles/ai-global-services.yaml` 每 60 秒重新加载；更新异常时保留上次有效缓存。
- **首次安装**　源缓存缺失时，安装命令经本机 Clash `127.0.0.1:7897` 下载。需先运行可用代理，下载失败会停止安装。

## Claude 出口选择

- **首次选择**　两版的 `Claude` 组初始为 `REJECT`，使用前手选一个稳定的 TCP 节点。组内可选 `🚀 main`、单个节点和 REJECT。
- **匹配顺序**　广告、本地和 AI UDP 拦截 → 国内 AI 直连 → Claude 专属规则 → 其他国外 AI → 普通国内规则 → 兜底。国内模型优先直连，包括 Claude Code 中调用已收录的国内 API。
- **两版差异**　IPv4 转发仅在 Clash 版启用，覆盖命中 Claude 专属域名、IP 和进程规则的 TCP 请求；Shadowrocket 保留原分流，不附带本机辅助进程。IPv6 字面地址请求会拒绝，不转换为 IPv4。机场若另行重定向出口，仍须以目标网站的实际回显验证。
- **Clash 进程**　Claude App 和可识别的 `claude` 进程也走 Claude 组。Terminal、Cursor 中访问 Claude 专属域名走 Claude 组，其余请求使用完整主规则；本机终端入口与普通代理/TUN 保持一致。
- **共享服务**　Sentry、Intercom、Statsig、GitHub、npm 等共享域名保留原分流；Clash 能识别为 Claude 进程的请求由进程规则处理。Shadowrocket 按域名和 IP 匹配，无法据此保证所有共享服务都使用 Claude 出口。广告拦截保持优先。
- **跟随主组**　`Claude` 和 `🐟 Fallback` 选择 `🚀 main` 后，出口随主组的选择变化；需要固定出口时，直接选择单个节点。
- **出口边界**　手选只能固定节点选择；节点自身更换出口 IP 时，脚本无法固定该 IP。选择 REJECT、节点失效或无可用节点时，匹配的 Claude 请求不会自动改为直连。

专属域名范围参考 [Claude Code 网络要求](https://code.claude.com/docs/en/network-config)，并保留已核对的 Claude 域名、认证/CDN 别名和 Anthropic 地址范围。第三方模型网关按其实际域名匹配。

## AI 请求仅使用 TCP

两版在国内外 AI 规则之前拦截匹配的 UDP 请求，覆盖 QUIC。支持回退的应用会改用 TCP，国内 AI 的 TCP 请求继续直连。Clash 保留 Claude 进程保护；Terminal、Cursor 和 `127.0.0.1:7898` 仅拦截匹配 AI 规则的 UDP，普通 UDP 请求继续按完整主规则分流。

此限制针对 AI 业务请求。机场隧道的传输协议由所选节点决定，`Claude` 和 `🤖 AI` 组请直接选择已确认使用 TCP 的 Trojan、AnyTLS 等节点。Hysteria2、TUIC 等节点会用 UDP 传输隧道，即使业务请求本身使用 TCP。

Shadowrocket 的 AI UDP 拦截使用逻辑规则引用远程 AI 规则集。导入当天配置后，在手机端核对规则集成功加载、AI 对话可用及 UDP 拦截记录。

## 更新流程

- **Clash Verge**　编辑本机 `Script.js`，完成检查后提交到仓库的 `clash-verge.js`，转发逻辑变化时重载本机辅助进程，再提示用户自行重启 Clash 并验证。
- **Shadowrocket**　编辑本机配置，文件名使用当天日期 `Shadowrocket-YYYY-MM-DD.conf`。当天更新沿用该文件名；清理诊断配置和旧修订，保留当天正式配置。检查后提交到仓库的 `Shadowrocket.conf`，再提示用户从 iCloud 导入并启用当天正式配置，核对 DNS 后在手机上测试。
