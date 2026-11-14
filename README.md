# 代理分流配置

| 文件 | 用途 |
| --- | --- |
| [clash-verge.js](clash-verge.js) | Clash Verge 现有分流版源码 |
| [clash-verge-safe.js](clash-verge-safe.js) | Clash Verge 文章链式版，可按需切换 |
| [switch-clash-verge.js](switch-clash-verge.js) | 本机版本切换命令；运行入口仍为 `Script.js` |
| [Shadowrocket.conf](Shadowrocket.conf) | Shadowrocket 的分流配置 |

目前可用的 Clash 现有版与 Shadowrocket 版都用国内域名规则集和 `GEOIP,CN` 补齐直连，并为常用服务保留独立策略组。机场订阅链接是凭证，请保存在本机的 `Merge.yaml` 或 Shadowrocket App 中。

目前可用的两版主代理组统一为 `🚀 main`，兜底组为 `🐟 Fallback`，国外 AI 组为 `🤖 AI`，Clash 的 Claude 使用 `🧠 Claude` 中转组和 `🌐 Claude Exit` 出口组；Shadowrocket 使用独立的 `Claude` 组。

## Clash Verge

1. **添加机场**　在全局扩展配置 `Merge.yaml` 中声明 `proxy-providers`。每个机场一项，使用不同的缓存路径。
2. **放置脚本**　把两个 Clash 版本源码及 `switch-clash-verge.js` 放在 `~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles/`。Clash Verge 的全局扩展脚本仍只登记 `Script.js`。
3. **选择版本**　在该目录运行 `node switch-clash-verge.js status` 查看状态，运行 `node switch-clash-verge.js current` 或 `node switch-clash-verge.js safe` 写入对应版本。
4. **加载配置**　首次安装时选用一份订阅或本地配置作为载体。切换命令不重启或操作 Clash Verge；写入后由用户自行重启并验证分流。

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

脚本会用普通 provider 的节点重建策略组。专用 `ClaudeExit` 集合仅用于 Claude 出口，不加入普通组或中转候选。没有 provider 时，脚本复用当前订阅的节点和策略组。

Clash 版按进程匹配 Claude 和微信。Terminal、Cursor 及其交互终端使用与其他应用相同的完整规则：国内模型直连、Claude 请求走专属中转／出口、其他 AI 命中 AI 组，其余继续匹配站点组、国内通用规则和 Fallback。交互终端通过本机辅助脚本接入 `127.0.0.1:7898`，该入口不绑定单一策略或专用子规则。辅助脚本仅在本机维护。

Clash 版的 Claude 请求另经本机 IPv4 转发层：实时查询目标的 A 记录，再按 IPv4 地址通过选定的中转／出口连接。TLS 数据原样转发，不解密对话。已收录国内 AI 仍先直连。

**首次启用 IPv4 转发**：安装 Node.js 后，在本机 `profiles` 目录运行 `node clash-verge.js --install-claude-ipv4`。macOS 会安装随登录启动的本机辅助进程；然后由用户自行重启 Clash Verge。更新转发逻辑后重新运行同一命令。其他系统需自行常驻运行 `node clash-verge.js --claude-ipv4-relay`。

**本机端口**：`7899` 为 IPv4 转发层，`7900` 为单跳上游，`7901` 为链式上游，均只监听 `127.0.0.1`。辅助进程只读本机 Clash 控制 socket，获取两组当前选择；查询失败即断流。DNS 与业务连接共用选定路径，解析按路径和 TTL 缓存，最长 5 分钟；无 A 记录、辅助进程或任一节点不可用时断流，不退回直连、IPv6 或单跳。其他组的出口方式保持原样。本机回环代理连接跳过域名嗅探，避免已解析的 IPv4 被改回域名；TUN 的嗅探设置保留。

## Clash Verge 版本切换

