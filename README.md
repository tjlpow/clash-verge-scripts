# 代理分流配置

同一套分流策略的两个实现：**Clash Verge**（macOS）和 **Shadowrocket**（iOS / macOS）。

核心思路是「白名单模式」：默认全部走代理，国内流量靠 `GEOIP,CN` 和少量域名规则走直连。
支持多机场节点合并到同一批策略组里，按国家/地区/流量倍率自动测速选最快节点。

| 文件 | 用途 |
| --- | --- |
| `white-list-groups.js` | Clash Verge 全局扩展脚本（当前在用的版本） |
| `Shadowrocket.conf` | Shadowrocket 配置模板 |
| `white-list.js` / `white-list-original.js` | 早期版本，不带策略组 |
| `xiaolin-007-*.js` | 参考用的第三方脚本 |

> ⚠️ **机场订阅链接等同账号凭证，本仓库是公开的，任何情况下都不要提交进来。**
> Clash Verge 版把链接放在本机的 `Merge.yaml`，脚本只读 provider 的 key 名；
> Shadowrocket 版的订阅在 App 里添加，配置文件里只出现订阅的名字。

---

## Clash Verge（macOS）

### 需要配置什么

两个文件，配合使用，缺一不可：

| 文件 | 位置 | 内容 | 能否公开 |
| --- | --- | --- | --- |
| `Merge.yaml` | 全局扩展配置 | 机场订阅链接（`proxy-providers`） | ❌ 含凭证，只留本机 |
| `Script.js` | 全局扩展脚本 | 本仓库的 `white-list-groups.js` | ✅ 无凭证 |

之所以拆成两个，是因为 Clash Verge 的处理链是
**全局扩展配置 → 全局扩展脚本 → 订阅级配置 → 订阅级脚本**。
`Merge.yaml` 跑在脚本之前，脚本才能读到它声明的 `proxy-providers`。
脚本只用 `Object.keys(config["proxy-providers"])` 取 key 名，从不碰 URL，所以能放心公开备份。

### 配置步骤

**1. 新建一个本地空配置当载体**

Clash Verge →「订阅」→ 新建**本地**配置，内容随便写个占位即可：

```yaml
proxies: []
proxy-groups: []
rules:
  - MATCH,DIRECT
```

节点和策略组全部由 provider + 脚本生成，这份配置只是个壳。
（继续用某个机场订阅当载体也行，脚本会丢弃它自带的节点和策略组，结果一样。）

**2. 全局扩展配置里声明机场**

编辑 `Merge.yaml`，每个机场一条：

```yaml
profile:
  store-selected: true

proxy-providers:
  机场A:
    type: http
    url: "https://你的机场订阅链接"
    path: ./providers/airport-a.yaml
    interval: 3600
    # 机场订阅里混着的「当前流量 / 到期时间」等假节点，在这一层滤掉
    exclude-filter: "有效期|剩余|当前流量|到期时间|官网|订阅|群组|重置"
    health-check:
      enable: true
      url: http://www.gstatic.com/generate_204
      interval: 300

  机场B:
    type: http
    url: "https://另一个机场的订阅链接"
    path: ./providers/airport-b.yaml
    interval: 3600
    exclude-filter: "有效期|剩余|当前流量|到期时间|官网|订阅|群组|重置"
    health-check:
      enable: true
      url: http://www.gstatic.com/generate_204
      interval: 300
```

以后加第三个机场，只在这里加一条，**脚本一个字都不用改**（它遍历所有 provider）。

**3. 全局扩展脚本填 `white-list-groups.js` 的内容**

**4. 重载配置**

macOS 上文件的实际路径：

```
~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles/
├── Merge.yaml     ← 全局扩展配置（含凭证，不要外传）
└── Script.js      ← 全局扩展脚本
```

> 改这两个文件前先关掉 Clash Verge 自带的编辑器窗口，否则在它里面点保存会覆盖掉磁盘上的改动。

### 脚本的两种运行模式

脚本按有没有 `proxy-providers` 自动切换，不用手动配：

- **provider 模式**（推荐）：丢弃订阅自带的节点和策略组，全部重建，每个组用 `use` 同时引用所有机场。不管激活哪份配置结果都一致。
- **单订阅模式**（没有 provider 时的退路）：复用订阅自带的策略组，只做增补。

---

## Shadowrocket（iOS / macOS）

### 需要配置什么

只有一个配置文件，订阅在 App 里加，所以不涉及凭证落盘。

### 配置步骤

**1. 在 App 里添加订阅**

首页 →「+」→ 添加订阅，两个机场都加进去。节点会自动进同一个池。

**2. 改配置文件里的订阅名**

把 `Shadowrocket.conf` 里 `[Proxy Group]` 段的 `机场A` / `机场B`
换成 App 首页显示的**真实订阅名**（大小写、空格都要一致）：

```
Proxy = select, ⚡ Auto, ..., DIRECT, 机场A, 机场B, use=true, policy-select-name=⚡ Auto
                                      └── 换成真实订阅名 ──┘
```

