// ============================================================
// 维护流程
// 1. **修改**：直接编辑本机 profiles/Script.js，保留 Clash Verge 读取的文件名。
// 2. **检查与提交**：检查后提交 tjlpow/clash-verge-scripts 的 clash-verge.js。
//    单文件更新时核对远程 SHA，避免覆盖并发改动。
// 3. **辅助进程**：首次安装或修改转发逻辑后，运行 node Script.js --install-claude-ipv4。
//    辅助进程由 macOS 登录项常驻，只监听本机；更新时重载辅助进程。
// 4. **生效**：提示用户自行重启 Clash Verge 并验证分流。维护时不重启或切换 Clash。
//
// ▍安装与用法见 README：
//   https://github.com/tjlpow/clash-verge-scripts#clash-verge
// ▍本机目录：~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles/
// ▍机场订阅链接和出口账号密码仅保存在本机 Merge.yaml。
// ▍内置脚本编辑器可能覆盖磁盘改动，修改后请避免保存旧编辑窗口。
// ============================================================

// ============================================================
// Clash Verge 外部脚本
//   国内规则集自动更新 + 直连补充 + 防 DNS 泄漏 + 广告拦截
//   + YouTube / X / bilibili / 🤖 AI / Telegram / iCloud / 🐟 Fallback 独立策略组
//   + 🧠 Claude 中转 / 🌐 Claude Exit 可选出口；国内模型固定直连，应用共用完整规则
//   + Auto / 低倍率 / 分国家 自动测速子组（hidden，只做备选项）
//
// ▍两种运行模式，看有没有 proxy-providers 自动切换：
//
//   provider 模式（当前用的就是这个）——
//     Merge.yaml 里把两个机场都声明成 proxy-providers，本脚本丢弃订阅
//     自带的节点和策略组，所有组由脚本重建、用 use 同时引用全部机场。
//     好处：每个组都能选到两家机场的节点，不再是"切订阅二选一"；
//     以后加第三个机场只改 Merge.yaml，本文件一个字都不用动。
//     ⚠️ 订阅链接是凭证，只留在本机的 Merge.yaml，绝不进这个文件
//        —— 本文件会推到公开仓库。
//
//   单订阅模式（没有 proxy-providers 时的退路）——
//     复用订阅自带的策略组，只做增补。
//
// 「🐟 Fallback」独立选择未匹配流量的节点，默认自动测速；国内AI固定直连。
// bilibili 默认直连；🐟 Fallback 和 iCloud 提供手动 DIRECT 选项，其他代理组禁止直连。
// 🧠 Claude 选择中转；🌐 Claude Exit 仅列出 Merge.yaml 的 ClaudeExit 集合出口。
// 出口沿用 ClaudeExit 中的节点名称，不额外添加前缀；专用原节点不输出到运行配置。
// ClaudeExit 不加入普通分组；🌐 Claude Exit 默认 Exit Off（仅中转），保留原生 REJECT。
// 🌐 Claude Exit 选出口后强制经中转连接，任何一环失败都断流；真正 REJECT 始终拒绝。
// 🧠 Claude / 🐟 Fallback 选择 🚀 main 后跟随主组；固定出口请在 🌐 Claude Exit 手选节点。
// Claude 专属域名/IP 与进程先于通用 AI；共享监测域名保留原规则，广告拦截仍优先。
// Claude 请求先经本机 IPv4 转发层，动态查询 A 记录，再按 IP 经选定的中转／出口连接。
// DNS 和业务连接共用选定路径；辅助进程或任一节点失效、无 A 记录时拒绝，不回退。
// 更新后自行重启 Clash，并在更名的 🧠 Claude 组中重新核对中转选择。
// 本机端口：7899 为转发层，7900 为单跳上游，7901 为链式上游，均只监听回环地址。
// 辅助进程只读本机控制 socket 获取两组选择，查询失败即断流，不猜测或绕过出口。
// AI 规则集和 Claude 进程拦截业务 UDP/QUIC；普通终端流量不整体限制 UDP。
// 机场隧道协议由节点决定；AI 组应选用 Trojan、AnyTLS 等 TCP 节点。
// 代理规则附带 REJECT 保护，防止不支持 UDP 等情况落入后面的直连规则。
// Terminal / Cursor 的交互终端由 terminal-ai-proxy.zsh 配置本机 HTTP 代理；
// 已打开的终端需 source 该文件。不遵循代理变量的命令仍依赖 TUN。
//
// 各项配置的取舍理由记在提交历史里，不在本文件重复：
//   https://github.com/tjlpow/clash-verge-scripts/commits/main/clash-verge.js
// ============================================================

// —— 主代理组名 ——
// 两版统一使用 🚀 main、🐟 Fallback、🤖 AI。
// 单订阅模式先识别订阅主组，再统一名称并更新引用。
const MAIN_GROUP_NAME = "🚀 main";
const MAIN_GROUP_CANDIDATES = [
  MAIN_GROUP_NAME, "main", "Main",
  "Proxy", "Proxies", "PROXY",
  "节点选择", "🚀 节点选择", "手动切换", "代理模式",
  "✈️Final", "Final", "GLOBAL"
];

// —— 应用分流 ——
// 路径覆盖 App 包内的辅助进程；进程名补充 CLI 和安装路径变化。
// 国内AI规则先匹配，避免 Claude Code / Cursor 直接调用国内模型时绕路。
const CLAUDE_APPS = [
  { name: "Claude", path: "(^|/)Claude\\.app/Contents/", process: "^(Claude|claude)( Helper.*)?$" }
];
// Claude 自有域名及明确的认证/CDN 别名。共享 Sentry、Intercom 等不整体划入本组。
// 网络要求：https://code.claude.com/docs/en/network-config
const CLAUDE_DOMAIN_MATCHERS = [
  "DOMAIN-SUFFIX,anthropic.com", "DOMAIN-SUFFIX,claude.ai",
  "DOMAIN-SUFFIX,claude.com", "DOMAIN-SUFFIX,clau.de",
  "DOMAIN-SUFFIX,claudemcpclient.com", "DOMAIN-SUFFIX,claudemcpcontent.com",
  "DOMAIN-SUFFIX,claudeusercontent.com",
  "DOMAIN,servd-anthropic-website.b-cdn.net",
  "DOMAIN,anthropic.com.cdn.cloudflare.net", "DOMAIN,anthropic.auth0.com",
  "DOMAIN,anthropic-com.ghost.io"
];
// 与现有 AI 规则集中的 Anthropic 地址范围一致，不主动解析其他域名。
const CLAUDE_IP_MATCHERS = [
  "IP-CIDR,160.79.104.0/21", "IP-CIDR6,2607:6bc0::/32", "IP-ASN,399358"
];
const TERMINAL_AI_PORT = 7898;
const TERMINAL_AI_NAME = "terminal-ai";
const CLAUDE_IPV4_RELAY_PORT = 7899;
const CLAUDE_IPV4_UPSTREAM_PORT = 7900;
const CLAUDE_IPV4_UPSTREAM_NAME = "claude-ipv4-upstream";
const CLAUDE_GROUP_NAME = "🧠 Claude";
const CLAUDE_EXIT_GROUP_NAME = "🌐 Claude Exit";
const CLAUDE_EXIT_OFF_NAME = "Exit Off";
// 本机 Merge.yaml 中的专用出口集合，不加入普通分组或中转候选。
const CLAUDE_EXIT_PROVIDER_NAME = "ClaudeExit";
const CLAUDE_EXIT_UPSTREAM_NAME = "claude-exit-upstream";
const CLAUDE_EXIT_UPSTREAM_PORT = 7901;

