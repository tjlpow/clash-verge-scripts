# 代理分流配置

| 文件 | 用途 |
| --- | --- |
| [clash-verge.js](clash-verge.js) | Clash Verge 的全局扩展脚本 |
| [Shadowrocket.conf](Shadowrocket.conf) | Shadowrocket 的分流配置 |

两版都用国内域名规则集和 `GEOIP,CN` 补齐直连，并为常用服务保留独立策略组。机场订阅链接是凭证，请保存在本机的 `Merge.yaml` 或 Shadowrocket App 中。

两版的主代理组统一为 `🚀 main`，兜底组为 `🐟 Fallback`，国外 AI 组为 `🤖 AI`。

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

Clash 版还按进程匹配 Terminal、Cursor、Claude 和微信。已匹配的国内 AI 请求优先直连。Terminal 和 Cursor 的交互终端可通过本机辅助脚本接入 `127.0.0.1:7898`，由这个入口区分国内 AI 和其他请求。辅助脚本仅在本机维护。

## Shadowrocket

1. **添加机场**　在 App 首页添加订阅。
2. **匹配订阅名**　把 [Shadowrocket.conf](Shadowrocket.conf) 的 `[Proxy Group]` 中的 `Immtele` 和 `Shadowsocks` 换成 App 首页的真实订阅名。手选组用订阅名和 `use=true` 展开单个节点。增减订阅时同步更新组成员。
3. **导入并测试**　把配置放到 iCloud Drive 的 Shadowrocket 文件夹。在手机上从文件导入并启用当天正式配置，核对「通用 → DNS 覆写」地址末尾为 `#proxy`。将全局路由设为「配置」，再测试常用服务和策略组。

Shadowrocket 内置 `PROXY` 表示首页当前节点。各代理组初始选择 `PROXY`，先在首页选中已验证可用的节点，再按需在各组中改选 `🚀 main`、地区组或单个节点。bilibili 初始直连，`🐟 Fallback` 和 iCloud 可手选直连。

Shadowrocket 按域名和 IP 分流。远程规则集随配置更新，自动测速子组在支持 `hidden=1` 的版本中隐藏。

## 策略组选项

| 流量 | 策略 |
| --- | --- |
| 已收录的国内 AI | 固定直连，优先于国外 AI |
| 国外 AI | `🤖 AI` 组 |
| YouTube、X、Google、Telegram、iCloud | 各自的策略组，iCloud 可手选直连 |
| 哔哩哔哩 | bilibili 组，默认直连 |
| 国内服务 | 国内域名规则集或中国 IP 命中后直连 |
| 出口检测站点 | browserleaks.com、whoer.net 和 ipinfo.io 走 `🚀 main` 组 |
| 未匹配流量 | 独立的 `🐟 Fallback` 组，可选自动测速、地区组、单个节点、REJECT 或 DIRECT |

两版均在常规国内规则集之前匹配专属服务。Clash 的海外 DNS 跟随 `🐟 Fallback` 组。Shadowrocket 的海外 DoH 使用 `#proxy`，经首页当前节点转发，使用配置模式前先在首页选中已验证可用的节点。Clash 使用 SukkaW 和 MetaCubeX CN，Shadowrocket 使用 SukkaW 和同源的 ChinaMax_Domain。Shadowrocket 的 iCloud 规则放在 Apple 规则之前，以便命中专属策略组。

## AI 请求仅使用 TCP

两版在国内外 AI 规则之前拦截匹配的 UDP 请求，覆盖 QUIC。支持回退的应用会改用 TCP，国内 AI 的 TCP 请求继续直连。Clash 同时覆盖 Terminal、Cursor、Claude 进程和本机终端入口 `127.0.0.1:7898`。

此限制针对 AI 业务请求。机场隧道的传输协议由所选节点决定，`🤖 AI` 组请直接选择已确认使用 TCP 的 Trojan、AnyTLS 等节点。Hysteria2、TUIC 等节点会用 UDP 传输隧道，即使业务请求本身使用 TCP。

Shadowrocket 的 AI UDP 拦截使用逻辑规则引用远程 AI 规则集。导入当天配置后，在手机端核对规则集成功加载、AI 对话可用及 UDP 拦截记录。

## 更新流程

- **Clash Verge**　编辑本机 `Script.js`，完成检查后提交到仓库的 `clash-verge.js`，再提示用户自行重启并验证。
- **Shadowrocket**　编辑本机配置，文件名使用当天日期 `Shadowrocket-YYYY-MM-DD.conf`。当天更新沿用该文件名；清理诊断配置和旧修订，保留当天正式配置。检查后提交到仓库的 `Shadowrocket.conf`，再提示用户从 iCloud 导入并启用当天正式配置，核对 DNS 后在手机上测试。