- **现有版**　`clash-verge.js` 保留当前分组及 Claude 专属链式出口；本机 `Script.js` 是它的运行副本。
- **文章版**　`clash-verge-safe.js` 已实现文章模式 B 的分流：国内 AI、B 站、微信、国内域名和中国 IP 直连；其余流量统一经 `🪜 Jump` → `🌍 Overseas Exit` 的手选跳板与 ISP 出口。`GEOSITE,geolocation-!cn` 排在国内域名名单前，补上 `mirrorakam` 关键词和 `100.64.0.0/10`。ISP 不能直连；两组都没有 DIRECT 或自动切换，默认 REJECT。隔离内核已验证真实 ISP 出口和 Claude IPv4 转发；切换后仍需在 Clash Verge 中手选两个节点并实测。
- **切换命令**　`node switch-clash-verge.js status` 查看当前版本；`node switch-clash-verge.js current` 选择现有版；文章版完成实网验收并标记 `ready` 后才能运行 `node switch-clash-verge.js safe`。命令检查源码与本机规则缓存、原位写入 `Script.js` 并校验内容，不修改 Clash 设置或节点选择。若 `Script.js` 与两份源码都不一致，命令拒绝覆盖，需先核对改动。
- **辅助进程**　Claude IPv4 转发进程固定读取本机 `clash-verge.js`，不读取会随版本切换的 `Script.js`。现有版转发逻辑更新后，运行 `node clash-verge.js --install-claude-ipv4` 重载辅助进程。
- **本机私有配置**　`Merge.yaml` 继续保存机场订阅和 ISP 凭据，不提交仓库。文章版完成后也使用这份凭据；源脚本与切换命令不包含账号密码。
- **DNS 与缓存**　海外 DoH 固定使用 Cloudflare，经 `🌍 Overseas Exit`；国内直连和节点引导解析使用国内 DNS。`*.t.dnsleak.dev` 不返回 fake-ip，便于实测 DNS 出口。三份自动更新的规则缓存保存在本机 `profiles/safe-*.yaml`，切换前必须存在有效缓存。Claude 仍使用本机 IPv4 转发层，辅助进程会读取文章版的跳板与出口选择。
- **系统断网保护**　脚本中的 REJECT 只在 Clash 内核运行时生效。退出 Clash 后的系统断网开关需在本机单独安装；其 PF 实现不随公开仓库发布。安装了本机断网开关时，先解除后才能用切换命令返回现有版。