// —— 需要独立选节点的站点 ——
// name     : 生成的策略组名，会出现在「代理」页里
// matchers : 匹配规则，策略由脚本自动补上组名
// defaultPolicy: 首次创建时排在第一位的选项；省略则跟随主组
const SITE_GROUPS = [
  {
    name: "YouTube",
    matchers: ["GEOSITE,youtube"]
  },
  {
    name: "X",
    matchers: ["GEOSITE,twitter"]            // x.com / twitter.com / t.co
  },
  {
    // 参考 BilibiliHMT 的域名范围，并补上游戏域名与常见视频 CDN；默认直连，
    // 在「代理」页可改选 🚀 main、自动组或任意节点。避免照搬其 IP 规则，
    // 以免公用 IP 或将来变更的地址误伤其他服务。
    name: "bilibili",
    defaultPolicy: "DIRECT",
    matchers: [
      "DOMAIN-SUFFIX,bilibili.com",
      "DOMAIN-SUFFIX,bilibili.tv",
      "DOMAIN-SUFFIX,bilibiligame.cn",
      "DOMAIN-SUFFIX,bilibiligame.co",
      "DOMAIN-SUFFIX,bilibiligame.net",
      "DOMAIN-SUFFIX,biligame.co",
      "DOMAIN-SUFFIX,biligame.com",
      "DOMAIN-SUFFIX,biligame.net",
      "DOMAIN-SUFFIX,acgvideo.com",
      "DOMAIN-SUFFIX,biliapi.net",
      "DOMAIN-SUFFIX,biliimg.com",
      "DOMAIN-SUFFIX,bilivideo.com",
      "DOMAIN-SUFFIX,hdslb.com",
      "DOMAIN-SUFFIX,b23.tv",
      "DOMAIN,p-bstarstatic.akamaized.net",
      "DOMAIN,p.bstarstatic.com",
      "DOMAIN,upos-bstar-mirrorakam.akamaized.net",
      "DOMAIN,upos-bstar1-mirrorakam.akamaized.net",
      "DOMAIN,upos-hz-mirrorakam.akamaized.net"
    ]
  },
  {
    // Google 搜索、AI Mode 及关联资源独立选节点；Gemini 等海外 AI 服务
    // 仍由下方 ai-global 规则集优先分流到「🤖 AI」。YouTube 的规则排在
    // 这里前面，所以不会被 google.com 的域名规则抢走。
    name: "Google",
    afterProviderRules: true,
    matchers: [
      "DOMAIN-SUFFIX,google.com",
      "DOMAIN-SUFFIX,google.com.hk",
      "DOMAIN-SUFFIX,google.co.jp",
      "DOMAIN-SUFFIX,gstatic.com",
      "DOMAIN-SUFFIX,googleusercontent.com"
    ]
  }
];

// —— 首页不单独显示的组名 ——
// 订阅自带的 "Auto" 只想当 🚀 main 的备选项，不需要单独占一个首页 tile。
// 2026-08-15 已实测 Clash Verge 会认这个字段，首页确实不显示了。
const HIDDEN_GROUPS = ["Auto"];

// —— 自动测速子组（url-test：在筛出来的节点里自动选延迟最低的）——
// 都不在首页单独显示（hidden: true），只作为其他组的备选项出现。
//
// filter / exclude 都是正则，交给 mihomo 按节点名匹配。注意 mihomo 用的是
// Go 的 RE2，**不支持** (?!...) 这类先行断言，只能用「正向匹配 + 反向排除」
// 两个字段配合，别想着写一条否定正则。
//
// 各家机场的节点命名差别很大，filter 要同时覆盖多种写法，例如：
//   机场A   日本-TY-3-流量倍率:0.6
//   机场B   🇯🇵 JPN 01
// 前者带流量倍率标记，后者没有 —— 所以「排除高倍率」用 exclude 做
// （没有倍率标记的节点天然不会被排除掉），而不是写进 filter 里。
const HIGH_RATIO_EXCLUDE = "流量倍率:(1\\.\\d+|[2-9])"; // 1.x / 2~9 倍，性价比低

// 分国家的组用「中文名 | 双字母及其三字母变体 | 英文全称 | 国旗 emoji」四选一，
// 尽量覆盖各家机场的命名习惯。(?i) 是忽略大小写（us / US / Us 都认）。
//
// ⚠️ 双字母代号必须用 \b 包住，否则会误伤：US 会命中 RUS(俄罗斯) / AUS(澳大利亚)。
//   \bUSA?\b 的含义是「US 或 USA，且前后都是非单词字符」，
//   RUS 里的 US 前面紧挨着 R（单词字符），不构成边界，不会被匹配。
// 已用两家机场的真实节点名验证过，没有串组。
const CC = {
  us: "(?i)(美国|\\bUSA?\\b|United ?States|🇺🇸)",
  jp: "(?i)(日本|\\bJPN?\\b|Japan|🇯🇵)",
  hk: "(?i)(香港|\\bHKG?\\b|Hong ?Kong|🇭🇰)",
  sg: "(?i)(新加坡|狮城|\\bSGP?\\b|Singapore|🇸🇬)",
  tw: "(?i)(台湾|台北|\\bTWN?\\b|Taiwan|🇹🇼)",
  kr: "(?i)(韩国|首尔|\\bKOR?\\b|Korea|🇰🇷)",
  gb: "(?i)(英国|伦敦|\\b(UK|GBR?)\\b|United ?Kingdom|Britain|🇬🇧)",
  de: "(?i)(德国|\\bDEU?\\b|Germany|🇩🇪)",
  nl: "(?i)(荷兰|\\bNLD?\\b|Netherlands|🇳🇱)"
};

const AUTO_GROUPS = [
  // 全部节点里自动选最快的（排除高倍率）。订阅自带的 Auto 在 provider
  // 模式下已经被丢弃，所以这里自己建一个。
  { name: "⚡ Auto", filter: "", exclude: HIGH_RATIO_EXCLUDE, providerOnly: true },

  // 低倍率：认「名字里同时有『倍率』和『0.』」的节点，两种词序都兼容
  // （流量倍率:0.6 / 0.5倍率）。没写倍率的机场匹配不到，这个组会是空的。
  { name: "💰 低倍率", filter: "(倍率.*0\\.|0\\..*倍率)", exclude: "" },

  // 分国家/地区。按用户要求不再叠加倍率筛选 —— 想要低倍率就选上面那个组。
  // 组名带上大写的国家代号，和节点名里的缩写对得上，一眼能看出这组在筛什么。
  { name: "🇺🇸 US 美国",   filter: CC.us, exclude: "" },
  { name: "🇯🇵 JP 日本",   filter: CC.jp, exclude: "" },
  { name: "🇭🇰 HK 香港",   filter: CC.hk, exclude: "" },
  { name: "🇸🇬 SG 新加坡", filter: CC.sg, exclude: "" },
  { name: "🇹🇼 TW 台湾",   filter: CC.tw, exclude: "" },
  { name: "🇰🇷 KR 韩国",   filter: CC.kr, exclude: "" },
  { name: "🇬🇧 UK 英国",   filter: CC.gb, exclude: "" },
  { name: "🇩🇪 DE 德国",   filter: CC.de, exclude: "" },
  { name: "🇳🇱 NL 荷兰",   filter: CC.nl, exclude: "" }
];

// —— 需要独立选节点的规则集（各建一个 select 组）——
// name     : 生成的策略组名
// provider : rule-provider 的 key
// url      : 规则源地址
// behavior : classical(带规则类型，默认) / domain(纯域名) / ipcidr(纯 CIDR)
//
// 来源：
//   AI 服务    https://github.com/VPSDance/ai-proxy-rules（main 分支）
//   Telegram / iCloud  https://github.com/Loyalsoldier/clash-rules
//     （release 分支才是每日自动构建的产物，master/main 只有生成源码，
//      千万别指错分支，否则拿到的东西不会自动更新）
// 都是 rule-provider，按 interval 自动刷新，不需要这个脚本重跑。
// 域名规则先于国内通用规则，保留独立策略；纯 IP 规则在域名匹配后处理。
//
// 默认用 cdn.jsdelivr.net（2026-08-14 测过能连，最快）。mihomo 不支持
// 一个 url 填多个地址自动轮询，连不上时手动把下面 url 里的域名换成：
//   testingcf.jsdelivr.net / fastly.jsdelivr.net / cdn.jsdmirror.com
// 换完只需替换域名，路径不用动。
const PROVIDER_GROUPS = [
  {
    name: "🤖 AI",
    provider: "ai-global",
    url: "https://cdn.jsdelivr.net/gh/VPSDance/ai-proxy-rules@main/rules/clash/global.yaml"
  },
  {
    name: "国内AI",
    provider: "ai-cn",
    url: "https://cdn.jsdelivr.net/gh/VPSDance/ai-proxy-rules@main/rules/clash/cn.yaml",
    policy: "DIRECT" // 固定直连，不受策略组保存的旧节点选择影响
  },
  {
    name: "Telegram",
    provider: "telegram",
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/telegramcidr.txt",
    behavior: "ipcidr" // 内容是纯 IP-CIDR 列表，不是域名
  },
  {
    name: "iCloud",
    provider: "icloud",
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/icloud.txt",
    behavior: "domain",
    allowDirect: true
  }
];