名字对不上的话这条成员会失效，组里就只剩子组、选不到单个节点。

**3. 导入**

配置文件放进 iCloud Drive → Shadowrocket 文件夹，
然后 App →「配置」→「+」→ 从文件导入 → 选中它 → **点一下切换过去才生效**。

macOS 上对应的 iCloud 目录：

```
~/Library/Mobile Documents/iCloud~com~liguangming~Shadowrocket/Documents/
```

> Shadowrocket 不保存 `.conf` 原文，导入时会解析成 SQLite 库存到
> `~/Library/Containers/com.liguangming.Shadowrocket/Data/Documents/Databases/`。
> 所以把 `.conf` 丢进目录里不会自动生效，必须走导入。
> 该目录已通过 iCloud 同步，Mac 上导入一次，iOS 端会跟着同步。

### 策略组语法要点

踩过的坑，写在这里省得再试：

| 写法 | 结果 |
| --- | --- |
| 成员里放 `PROXY` | ❌ 它是「跟随全局选择」，不展开成节点列表 |
| 只写 `policy-regex-filter=.*` | ❌ 单个节点出来了，但显式列的子组全没了 |
| 写 `use=true` 但没列订阅名 | ❌ 没东西可展开，等于空转 |
| **列出订阅名 + `use=true`** | ✅ 子组和单个节点都在 |

`use=true` 的语义是「把前面列出的**订阅名**展开成节点」，不是独立开关。
这个写法可以从 App 界面建组后导出的配置里验证。

---

## 两者的功能差异

| 能力 | Clash Verge | Shadowrocket |
| --- | --- | --- |
| 多机场节点合并 | `proxy-providers` + `use` | App 内加订阅，自动进同一池 |
| 加新机场要改配置吗 | 改 `Merge.yaml` 一条 | 不用改，App 里加订阅即可 |
| 按正则筛节点分组 | `filter` / `exclude-filter` | `policy-regex-filter` |
| 规则集自动更新 | ✅ `rule-providers` 带 `interval`，核心每 24h 自己拉 | ⚠️ `RULE-SET` 无单条 interval，配置更新时才重拉 |
| 隐藏子组 | ✅ `hidden: true` | ❌ 不支持，11 个子组会全显示 |
| GEOSITE 规则 | ✅ 原生支持 | ❌ 不支持，改用域名规则集 |
| DNS 防泄漏 | ✅ fake-ip + `respect-rules`，DNS 查询也按分流规则走 | ⚠️ 只能指定 DoH，没有等价机制 |
| 动态生成配置 | ✅ JS 脚本 | ❌ 全静态 |
| 正则引擎 | Go RE2，**不支持**先行断言 `(?=...)` | ICU，**支持**先行断言 |

几点说明：

- **规则集来源不同**。AI 规则用同一个项目（[VPSDance/ai-proxy-rules](https://github.com/VPSDance/ai-proxy-rules)，它同时提供 Clash 和 Shadowrocket 两种格式）；
  但广告 / Apple / iCloud / Telegram 这些，Clash 版用 [Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules)（Clash 专用），
  Shadowrocket 版换成 [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script)。
- **Shadowrocket 版 iCloud 规则必须排在 Apple 之前**。blackmatrix7 的 `Apple.list` 里含 icloud 域名，
  放在后面的话 iCloud 组永远匹配不到。Clash 版用的 Loyalsoldier 两个列表没有重叠，不受影响。
- **正则引擎差异会影响写法**。比如「同时含『倍率』和『0.』」，
  Shadowrocket 能直接写 `(?=.*倍率)(?=.*0\.)`，Clash 只能绕成 `(倍率.*0\.|0\..*倍率)`。
- **双字母国家代号要用 `\b` 包住**，否则 `US` 会误伤 `RUS`（俄罗斯）和 `AUS`（澳大利亚）。两边都一样。

---

## 分流规则顺序

两个版本保持一致，顺序即匹配顺序，命中即止：

```
广告拦截 → REJECT
Apple / 局域网 → DIRECT
YouTube / X → 各自的组
国外AI（含 Google 搜索本体）→ 国外AI 组
国内AI → 国内AI 组
Telegram / iCloud → 各自的组
直连白名单 + GEOIP,CN → DIRECT
兜底 MATCH/FINAL → 主组
```

两个关键的顺序约束：

1. **AI 和各服务的规则必须排在 `GEOIP,CN,DIRECT` 之前**。否则国内 AI 服务会先被 GEOIP 命中直连，对应的策略组形同虚设、选了节点也不生效。
2. **Google 搜索本体（`google.com` 等）要显式指向国外AI 组**。Google 搜索里的 AI mode 不是独立域名，走的就是 `www.google.com`，不在 AI 规则集里；不补的话会落到兜底、用主组的出口 IP，IP 不干净就用不了 AI mode。

另外别把 `GEOIP,CN` 换成 `GEOSITE,cn` 或 `China.list` 这类域名分类——
那些列表混有 browserleaks / whoer / ipinfo 等境外测 IP 的站点，会让它们直连，反而暴露真实 IP。