**首次准备规则缓存**：安全版使用 [Loyalsoldier 的 direct、cncidr](https://github.com/Loyalsoldier/clash-rules) 和 [VPSDance 的国内 AI 规则](https://github.com/VPSDance/ai-proxy-rules)。首次切换前，将三份 YAML 分别保存为本机 `profiles/safe-direct.yaml`、`safe-cncidr.yaml`、`safe-ai-cn.yaml`。运行时会每日更新；出口不可用时保留现有缓存。安全版不加载广告拒绝集，避免海外遥测域名被提前拦截。

## Shadowrocket

1. **添加机场**　在 App 首页添加订阅。
2. **匹配订阅名**　把 [Shadowrocket.conf](Shadowrocket.conf) 的 `[Proxy Group]` 中的 `Immtele` 和 `Shadowsocks` 换成 App 首页的真实订阅名。手选组用订阅名和 `use=true` 展开单个节点。增减订阅时同步更新组成员。
3. **导入并测试**　把配置放到 iCloud Drive 的 Shadowrocket 文件夹。在手机上从文件导入并启用当天正式配置，核对「通用 → DNS 覆写」地址末尾为 `#proxy`。将全局路由设为「配置」，再测试常用服务和策略组。

Shadowrocket 内置 `PROXY` 表示首页当前节点。常规代理组初始选择 `PROXY`，先在首页选中已验证可用的节点，再按需在各组中改选 `🚀 main`、地区组或单个节点。bilibili 初始直连，`🐟 Fallback` 和 iCloud 可手选直连。

Shadowrocket 按域名和 IP 分流。远程规则集随配置更新，自动测速子组在支持 `hidden=1` 的版本中隐藏。

## 策略组选项

以下描述 Clash 现有版和 Shadowrocket 版；文章链式版采用上文所述的统一出口分流。

| 流量 | 策略 |
| --- | --- |
| 已收录的国内 AI | 固定直连，优先于国外 AI |
| Claude 自有域名、认证/CDN 别名和 Anthropic 地址范围 | Clash：`🧠 Claude` → 可选 `🌐 Claude Exit`；Shadowrocket：`Claude` |
| Notion、GitHub | 默认跟随 `🚀 main`，优先于通用 AI、国内规则和兜底 |
| 其他国外 AI | `🤖 AI` 组 |
| YouTube、X、Google、Telegram、iCloud | 各自的策略组，iCloud 可手选直连 |
| 哔哩哔哩 | bilibili 组，默认直连 |
| 国内服务 | 国内域名规则集或中国 IP 命中后直连 |
| 出口检测站点 | browserleaks.com、whoer.net 和 ipinfo.io 走 `🚀 main` 组 |
| 未匹配流量 | 独立的 `🐟 Fallback` 组，可选 `🚀 main`、自动测速、地区组、单个节点、REJECT 或 DIRECT |

两版均在常规国内规则集之前匹配专属服务。Notion 和 GitHub 不另建策略组，随 `🚀 main` 切换；Clash 使用 GEOSITE，Shadowrocket 使用远程规则集，并补充 Notion 附件和状态域名。Clash 的 Claude 进程规则仍优先，因此可识别的 Claude 进程访问这些服务时继续使用 Claude 链路。Clash 的海外 DNS 跟随 `🐟 Fallback` 组。Shadowrocket 的海外 DoH 使用 `#proxy`，经首页当前节点转发，使用配置模式前先在首页选中已验证可用的节点。Clash 使用 SukkaW 和 MetaCubeX CN，Shadowrocket 使用 SukkaW 和同源的 ChinaMax_Domain。Shadowrocket 的 iCloud 规则放在 Apple 规则之前，以便命中专属策略组。

Clash 的 AI 原始规则集继续自动更新：

- **过滤范围**　本机辅助进程每 5 秒同步源缓存，仅去掉 Cursor、Terminal 的 PROCESS 条目，保留域名、IP 和其他应用条目。
- **缓存更新**　派生规则集 `profiles/ai-global-services.yaml` 每 60 秒重新加载；更新异常时保留上次有效缓存。
- **首次安装**　源缓存缺失时，安装命令经本机 Clash `127.0.0.1:7897` 下载。需先运行可用代理，下载失败会停止安装。

## Claude 出口选择

Clash 使用两个手选组：

- **中转**　`🧠 Claude` 默认 `REJECT`。选择单个节点，或选择 `🚀 main` 跟随主组。
- **出口**　`🌐 Claude Exit` 默认 `Exit Off`。选项沿用本机 `Merge.yaml` 的 `ClaudeExit` 集合中配置的节点名称，例如 `ISP-Chain`，固定经 `🧠 Claude` 建连。机场节点不列入出口候选。
- **关闭额外出口**　`Exit Off` 表示仅使用中转，与原生 `REJECT` 不同。隐藏的同名组仅作模式标记，不是实际出口。
- **切换出口**　在 `🌐 Claude Exit` 中改选节点，新连接随之变化。已有长连接需重新建立。
- **更新后选择**　原 `Claude` 组已更名为 `🧠 Claude`，重启后重新核对中转选择。默认 `Exit Off` 保持单跳模式。

**添加出口**：在本机 `Merge.yaml` 的现有 `proxy-providers:` 下添加 `ClaudeExit`，与机场集合同级。不要重复添加顶层键。SOCKS5 示例：

```yaml
  ClaudeExit:
    type: inline
    payload:
      - name: ISP-Chain
        type: socks5
        server: "出口服务器地址"
        port: 12345
        username: "用户名"
        password: "密码"
        udp: false
```

保存后自行重启 Clash，在 `🧠 Claude` 选择中转，在 `🌐 Claude Exit` 选择 `ISP-Chain`。以后更换名称、地址或凭据仅修改此集合；账号密码只存本机，不提交仓库。未配置该集合时，出口组只保留 `Exit Off` 和 `REJECT`。

| 出口选择 | 中转状态 | 连接结果 |
| --- | --- | --- |
| `Exit Off` | 可用 | 中转 → 目标 |
| `Exit Off` | 不可用或 `REJECT` | 断流 |
| 出口节点可用 | 可用 | 中转 → 出口 → 目标 |
| 出口节点不可用 | 任意 | 断流，不退回单跳 |
| 已选出口节点 | 不可用或 `REJECT` | 断流，不直接连接出口 |
| `REJECT` | 任意 | 断流 |

- **出口隔离**　运行配置只保留 `ClaudeExit` 的链式副本，不输出原始节点，避免重名及直接使用；出口不加入普通组或中转候选。出口仅提供支持 TCP 的节点，过滤 Hysteria、Hysteria2、TUIC、WireGuard、Tailscale 和直连类型；中转也建议选用已验证的 TCP 节点。
- **Shadowrocket**　保留单一 `Claude` 手选组，初始为 `REJECT`，可选 `🚀 main` 或单个节点。本次链式出口和本机 IPv4 转发仅适用于 Clash。
- **匹配顺序**　广告、本地和 AI UDP 拦截 → 国内 AI 直连 → Claude 专属规则 → Notion／GitHub 跟随主组 → 其他国外 AI → 普通国内规则 → 兜底。国内模型优先直连，包括 Claude Code 中调用已收录的国内 API。
- **Clash 进程**　Claude App、传统 `claude` 进程和原生 CLI 路径 `~/.local/share/claude/versions/` 都走上述中转／出口。原生 CLI 的进程名可能是版本号，按安装路径匹配，不依赖具体版本。Terminal、Cursor 中访问 Claude 专属域名走同一路径，其余请求使用完整主规则；本机终端入口与普通代理/TUN 保持一致。
- **共享服务**　Sentry、Intercom、Statsig、GitHub、npm 等共享域名保留原分流；Clash 能识别为 Claude 进程的请求由进程规则处理。Shadowrocket 按域名和 IP 匹配，无法据此保证所有共享服务都使用 Claude 出口。广告拦截保持优先。
- **IPv4 边界**　Clash 拒绝 IPv6 字面地址请求，不转换为 IPv4。机场若另行重定向出口，仍须以目标网站的实际回显验证。
- **出口 IP**　手选固定节点选择；节点自身更换出口 IP 时，脚本无法固定该 IP。最后一跳节点决定实际出口。

专属域名范围参考 [Claude Code 网络要求](https://code.claude.com/docs/en/network-config)，并保留已核对的 Claude 域名、认证/CDN 别名和 Anthropic 地址范围。第三方模型网关按其实际域名匹配。

## AI 请求仅使用 TCP

两版在国内外 AI 规则之前拦截匹配的 UDP 请求，覆盖 QUIC。支持回退的应用会改用 TCP，国内 AI 的 TCP 请求继续直连。Clash 保留 Claude 进程保护；Terminal、Cursor 和 `127.0.0.1:7898` 仅拦截匹配 AI 规则的 UDP，普通 UDP 请求继续按完整主规则分流。

此限制针对 AI 业务请求。机场隧道的传输协议由所选节点决定，`🧠 Claude`（Shadowrocket 为 `Claude`）和 `🤖 AI` 组请直接选择已确认使用 TCP 的 Trojan、AnyTLS 等节点。Hysteria2、TUIC 等节点会用 UDP 传输隧道，即使业务请求本身使用 TCP。

Shadowrocket 的 AI UDP 拦截使用逻辑规则引用远程 AI 规则集。导入当天配置后，在手机端核对规则集成功加载、AI 对话可用及 UDP 拦截记录。

## 更新流程

- **Clash 现有版**　编辑本机 `clash-verge.js`，完成语法与分流检查后运行 `node switch-clash-verge.js current`，同步到 `Script.js`。转发逻辑变化时运行 `node clash-verge.js --install-claude-ipv4`。核对远程最新版本后提交 `clash-verge.js` 和相关 README，提示用户自行重启 Clash 并验证。维护时不切换 Clash 模式、节点或激活配置。
- **Clash 文章链式版**　只编辑 `clash-verge-safe.js`，先做语法、规则、独立内核与真实出口链测试。验收通过后运行 `node switch-clash-verge.js safe` 写入 `Script.js`。核对远程版本后提交源码与 README，再由用户自行重启并验证。首次切换时在新组中手选跳板和 ISP 出口。
- **切换命令**　修改 `switch-clash-verge.js` 后测试 `status`、两版切换及缓存缺失时的拒绝；核对远程版本后单独提交，不触碰私有 `Merge.yaml`。
- **Shadowrocket**　编辑本机配置，文件名使用当天日期 `Shadowrocket-YYYY-MM-DD.conf`。当天更新沿用该文件名；清理诊断配置和旧修订，保留当天正式配置。检查后提交到仓库的 `Shadowrocket.conf`，再提示用户从 iCloud 导入并启用当天正式配置，核对 DNS 后在手机上测试。

## 对话式流量检测

在使用 Claude 时采样 Clash 连接，先用代码核对实际链路，再按需进行模型复检或优化脚本。检测全程由对话引导；报告保存在临时目录，可在对话中查看和清除。

### 预载提示词

```text
请阅读 https://github.com/tjlpow/clash-verge-scripts/blob/main/traffic-monitor/README.md，执行其中的“预载”阶段。此后在本对话中按该文档的数字选项推进；每次只给我当前阶段的操作指引。
```