// —— 固定策略的规则集（不建组，命中直接执行固定策略，不用手动选节点）——
// apple    : Apple 通用 CDN / 系统更新等大流量静态资源，直连更快也不占代理流量
// ad-reject: 广告 / 追踪器域名，直接拒绝连接
const FIXED_RULE_SETS = [
  {
    provider: "apple",
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/apple.txt",
    behavior: "domain",
    policy: "DIRECT"
  },
  {
    provider: "ad-reject",
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt",
    behavior: "domain",
    policy: "REJECT"
  }
];

// —— 国内服务直连规则集 ——
// 放在服务专属规则之后、IP 规则之前，不建立额外策略组。
// MetaCubeX CN 来自 ChinaMax_Domain，无需重复加载整个 ChinaMax。
// SukkaW Domestic 补充常用服务，包含 DOMAIN-WILDCARD，使用 classical/text。
const DOMESTIC_RULE_SETS = [
  {
    provider: "cn-sukka",
    url: "https://ruleset.skk.moe/Clash/non_ip/domestic.txt",
    behavior: "classical",
    format: "text",
    interval: 43200
  },
  {
    provider: "cn-meta",
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.mrs",
    behavior: "domain",
    format: "mrs",
    interval: 86400
  }
];

// 出口检测网站跟随主代理组，优先于国内通用名单和应用直连规则。
// MetaCubeX CN 当前收录 browserleaks.com；明确例外可防止上游分类改变出口。
const PROXY_EXCEPTION_DOMAINS = ["browserleaks.com", "whoer.net", "ipinfo.io"];

// —— 防 DNS 泄漏配置 ——
// 默认解析经兜底组查询海外 DoH；DIRECT 出口使用国内 DoH 获取本地 CDN。
// 不按整个 CN 名单分配国内 DNS，避免覆盖 AI 等服务的代理策略。
// 代理节点域名也由国内 DoH 引导解析。
// Clash Verge 中须关闭「DNS 覆写」，否则设置页会接管这些字段。
// 配合 TUN 的 DNS 劫持，才能覆盖没有使用系统代理的应用。
const domesticNameservers = [
  "https://223.5.5.5/dns-query", // 阿里 DoH
  "https://doh.pub/dns-query"    // 腾讯 DoH
];

const foreignNameservers = [
  "https://1.1.1.1/dns-query", // Cloudflare DNS
  "https://8.8.8.8/dns-query"  // Google DNS
];

const dnsConfig = {
  "enable": true,
  "listen": "127.0.0.1:53",
  "ipv6": false,
  "prefer-h3": false,
  "respect-rules": true,
  "use-system-hosts": false,
  "cache-algorithm": "arc",
  "enhanced-mode": "fake-ip",
  "fake-ip-range": "198.18.0.1/16",
  "fake-ip-filter": [
    "geosite:private", // localhost / localdomain / 各家路由器后台域名
    "+.lan",
    "+.local",
    "+.msftconnecttest.com",
    "+.msftncsi.com",
    "localhost.ptlogin2.qq.com",
    "localhost.sec.qq.com",
    "+.in-addr.arpa",
    "+.ip6.arpa",
    "time.*.com",
    "time.*.gov",
    "pool.ntp.org",
    "localhost.work.weixin.qq.com"
  ],
  "default-nameserver": ["1.1.1.1", "8.8.8.8"],
  "nameserver": [], // 在 main() 中绑定独立兜底组
  "proxy-server-nameserver": [...domesticNameservers],
  "direct-nameserver": domesticNameservers.map(server => `${server}#DIRECT`),
  "direct-nameserver-follow-policy": true,
  "nameserver-policy": {
    // 局域网域名仍由系统 DNS 解析，避免路由器等本地名称失效。
    // 局域网之外由最终出口决定解析方式，bilibili 改选代理时也使用海外 DNS。
    "geosite:private": "system"
  }
};

// 建一个 url-test 自动测速组。
//
// provider 模式：节点由 use 供给，filter / exclude-filter 原样交给 mihomo，
//   由核心在运行时匹配 —— 这也是这两个字段唯一真正生效的场景。
// 单订阅模式：mihomo 的 filter 对写死在 proxies 里的节点**不生效**，只能
//   在这里先用同样的正则把节点名过滤一遍；筛不出节点就返回 null 不建这个组
//   （既没有 use 又是空 proxies 的组会让 mihomo 拒绝整份配置）。
// 把 filter 正则编译成 JS 的 RegExp。
// mihomo 用的是 Go RE2，支持 (?i) 这种内联标志；JS 的 RegExp 不认，直接
// new RegExp("(?i)…") 会抛 SyntaxError 让整个脚本挂掉。单订阅模式要在 JS
// 里自己过滤节点，所以这里把 (?i) 前缀转成 JS 的 i 标志。
function toJsRegExp(pattern) {
  if (pattern.indexOf("(?i)") === 0) return new RegExp(pattern.slice(4), "i");
  return new RegExp(pattern);
}

function buildAutoGroup(name, spec, providerNames, nodeNames) {
  const group = {
    "name": name,
    "type": "url-test",
    "url": "http://www.gstatic.com/generate_204",
    "interval": 300,
    "tolerance": 50,
    "empty-fallback": "REJECT",
    "hidden": true
  };

  if (providerNames.length) {
    // 订阅为空或筛选不到节点时保持拒绝，防止内核补入 COMPATIBLE 直连。
    group["proxies"] = ["REJECT"];
    group["use"] = providerNames;
    if (spec.filter) group["filter"] = spec.filter;
    if (spec.exclude) group["exclude-filter"] = spec.exclude;
    return group;
  }

  let matched = nodeNames;
  if (spec.filter) matched = matched.filter(n => toJsRegExp(spec.filter).test(n));
  if (spec.exclude) matched = matched.filter(n => !toJsRegExp(spec.exclude).test(n));
  if (!matched.length) return null;
  group["proxies"] = matched;
  return group;
}

// 代理策略因不支持 UDP 等原因被内核跳过时，立即拒绝同一匹配条件。
// 不能让连接继续落到后面的国内直连规则或内核默认出口。
function failClosedRules(rules) {
  return rules.flatMap(rule => {
    const parts = rule.split(",");
    const policyIndex = parts.length - (parts[parts.length - 1] === "no-resolve" ? 2 : 1);
    parts[policyIndex] = "REJECT";
    return [rule, parts.join(",")];
  });
}

// 清理代理策略可达的旧订阅子组，禁止通过嵌套分组或 direct 节点意外直连。
function hardenProxyGroups(groups, roots, directNames) {
  const byName = new Map(groups.map(group => [group.name, group]));
  const visited = new Set();
  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    const group = byName.get(name);
    if (!group) return;
    group["empty-fallback"] = "REJECT";
    group.proxies = (group.proxies || []).filter(proxy => !directNames.has(proxy));
    if (!group.proxies.includes("REJECT")) group.proxies.push("REJECT");
    group.proxies.forEach(visit);
  }
  roots.filter(Boolean).forEach(visit);
}

// Define main function (script entry)
function main(config) {
  if (!Array.isArray(config.rules)) config.rules = [];

  // ------------------------------------------------------------
  // 1. 策略组
  // ------------------------------------------------------------
  const allProviderNames = Object.keys(config["proxy-providers"] || {});
  const providerNames = allProviderNames.filter(name => name !== CLAUDE_EXIT_PROVIDER_NAME);
  const providerMode = allProviderNames.length > 0;
  allProviderNames.forEach(name => {
    const provider = config["proxy-providers"][name];
    provider["exclude-type"] = [...new Set([
      ...(provider["exclude-type"] || "").split("|").filter(Boolean), "direct"
    ])].join("|");
  });
  const directNames = new Set(["DIRECT", "COMPATIBLE"]);
  for (const proxy of config.proxies || []) {
    if (proxy && proxy.type === "direct") directNames.add(proxy.name);
  }
  config.proxies = (config.proxies || []).filter(proxy => proxy && !directNames.has(proxy.name));

  // provider 模式（Merge.yaml 里声明了机场）：节点全部由 proxy-providers
  // 供给，订阅自带的节点和策略组一律丢弃，所有组由本脚本重建。这样
  //   · 不管当前激活的是哪份配置，跑出来的结果都一致
  //   · 每个组都能同时选到所有机场的节点，不再是"切订阅二选一"
  //   · 避免当前订阅的节点被算两遍（一遍 config.proxies、一遍 provider）
  // 没有 provider 时退回老的单订阅模式：复用订阅自带的组。
  const existingGroups = providerMode ? [] : (config["proxy-groups"] || []);
  const nodeNames = providerMode
    ? []
    : config.proxies.map(p => p.name).filter(Boolean);
  if (providerMode) config.proxies = [];

  const takenNames = new Set(existingGroups.map(g => g && g.name).filter(Boolean));

  // provider 模式创建统一主组；单订阅模式识别并重命名原主组。
  const sourceMainGroup = MAIN_GROUP_CANDIDATES.find(n => takenNames.has(n)) ||
    (existingGroups.find(
      g => g && g.type === "select" && Array.isArray(g.proxies) && g.proxies.length
    ) || {}).name || null;
  const MAIN_GROUP = providerMode || sourceMainGroup ? MAIN_GROUP_NAME : null;
  const hasMainGroup = Boolean(MAIN_GROUP);
  if (!providerMode && sourceMainGroup && sourceMainGroup !== MAIN_GROUP) {
    for (const group of existingGroups) {
      if (group.name === sourceMainGroup) group.name = MAIN_GROUP;
      if (Array.isArray(group.proxies)) {
        group.proxies = group.proxies.map(name => name === sourceMainGroup ? MAIN_GROUP : name);
      }
    }
    // 保留订阅附带的链式代理、下载策略、监听入口和子规则引用。
    for (const entry of [
      ...config.proxies, ...(config.listeners || []),
      ...Object.values(config["rule-providers"] || {})
    ]) {
      for (const key of ["proxy", "dialer-proxy"]) {
        if (entry[key] === sourceMainGroup) entry[key] = MAIN_GROUP;
      }
    }
    for (const rules of Object.values(config["sub-rules"] || {})) {
      rules.forEach((rule, i) => {
        const parts = rule.split(",");
        const policyIndex = parts.length - (parts[parts.length - 1] === "no-resolve" ? 2 : 1);
        if (parts[policyIndex] === sourceMainGroup) parts[policyIndex] = MAIN_GROUP;
        rules[i] = parts.join(",");
      });
    }
    takenNames.delete(sourceMainGroup);
  }
  if (hasMainGroup) takenNames.add(MAIN_GROUP);

  // 单订阅模式下才需要动订阅自带的组：标 hidden + 给 Auto 滤掉高倍率节点。
  // provider 模式下这些组已经不存在了，对应的能力由下面 AUTO_GROUPS 重建。
  if (!providerMode) {
    for (const g of existingGroups) {
      if (g && HIDDEN_GROUPS.includes(g.name)) g.hidden = true;
    }
    const autoGroupObj = existingGroups.find(g => g && g.name === "Auto");
    if (autoGroupObj && Array.isArray(autoGroupObj.proxies)) {
      // 筛不出节点就保留原列表，不清空 —— 空组会让整份配置被拒绝
      const filtered = autoGroupObj.proxies.filter(
        n => !new RegExp(HIGH_RATIO_EXCLUDE).test(n)
      );
      if (filtered.length) autoGroupObj.proxies = filtered;
    }
  }

  // 自动测速子组（Auto / 低倍率 / 分国家）。先建好，好把组名塞进下面所有
  // 首页可见组的选项列表里当备选项。
  const autoGroups = [];
  const autoResolvedNames = [];

  for (const spec of AUTO_GROUPS) {
    // providerOnly 的组在单订阅模式下跳过（那时订阅自带 Auto，不用重复建）
    if (spec.providerOnly && !providerMode) continue;

    let name = spec.name;
    for (let i = 2; takenNames.has(name); i++) {
      name = `${spec.name}-${i}`;
    }

    const group = buildAutoGroup(name, spec, providerNames, nodeNames);
    if (!group) continue; // 单订阅模式下筛不出节点，跳过不建空组

    takenNames.add(name);
    autoResolvedNames.push(name);
    autoGroups.push(group);
  }

  // provider 模式：主组自己建，选项 = 各自动测速组 + 全部节点(use) + REJECT
  // 单订阅模式：把子组名插进订阅自带主组的选项列表里
  const createdMainGroups = [];
  if (providerMode) {
    createdMainGroups.push({
      "name": MAIN_GROUP,
      "type": "select",
      "proxies": [...autoResolvedNames, "REJECT"],
      "use": providerNames
    });

    // 全局模式用的 GLOBAL 组。mihomo 内置的 GLOBAL 是拿顶层 proxies 生成的，
    // 而 provider 模式下顶层 proxies 是空的（节点都在 provider 里），内置
    // GLOBAL 就只剩 DIRECT 和几个策略组，全局模式下选不到任何单个节点。
    // 显式定义一个同名组可以整个覆盖掉内置的（已实测：覆盖生效，且能通过
    // use 拿到 provider 的全部节点）。
    createdMainGroups.push({
      "name": "GLOBAL",
      "type": "select",
      "proxies": [MAIN_GROUP, ...autoResolvedNames, "REJECT"],
      "use": providerNames
    });
    takenNames.add("GLOBAL"); // 后面建站点/规则集组时别撞名
  } else if (hasMainGroup && autoResolvedNames.length) {
    const mainGroupObj = existingGroups.find(g => g && g.name === MAIN_GROUP);
    if (mainGroupObj && Array.isArray(mainGroupObj.proxies)) {
      const autoIndex = mainGroupObj.proxies.indexOf("Auto");
      const insertAt = autoIndex === -1 ? 0 : autoIndex + 1;
      mainGroupObj.proxies.splice(insertAt, 0, ...autoResolvedNames);
    }
  }

  // 兜底组可单独选节点，也可手选 🚀 main 跟随主组；保留原默认顺序。
  let fallbackName = "🐟 Fallback";
  for (let i = 2; takenNames.has(fallbackName); i++) fallbackName = `🐟 Fallback-${i}`;
  takenNames.add(fallbackName);
  const fallbackGroup = {
    name: fallbackName,
    type: "select",
    proxies: [...autoResolvedNames, ...nodeNames, "REJECT", ...(hasMainGroup ? [MAIN_GROUP] : [])]
  };
  if (providerMode) fallbackGroup.use = providerNames;
  // 没有主组时拒绝代理连接，不能借用可手动直连的兜底组作为 AI 的上游。
  const defaultProxy = hasMainGroup ? MAIN_GROUP : "REJECT";

  // 默认拒绝，可手选单个节点固定出口，或选择 🚀 main 跟随主组。
  const claudeName = CLAUDE_GROUP_NAME;
  for (const name of [claudeName, CLAUDE_EXIT_GROUP_NAME, CLAUDE_EXIT_OFF_NAME]) {
    if (takenNames.has(name) || nodeNames.includes(name)) throw new Error(`Claude 保留名称冲突：${name}`);
    takenNames.add(name);
  }
  const claudeGroup = {
    name: claudeName, type: "select", proxies: ["REJECT", ...(hasMainGroup ? [MAIN_GROUP] : []), ...nodeNames],
    "disable-udp": true
  };
  if (providerNames.length) claudeGroup.use = providerNames;
  // 仅专用 ClaudeExit 集合提供出口，机场节点不加入出口候选。
  const exitProviderNames = [];
  const source = config["proxy-providers"]?.[CLAUDE_EXIT_PROVIDER_NAME];
  if (source) {
    const name = "claude-exit-1";
    if (config["proxy-providers"][name]) throw new Error(`Claude 出口订阅名冲突：${name}`);
    const override = { ...(source.override || {}) };
    // 高级表达式不能在固定覆写之后再次清除前置。
    delete override["override-expr"];
    Object.assign(override, {
      "dialer-proxy": claudeName, udp: false,
      "additional-prefix": override["additional-prefix"] || ""
    });
    config["proxy-providers"][name] = {
      ...source, path: source.type === "file" ? source.path : "./providers/claude-exit-1.yaml", override,
      "exclude-type": [...new Set([...(source["exclude-type"] || "").split("|").filter(Boolean), "direct", "hysteria", "hysteria2", "tuic", "wireguard", "tailscale"])].join("|"),
      "health-check": { ...(source["health-check"] || {}), enable: false }
    };
    // 只保留链式副本，避免原节点与出口重名，并防止原节点被直接使用。
    delete config["proxy-providers"][CLAUDE_EXIT_PROVIDER_NAME];
    exitProviderNames.push(name);
  }
  // Exit Off 是模式标记，绝不作为实际网络出口；真正的 REJECT 始终断流。
  const exitOffGroup = { name: CLAUDE_EXIT_OFF_NAME, type: "select", proxies: ["REJECT"], hidden: true };
  const claudeExitGroup = {
    name: CLAUDE_EXIT_GROUP_NAME, type: "select",
    proxies: [CLAUDE_EXIT_OFF_NAME, "REJECT"], "disable-udp": true
  };
  if (exitProviderNames.length) claudeExitGroup.use = exitProviderNames;
  // 内部 HTTP 出站只连接本机转发层，不加入主组候选，避免形成代理环路。
  let claudeIPv4Name = "Claude IPv4 relay";
  for (let i = 2; takenNames.has(claudeIPv4Name) || nodeNames.includes(claudeIPv4Name); i++) claudeIPv4Name = `Claude IPv4 relay-${i}`;
  takenNames.add(claudeIPv4Name);
  config.proxies.push({ name: claudeIPv4Name, type: "http", server: "127.0.0.1", port: CLAUDE_IPV4_RELAY_PORT, udp: false });

  const newGroups = [];
  const resolvedNames = []; // 与 SITE_GROUPS 同序，存实际用上的组名

  for (const site of SITE_GROUPS) {
    // 万一订阅里已经有同名组，加后缀避让；重名会让整份配置加载失败
    let name = site.name;
    for (let i = 2; takenNames.has(name); i++) {
      name = `${site.name}-${i}`;
    }
    takenNames.add(name);
    resolvedNames.push(name);

    // 第一项是新组的默认选项：bilibili 默认直连，其余站点跟随主组。
    const options = site.defaultPolicy === "DIRECT" ? ["DIRECT"] : [];
    options.push(defaultProxy);
    options.push(...autoResolvedNames);
    options.push(...nodeNames);
    options.push("REJECT");

    const group = { "name": name, "type": "select", "proxies": options };
    if (providerNames.length) group["use"] = providerNames;
    newGroups.push(group);
  }

  // rule-provider 驱动的组（AI / Telegram / iCloud）各建一个 select 组，
  // 逻辑跟上面站点组一致
  const providerGroups = [];
  const providerResolvedNames = [];

  for (const rs of PROVIDER_GROUPS) {
    if (rs.policy) {
      providerResolvedNames.push(rs.policy);
      continue;
    }
    let name = rs.name;
    for (let i = 2; takenNames.has(name); i++) {
      name = `${rs.name}-${i}`;
    }
    takenNames.add(name);
    providerResolvedNames.push(name);

    const options = [];
    options.push(defaultProxy, ...autoResolvedNames, ...nodeNames, "REJECT");

    const group = { "name": name, "type": "select", "proxies": options };
    if (rs.provider === "ai-global") group["disable-udp"] = true;
    if (providerNames.length) group["use"] = providerNames;
    providerGroups.push(group);
  }

  // 顺序即首页展示顺序：主组打头，自动测速子组是 hidden 的放最后
  config["proxy-groups"] = [
    ...existingGroups,
    ...createdMainGroups,
    fallbackGroup,
    claudeGroup,
    claudeExitGroup,
    exitOffGroup,
    ...newGroups,
    ...providerGroups,
    ...autoGroups
  ];
  hardenProxyGroups(config["proxy-groups"], [
    MAIN_GROUP, "GLOBAL", fallbackName, claudeName, CLAUDE_EXIT_GROUP_NAME, CLAUDE_EXIT_OFF_NAME,
    ...resolvedNames.filter((_, i) => SITE_GROUPS[i].defaultPolicy !== "DIRECT"),
    ...providerResolvedNames.filter(name => name !== "DIRECT")
  ], directNames);
  // 手动直连例外在清理后加入，排在 REJECT 之后；缺少节点时仍默认拒绝。
  // 兜底选择只影响未匹配流量，iCloud 选择只影响其专属规则。
  fallbackGroup.proxies.push("DIRECT");
  PROVIDER_GROUPS.forEach((rs, i) => {
    if (!rs.allowDirect) return;
    const group = providerGroups.find(group => group.name === providerResolvedNames[i]);
    if (group) group.proxies.push("DIRECT");
  });

  // 声明规则集，按各自格式加载，并由 mihomo 按 interval 自动更新。
  // 下载经主代理组，避免规则源连接受新加入的国内名单影响。
  const ruleProviders = {};
  [...PROVIDER_GROUPS, ...FIXED_RULE_SETS, ...DOMESTIC_RULE_SETS].forEach(rs => {
    const format = rs.format || "yaml";
    const extension = format === "text" ? "txt" : format;
    ruleProviders[rs.provider] = {
      type: "http",
      behavior: rs.behavior || "classical",
      format,
      url: rs.url,
      path: `./rules/${rs.provider}.${extension}`,
      interval: rs.interval || 86400,
      proxy: defaultProxy
    };
  });
  // 上游 AI 集含 Cursor 的整应用规则。原源继续自动更新，辅助进程仅过滤
  // Cursor / Terminal 的 PROCESS 条目；域名/IP 及其他应用条目保持原样。
  ruleProviders["ai-global-source"] = ruleProviders["ai-global"];
  ruleProviders["ai-global"] = {
    type: "file", behavior: "classical", format: "yaml",
    path: "./profiles/ai-global-services.yaml", interval: 60
  };
  config["rule-providers"] = { ...(config["rule-providers"] || {}), ...ruleProviders };

  // ------------------------------------------------------------
  // 2. 站点独立分组的分流规则
  // ------------------------------------------------------------
  const siteRules = SITE_GROUPS.flatMap(
    (site, i) => site.afterProviderRules
      ? []
      : site.matchers.map(m => `${m},${resolvedNames[i]}`)
  );
  // google.com 同时覆盖 gemini.google.com；把 Google 域名规则放在
  // ai-global 之后，才能继续让 Gemini 等 AI 域名优先走「🤖 AI」。
  const deferredSiteRules = SITE_GROUPS.flatMap(
    (site, i) => site.afterProviderRules
      ? site.matchers.map(m => `${m},${resolvedNames[i]}`)
      : []
  );

  // 域名规则保留服务专属策略；Telegram 等纯 IP 规则留到 IP 阶段，
  // 避免未匹配国内域名前就触发解析。
  const buildProviderRules = (rs, i) => [
    `RULE-SET,${rs.provider},${providerResolvedNames[i]}`,
    ...(rs.extraMatchers || []).map(m => `${m},${providerResolvedNames[i]}`)
  ];
  const domesticAIRules = PROVIDER_GROUPS.flatMap((rs, i) =>
    rs.provider === "ai-cn" ? buildProviderRules(rs, i) : []
  );
  const overseasAIRules = PROVIDER_GROUPS.flatMap((rs, i) =>
    rs.provider === "ai-global" ? buildProviderRules(rs, i) : []
  );
  const providerRules = PROVIDER_GROUPS.flatMap((rs, i) =>
    rs.behavior === "ipcidr" || ["ai-cn", "ai-global"].includes(rs.provider)
      ? [] : buildProviderRules(rs, i)
  );
  const providerIPRules = PROVIDER_GROUPS.flatMap((rs, i) =>
    rs.behavior === "ipcidr" ? buildProviderRules(rs, i) : []
  );

  // ------------------------------------------------------------
  // 3. 广告优先拦截，Apple 保留固定直连策略
  // ------------------------------------------------------------
  const rejectRules = FIXED_RULE_SETS.filter(rs => rs.policy === "REJECT")
    .map(rs => `RULE-SET,${rs.provider},${rs.policy}`);
  const fixedRules = FIXED_RULE_SETS.filter(rs => rs.policy !== "REJECT")
    .map(rs => `RULE-SET,${rs.provider},${rs.policy}`);
  const proxyExceptionRules = PROXY_EXCEPTION_DOMAINS.map(
    domain => `DOMAIN-SUFFIX,${domain},${defaultProxy}`
  );

  // ------------------------------------------------------------
  // 4. 本地域名直连
  //    路由器后台 (miwifi.com)、localhost、localdomain 等
  // ------------------------------------------------------------
  const localRules = [
    "GEOSITE,private,DIRECT",
    "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
    "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
    "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR6,::1/128,DIRECT,no-resolve",
    "IP-CIDR6,fe80::/10,DIRECT,no-resolve",
    "IP-CIDR6,fc00::/7,DIRECT,no-resolve"
  ];

  // 小米官网、账号及 MiMo 官网、开放平台/API、桌面端、MiMo Code。
  // 已收录的国内模型由前方国内 AI 规则优先匹配。
  const xiaomiDirectRules = [
    "DOMAIN-SUFFIX,mi.com,DIRECT",
    "DOMAIN-SUFFIX,xiaomi.com,DIRECT",
    "DOMAIN-SUFFIX,xiaomimimo.com,DIRECT",
    "DOMAIN-SUFFIX,miui.com,DIRECT",
    "DOMAIN-SUFFIX,miwifi.com,DIRECT"
  ];

  // ------------------------------------------------------------
  // 5. 国内规则集和 IP 兜底
  // ------------------------------------------------------------
  const domesticRules = DOMESTIC_RULE_SETS.map(rs => `RULE-SET,${rs.provider},DIRECT`);

  const ipRules = [
    // 国内 IP。不加 no-resolve —— 需对带域名的连接解析后再判断归属
    "GEOIP,CN,DIRECT"
  ];

  // 微信桌面端还会直接连接腾讯的海外 CDN IP（没有可供域名规则匹配的主机名，
  // 且不会命中 GEOIP,CN）。按进程直连可覆盖这些连接，又不影响其他应用。
  const wechatRules = [
    "PROCESS-NAME,WeChat,DIRECT",
    "PROCESS-NAME,WeChatAppEx Helper,DIRECT"
  ];

  // Claude 进程规则先于普通国内名单，避免其辅助请求被共享 CDN 直连规则抢走。
  // Terminal / Cursor 不设置整应用默认策略，其请求与其他应用共用完整规则。
  // 国内AI已在应用规则前固定直连，包括 Claude Code 改用国内模型的情况。
  const buildAppRules = (apps, policy) => apps.flatMap(app => [
    `PROCESS-PATH-REGEX,${app.path},${policy}`,
    `PROCESS-NAME-REGEX,${app.process},${policy}`
  ]);
  const claudeAppRules = buildAppRules(CLAUDE_APPS, claudeIPv4Name);
  const claudeDomainRules = CLAUDE_DOMAIN_MATCHERS.map(m => `${m},${claudeIPv4Name}`);
  const claudeIPRules = CLAUDE_IP_MATCHERS.map(m => `${m},${claudeIPv4Name},no-resolve`);
  const claudeRules = [...claudeDomainRules, ...claudeAppRules, ...claudeIPRules];

  // 在国内 AI 直连及应用分流前拦截业务 UDP，防止 QUIC 提前命中直连。
  // 网络条件放在前面，TCP 请求不再检查这些拦截条件。
  const aiUdpRejectRules = [...domesticAIRules, ...overseasAIRules, ...claudeDomainRules, ...claudeAppRules].map(rule => {
    const matcher = rule.slice(0, rule.lastIndexOf(","));
    return `AND,((NETWORK,udp),(${matcher})),REJECT`;
  });

  // 终端入口不绑定单一策略或子规则，与 TUN / 普通代理入口共用完整主规则。
  // Shell 引用见 terminal-ai-proxy.zsh；国内、Claude、AI、站点组和兜底保持一致。
  const managedNames = [TERMINAL_AI_NAME, CLAUDE_IPV4_UPSTREAM_NAME, CLAUDE_EXIT_UPSTREAM_NAME];
  const listeners = (config.listeners || []).filter(listener => !managedNames.includes(listener.name));
  const mainPorts = [config.port, config["socks-port"], config["mixed-port"], config["redir-port"], config["tproxy-port"]];
  for (const port of [TERMINAL_AI_PORT, CLAUDE_IPV4_RELAY_PORT, CLAUDE_IPV4_UPSTREAM_PORT, CLAUDE_EXIT_UPSTREAM_PORT]) {
    if (listeners.some(listener => String(listener.port) === String(port)) || mainPorts.some(value => String(value) === String(port))) {
      throw new Error(`本机 AI 端口 ${port} 与已有代理入口冲突`);
    }
  }
  config.listeners = [...listeners, {
    name: TERMINAL_AI_NAME, type: "mixed", listen: "127.0.0.1", port: TERMINAL_AI_PORT
  }, {
    // 仅辅助进程使用：跳过主规则，防止按 Claude 域名/IP 再次回到转发层。
    // 主入口已先处理国内 AI 直连，此入口仅负责选定节点的上游连接。
    name: CLAUDE_IPV4_UPSTREAM_NAME, type: "mixed", listen: "127.0.0.1", port: CLAUDE_IPV4_UPSTREAM_PORT,
    proxy: claudeName
  }, {
    name: CLAUDE_EXIT_UPSTREAM_NAME, type: "mixed", listen: "127.0.0.1", port: CLAUDE_EXIT_UPSTREAM_PORT,
    proxy: CLAUDE_EXIT_GROUP_NAME
  }];
  // 清理旧版终端专用子规则，保留用户或订阅的其他子规则。
  const subRules = { ...(config["sub-rules"] || {}) };
  delete subRules[TERMINAL_AI_NAME];
  if (Object.keys(subRules).length) config["sub-rules"] = subRules;
  else delete config["sub-rules"];

  // ------------------------------------------------------------
  // 6. 兜底：独立选择节点。无节点、节点不支持 UDP 或其他异常均拒绝。
  // ------------------------------------------------------------
  const catchAllRule = [
    ...failClosedRules([`MATCH,${fallbackName}`])
  ];

  // ------------------------------------------------------------
  // 7. 合并规则，覆盖订阅原有的规则列表
  //    顺序：广告 > 本地 > AI UDP 拦截 > 国内AI > Claude > 代理例外 > 🤖 AI > Apple/小米
  //         > 站点/iCloud/Google > 微信 > 国内域名 > Telegram IP > 国内IP > 兜底。
  //    Google 放在 AI 规则集之后，确保 gemini.google.com 仍优先归入「🤖 AI」。
  // ------------------------------------------------------------
  config.rules = [
    ...rejectRules,
    ...localRules,
    ...aiUdpRejectRules,
    ...domesticAIRules,
    ...failClosedRules(claudeRules),
    ...failClosedRules(proxyExceptionRules),
    ...failClosedRules(overseasAIRules),
    ...fixedRules,
    ...xiaomiDirectRules,
    ...failClosedRules(siteRules),
    ...failClosedRules(providerRules),
    ...failClosedRules(deferredSiteRules),
    ...wechatRules,
    ...domesticRules,
    ...failClosedRules(providerIPRules),
    ...ipRules,
    ...catchAllRule
  ];

  // 8. 默认海外 DoH 跟随兜底组，避免未匹配流量仍依赖 🚀 main 的节点选择。
  //    DIRECT 出口单独使用国内 DoH。
  const dnsProxy = `#${fallbackName}`;
  config.dns = {
    ...dnsConfig,
    "nameserver": foreignNameservers.map(server => `${server}${dnsProxy}`)
  };

  // 保留 TUN 域名嗅探；本机代理连接使用明确传入的目标，防止 IPv4 被 SNI 改回域名。
  config.sniffer = {
    ...(config.sniffer || {}),
    "skip-src-address": [...new Set([...(config.sniffer?.["skip-src-address"] || []), "127.0.0.1/32"])]
  };

  // 进程分流保护依赖内核运行，不能替代系统级出站控制。
  config.mode = "rule";
  config["find-process-mode"] = "always";
  // TUN 开关、DNS 劫持和严格路由由 Clash Verge 设置管理，脚本不写入 tun。

  return config;
}

// —— Claude IPv4 辅助进程（Node.js；Clash 脚本引擎不会执行这一部分）——
// CONNECT 的 TLS 数据原样转发，不解密对话。DNS 和目标连接都只经本机专用上游。
function readClaudeRoute(options = {}) {
  const http = require("node:http");
  const socketPath = options.socketPath || process.env.CLAUDE_CONTROLLER_SOCKET || `/var/run/clash-verge-service/users/${process.getuid()}/verge-mihomo.sock`;
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const timer = setTimeout(() => finish(new Error("Claude route lookup timeout")), 2000);
    function finish(error, value) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { if (request) request.destroy(); reject(error); } else resolve(value);
    }
    request = http.get({ socketPath, path: "/proxies", agent: false }, response => {
      if (response.statusCode !== 200) { response.resume(); return finish(new Error("Claude route unavailable")); }
      let size = 0;
      const chunks = [];
      response.on("data", chunk => {
        size += chunk.length;
        if (size > 2097152) return finish(new Error("invalid route response"));
        chunks.push(chunk);
      });
      response.once("error", finish);
      response.once("end", () => {
        try {
          const proxies = JSON.parse(Buffer.concat(chunks).toString("utf8")).proxies;
          const exit = proxies?.[CLAUDE_EXIT_GROUP_NAME];
          if (exit?.type !== "Selector" || typeof exit.now !== "string" || !exit.all?.includes(exit.now)) throw new Error("Claude Exit selection missing");
          const transit = proxies?.[CLAUDE_GROUP_NAME];
          if (transit?.type !== "Selector" || typeof transit.now !== "string" || !transit.all?.includes(transit.now)) throw new Error("Claude transit selection missing");
          const trace = [];
          const seen = new Set();
          let name = CLAUDE_GROUP_NAME;
          while (name) {
            if (seen.has(name) || trace.length >= 12 || ["DIRECT", "COMPATIBLE", "REJECT", "REJECT-DROP", CLAUDE_EXIT_GROUP_NAME, CLAUDE_EXIT_OFF_NAME].includes(name)) throw new Error("Claude transit rejected");
            seen.add(name);trace.push(name);
            const proxy = proxies[name];
            if (proxy && ["Direct", "Compatible", "Reject", "RejectDrop"].includes(proxy.type)) throw new Error("Claude transit rejected");
            name = proxy?.now || null;
          }
          if (exit.now === "REJECT") throw new Error("Claude Exit rejected");
          const off = exit.now === CLAUDE_EXIT_OFF_NAME;
          if (!off && ["DIRECT", "COMPATIBLE", "REJECT-DROP"].includes(exit.now)) throw new Error("invalid Claude Exit selection");
          finish(null, {
            port: off ? CLAUDE_IPV4_UPSTREAM_PORT : CLAUDE_EXIT_UPSTREAM_PORT,
            key: JSON.stringify([exit.now, trace])
          });
        } catch (error) { finish(error); }
      });
    });
    request.once("error", finish);
  });
}

function createClaudeIPv4Relay(options = {}) {
  const http = require("node:http");
  const https = require("node:https");
  const net = require("node:net");
  const tls = require("node:tls");
  const selectRoute = options.selectRoute || (() => readClaudeRoute({ socketPath: options.controllerSocket }));
  const singlePort = options.upstreamPort || CLAUDE_IPV4_UPSTREAM_PORT;
  const chainPort = options.exitUpstreamPort || CLAUDE_EXIT_UPSTREAM_PORT;
  function routePort(route) { return route.port === CLAUDE_IPV4_UPSTREAM_PORT ? singlePort : chainPort; }
  const listenPort = options.listenPort || CLAUDE_IPV4_RELAY_PORT;
  const cache = new Map();
  const pending = new Map();
  const sockets = new Set();
  const timeout = options.timeout || 10000;

  function tunnel(host, port, route) {
    return new Promise((resolve, reject) => {
      // 始终连接回环地址；上游不可用时不尝试任何直连。
      const socket = net.createConnection({ host: "127.0.0.1", port: routePort(route) });
      const timer = setTimeout(() => fail(new Error("upstream timeout")), timeout);
      let header = Buffer.alloc(0);
      function fail(error) {
        clearTimeout(timer); socket.destroy(); reject(error);
      }
      socket.once("error", fail);
      socket.once("connect", () => socket.write(
        `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\nConnection: keep-alive\r\n\r\n`
      ));
      function onData(chunk) {
        header = Buffer.concat([header, chunk]);
        if (header.length > 16384) return fail(new Error("invalid upstream response"));
        const end = header.indexOf("\r\n\r\n");
        if (end < 0) return;
        if (!/^HTTP\/1\.[01] 200(?: |\r)/.test(header.toString("ascii", 0, end))) {
          return fail(new Error("upstream rejected CONNECT"));
        }
        clearTimeout(timer);
        socket.removeListener("data", onData);
        socket.removeListener("error", fail);
        socket.pause();
        if (header.length > end + 4) socket.unshift(header.subarray(end + 4));
        resolve(socket);
      }
      socket.on("data", onData);
      socket.once("end", () => { if (socket.listenerCount("data")) fail(new Error("upstream closed")); });
    });
  }

  function doh(server, host, route) {
    return new Promise((resolve, reject) => {
      const agent = new https.Agent({ keepAlive: false });
      // 覆盖唯一建连入口，HTTPS 客户端没有可用的系统直连路径。
      agent.createConnection = (_opts, callback) => {
        tunnel(server, 443, route).then(socket => {
          const secure = tls.connect({ socket, servername: server, rejectUnauthorized: true, ALPNProtocols: ["http/1.1"] });
          let called = false;
          function done(error) { if (!called) { called = true; callback(error, error ? undefined : secure); } }
          secure.once("secureConnect", () => done(null));
          secure.once("error", done);
        }, callback);
      };
      let settled = false;
      let request;
      const timer = setTimeout(() => finish(new Error("DNS timeout")), timeout);
      function finish(error, value) {
        if (settled) return;
        settled = true; clearTimeout(timer); agent.destroy();
        if (error) { if (request) request.destroy(); reject(error); } else resolve(value);
      }
      request = https.get({
        hostname: server, path: `${server === "dns.google" ? "/resolve" : "/dns-query"}?name=${encodeURIComponent(host)}&type=A`,
        headers: { Accept: "application/dns-json" }, agent
      }, response => {
        if (response.statusCode !== 200) { response.resume(); return finish(new Error("DNS HTTP error")); }
        let size = 0;
        const chunks = [];
        response.on("data", chunk => {
          size += chunk.length;
          if (size > 262144) return finish(new Error("DNS response too large"));
          chunks.push(chunk);
        });
        response.once("error", finish);
        response.once("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (data.Status !== 0) throw new Error("DNS lookup failed");
            const answers = (data.Answer || []).filter(answer => answer.type === 1 && net.isIPv4(answer.data));
            if (!answers.length) throw new Error("no IPv4 address");
            const ttls = (data.Answer || []).filter(answer => answer.type === 1 || answer.type === 5)
              .map(answer => Number(answer.TTL)).filter(value => Number.isFinite(value) && value >= 0);
            finish(null, { addresses: [...new Set(answers.map(answer => answer.data))], ttl: ttls.length ? Math.min(...ttls) : 30 });
          } catch (error) { finish(error); }
        });
      });
      request.once("error", finish);
    });
  }

  async function lookup(host, route) {
    const cacheKey = `${route.key}\n${host}`;
    const saved = cache.get(cacheKey);
    if (saved && saved.expires > Date.now()) return saved.addresses;
    if (pending.has(cacheKey)) return pending.get(cacheKey);
    const job = (async () => {
      let result;
      if (options.resolveA) result = await options.resolveA(host);
      else {
        // 两个加密 DNS 均走选定的单跳／链式路径；无本地 DNS / AAAA 回退。
        for (const server of ["cloudflare-dns.com", "dns.google"]) {
          try { result = await doh(server, host, route); break; } catch {}
        }
      }
      if (!result || !Array.isArray(result.addresses) || !result.addresses.length || !result.addresses.every(net.isIPv4)) throw new Error("IPv4 DNS unavailable");
      const ttlValue = Number(result.ttl);
      const ttl = Number.isFinite(ttlValue) && ttlValue >= 0 ? Math.min(ttlValue, 300) : 30;
      if (cache.size >= 512) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, { addresses: result.addresses, expires: Date.now() + ttl * 1000 });
      return result.addresses;
    })();
    pending.set(cacheKey, job);
    try { return await job; } finally { pending.delete(cacheKey); }
  }

  function publicIPv4(ip) {
    if (!net.isIPv4(ip)) return false;
    const [a, b] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }

  const server = http.createServer((_request, response) => {
    response.writeHead(405, { Connection: "close" }); response.end();
  });
  server.headersTimeout = timeout;
  server.on("connection", socket => {
    sockets.add(socket); socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => {});
  });
  server.on("connect", async (request, client, head) => {
    client.pause();
    let remote;
    try {
      if (request.url.length > 300 || !/^[A-Za-z0-9.-]+:\d{1,5}$/.test(request.url)) throw new Error("invalid target");
      const split = request.url.lastIndexOf(":");
      const host = request.url.slice(0, split).toLowerCase().replace(/\.$/, "");
      const port = Number(request.url.slice(split + 1));
      if (host.length > 253 || !host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid target");
      const route = await selectRoute();
      const addresses = net.isIPv4(host) ? [host] : await lookup(host, route);
      // 解析期间选项变化则拒绝本次请求，供应用重新建立连接，不跨模式回退。
      if ((await selectRoute()).key !== route.key) throw new Error("Claude selection changed");
      const eligible = addresses.filter(publicIPv4).slice(0, 4);
      for (const ip of eligible) {
        if (client.destroyed) return;
        try { remote = await tunnel(ip, port, route); break; } catch {}
      }
      if (!remote) throw new Error("IPv4 upstream unavailable");
      if (client.destroyed) { remote.destroy(); return; }
      remote.on("error", () => client.destroy());
      client.once("close", () => remote.destroy());
      remote.once("close", () => client.destroy());
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) remote.write(head);
      client.pipe(remote); remote.pipe(client); client.resume(); remote.resume();
    } catch {
      if (remote) remote.destroy();
      if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    }
  });
  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(listenPort, "127.0.0.1", () => { server.removeListener("error", reject); resolve(server.address()); });
    }),
    close: () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); })
  };
}

// 派生 AI 集只去掉终端/编辑器的宽泛进程条目，不修改域名和 IP 覆盖。
function syncAIServiceRules(options = {}) {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = options.source || path.resolve(__dirname, "..", "rules", "ai-global.yaml");
  const target = options.target || path.join(__dirname, "ai-global-services.yaml");
  if (!fs.existsSync(source)) {
    if (!options.seed) throw new Error("AI 源规则缓存尚未生成");
    // 首次安装从正在运行的本机 Clash 下载，禁止无代理的网络回退。
    const child = require("node:child_process");
    const fetched = child.spawnSync("/usr/bin/curl", [
      "--fail", "--silent", "--show-error", "--max-time", "20", "--noproxy", "",
      "--proxy", "http://127.0.0.1:7897",
      "https://cdn.jsdelivr.net/gh/VPSDance/ai-proxy-rules@main/rules/clash/global.yaml"
    ], { encoding: "utf8", maxBuffer: 1048576 });
    if (fetched.status !== 0 || !/^payload:/m.test(fetched.stdout)) throw new Error("请先运行可用的 Clash 代理，再安装辅助进程");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, fetched.stdout, { mode: 0o600 });
  }
  const text = fs.readFileSync(source, "utf8");
  if (!/^payload:/m.test(text) || !/^\s*-\s*['"]?DOMAIN(?:-SUFFIX)?,/m.test(text)) throw new Error("AI 源规则格式无效");
  const lines = text.split("\n");
  const filtered = lines.filter(line => !/^\s*-\s*['"]?PROCESS-(?:NAME|PATH)(?:-REGEX|-WILDCARD)?,.*(?:cursor|terminal)/i.test(line));
  const result = filtered.join("\n");
  let changed = true;
  try { changed = fs.readFileSync(target, "utf8") !== result; } catch {}
  if (changed) {
    const next = `${target}.next-${process.pid}`;
    fs.writeFileSync(next, result, { mode: 0o600 });
    fs.renameSync(next, target);
  }
  return { changed, removed: lines.length - filtered.length };
}

function installClaudeIPv4Relay() {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const child = require("node:child_process");
  if (process.platform !== "darwin") throw new Error("自动安装仅支持 macOS；其他系统请自行常驻运行 --claude-ipv4-relay");
  syncAIServiceRules({ seed: true });
  const label = "local.clash-claude-ipv4";
  const file = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
  const executable = fs.existsSync("/opt/homebrew/bin/node") ? "/opt/homebrew/bin/node" : process.execPath;
  const xml = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const text = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(executable)}</string><string>${xml(__filename)}</string><string>--claude-ipv4-relay</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>/tmp/clash-claude-ipv4.stdout.log</string>
<key>StandardErrorPath</key><string>/tmp/clash-claude-ipv4.stderr.log</string>
</dict></plist>\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode: 0o600 });
  const domain = `gui/${process.getuid()}`;
  // 已加载时直接重启任务，避免 bootout 尚未退出就 bootstrap 的注册竞态。
  const loaded = child.spawnSync("/bin/launchctl", ["print", `${domain}/${label}`], { stdio: "ignore" }).status === 0;
  const action = loaded ? ["kickstart", "-k", `${domain}/${label}`] : ["bootstrap", domain, file];
  const result = child.spawnSync("/bin/launchctl", action, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "辅助进程启动失败");
  console.log(`已安装本机 IPv4 转发辅助进程（127.0.0.1:${CLAUDE_IPV4_RELAY_PORT}）；请自行重启 Clash Verge。`);
}

if (typeof module !== "undefined" && typeof require === "function") {
  module.exports = { main, createClaudeIPv4Relay, syncAIServiceRules, readClaudeRoute };
  if (require.main === module) {
    if (process.argv[2] === "--install-claude-ipv4") installClaudeIPv4Relay();
    else if (process.argv[2] === "--claude-ipv4-relay") {
      // 使用上游最后一次成功下载的原始缓存，定期同步派生集；异常时保留旧缓存。
      syncAIServiceRules({ seed: true });
      setInterval(() => { try { syncAIServiceRules(); } catch {} }, 5000).unref();
      const relay = createClaudeIPv4Relay();
      relay.listen().then(() => console.log(`Claude IPv4 relay listening on 127.0.0.1:${CLAUDE_IPV4_RELAY_PORT}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
      for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => relay.close().then(() => process.exit(0)));
    } else console.log("用法：node Script.js --install-claude-ipv4 或 --claude-ipv4-relay");
  }
}
