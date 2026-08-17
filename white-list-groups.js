// ============================================================
// 【维护流程 · 别删这段】
//
// ▍权威副本 = Clash Verge 实际读取的这个文件，改动直接改它：
//     ~/Library/Application Support/
//       io.github.clash-verge-rev.clash-verge-rev/profiles/Script.js
//
// ▍GitHub 备份（两边文件名不同，属正常，路径是 API 参数决定的）：
//     tjlpow/clash-verge-scripts  →  white-list-groups.js
//     https://github.com/tjlpow/clash-verge-scripts/blob/main/white-list-groups.js
//
// ▍本机没有 git 克隆，别去找 .git 目录。用 GitHub Contents API 单文件推送：
//
//     cd ~/Library/Application\ Support/\
//     io.github.clash-verge-rev.clash-verge-rev/profiles
//
//     REPO=tjlpow/clash-verge-scripts
//     PATH_IN_REPO=white-list-groups.js
//     SHA=$(gh api repos/$REPO/contents/$PATH_IN_REPO --jq .sha)
//     gh api --method PUT repos/$REPO/contents/$PATH_IN_REPO \
//       -f message="改动说明" \
//       -f content="$(base64 -i Script.js)" \
//       -f sha="$SHA"
//
//   （SHA 是并发保护：远程有更新时会 409 冲突，重新取 SHA 再推即可）
//
// ▍改完在 Clash Verge 里重载配置才生效。
//
// ⚠️ 改动前先关掉 Clash Verge 自带的脚本编辑器窗口 ——
//    在它里面点保存会覆盖掉磁盘上的改动。
//
// ▍若把本文件换成别的版本（如不带策略组的 white-list.js），
//   记得同步改上面的 PATH_IN_REPO，否则会推错文件。
// ============================================================

// ============================================================
// Clash Verge 外部脚本
//   白名单直连 + 防 DNS 泄漏 + 广告拦截
//   + YouTube / X / 国外AI / 国内AI / Telegram / iCloud 独立策略组
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
// 各组均为 select，默认选中主组；在 Clash Verge「代理」页手动切换后
// 才会分流到不同节点。
//
// 各项配置的取舍理由记在提交历史里，不在本文件重复：
//   https://github.com/tjlpow/clash-verge-scripts/commits/main/white-list-groups.js
// ============================================================

// —— 主代理组名 ——
// 不同机场订阅的主组叫法不一样（Proxy / Proxies / 节点选择 …），写死一个
// 名字换订阅就会炸：兜底规则 MATCH 指向不存在的组时，mihomo 会直接拒绝
// 整份配置（报 "proxy [xxx] not found"，变更被撤销）。
// 所以按下面的顺序找第一个真实存在的组，都没有再退回订阅里第一个 select 组。
const MAIN_GROUP_CANDIDATES = [
  "Proxy", "Proxies", "PROXY",
  "节点选择", "🚀 节点选择", "手动切换", "代理模式",
  "✈️Final", "Final", "GLOBAL"
];

// —— 需要独立选节点的站点 ——
// name     : 生成的策略组名，会出现在「代理」页里
// matchers : 匹配规则，策略由脚本自动补上组名
const SITE_GROUPS = [
  {
    name: "YouTube",
    matchers: ["GEOSITE,youtube"]
  },
  {
    name: "X",
    matchers: ["GEOSITE,twitter"]            // x.com / twitter.com / t.co
  }
];

// —— 首页不单独显示的组名 ——
// 订阅自带的 "Auto" 只想当 Proxy 的备选项，不需要单独占一个首页 tile。
// 2026-08-15 已实测 Clash Verge 会认这个字段，首页确实不显示了。
const HIDDEN_GROUPS = ["Auto"];

// —— 自动测速子组（url-test：在筛出来的节点里自动选延迟最低的）——
// 都不在首页单独显示（hidden: true），只作为其他组的备选项出现。
//
// filter / exclude 都是正则，交给 mihomo 按节点名匹配。注意 mihomo 用的是
// Go 的 RE2，**不支持** (?!...) 这类先行断言，只能用「正向匹配 + 反向排除」
// 两个字段配合，别想着写一条否定正则。
//
// 两个机场的节点命名完全不同，所以 filter 要同时覆盖两种写法：
//   TrojanFlare  日本-TY-3-流量倍率:0.6
//   ImmTelecom   🇯🇵 JPN 01
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
// behavior : classical(域名/混合规则，默认) 或 ipcidr(纯 CIDR 列表)
//
// 来源：
//   AI 服务    https://github.com/VPSDance/ai-proxy-rules（main 分支）
//   Telegram / iCloud  https://github.com/Loyalsoldier/clash-rules
//     （release 分支才是每日自动构建的产物，master/main 只有生成源码，
//      千万别指错分支，否则拿到的东西不会自动更新）
// 都是 rule-provider，按 interval 自动刷新，不需要这个脚本重跑。
// 国内AI组的域名解析到国内 IP 时会先被第 6 步的 GEOIP,CN,DIRECT 命中，
// 所以下面这些规则都必须排在它前面，否则对应的组形同虚设选不了节点。
//
// 默认用 cdn.jsdelivr.net（2026-08-14 测过能连，最快）。mihomo 不支持
// 一个 url 填多个地址自动轮询，连不上时手动把下面 url 里的域名换成：
//   testingcf.jsdelivr.net / fastly.jsdelivr.net / cdn.jsdmirror.com
// 换完只需替换域名，路径不用动。
const PROVIDER_GROUPS = [
  {
    name: "国外AI",
    provider: "ai-global",
    url: "https://cdn.jsdelivr.net/gh/VPSDance/ai-proxy-rules@main/rules/clash/global.yaml",

    // extraMatchers：规则集之外再补的规则，指向同一个组。规则集本身照常
    // 从上游自动更新，这几条只是叠加上去。
    //
    // 为什么要补 —— Google 搜索里的 AI mode 不是独立域名，走的就是搜索
    // 本体 www.google.com，ai-proxy-rules 里没有，不补的话会落到最后的
    // MATCH 用主组的出口 IP。而 AI mode 能不能用只看 Google 在搜索会话
    // 里看到的 IP 干不干净（旧机场的 IP 被 Google 判成国内，用不了；新
    // 机场的可以），所以搜索本体必须跟 gemini 走同一个组、同一个出口。
    // 2026-08-17 实测分流：
    //   gemini.google.com → RuleSet(ai-global) → 国外AI ✅
    //   www.google.com    → Match()            → Proxy ❌ 就是这里漏了
    //
    // DOMAIN-SUFFIX,google.com 一条就覆盖了 www / *.clients6（AI mode 用到的
    // appsgenaiserver-pa、waa-pa 都在这下面）/ play / docs 等全部子域。
    // 副作用：Gmail、Docs、Play 这些也会跟着走国外AI组 —— 这其实是好事，
    // 同一个 Google 账号的流量走同一个出口，不容易被判成异常会话。
    // YouTube 不受影响，GEOSITE,youtube 规则排在这些之前，仍走自己的组。
    extraMatchers: [
      "DOMAIN-SUFFIX,google.com",
      "DOMAIN-SUFFIX,google.com.hk",
      "DOMAIN-SUFFIX,google.co.jp",
      "DOMAIN-SUFFIX,gstatic.com",          // fonts.gstatic.com 等搜索页静态资源
      "DOMAIN-SUFFIX,googleusercontent.com" // 搜索结果里的图片、头像
    ]
  },
  {
    name: "国内AI",
    provider: "ai-cn",
    url: "https://cdn.jsdelivr.net/gh/VPSDance/ai-proxy-rules@main/rules/clash/cn.yaml"
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
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/icloud.txt"
  }
];

// —— 固定策略的规则集（不建组，命中直接执行固定策略，不用手动选节点）——
// apple    : Apple 通用 CDN / 系统更新等大流量静态资源，直连更快也不占代理流量
// ad-reject: 广告 / 追踪器域名，直接拒绝连接
const FIXED_RULE_SETS = [
  {
    provider: "apple",
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/apple.txt",
    policy: "DIRECT"
  },
  {
    provider: "ad-reject",
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt",
    policy: "REJECT"
  }
];

// —— 防 DNS 泄漏配置 ——
// fake-ip + respect-rules：DNS 查询也按分流规则走，国内域名用国内 DoH
// 直连解析，国外域名走代理 DoH 解析。需配合 TUN 模式才彻底生效。
const domesticNameservers = [
  "https://223.5.5.5/dns-query", // 阿里 DoH
  "https://doh.pub/dns-query"    // 腾讯 DoH
];

const foreignNameservers = [
  "https://208.67.222.222/dns-query", // OpenDNS
  "https://77.88.8.8/dns-query",      // Yandex DNS
  "https://1.1.1.1/dns-query",        // Cloudflare DNS
  "https://8.8.4.4/dns-query"         // Google DNS
];

const dnsConfig = {
  "enable": true,
  "listen": "127.0.0.1:1053", // 仅本机；要共享给局域网设备才改 0.0.0.0:1053
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
  "default-nameserver": ["223.5.5.5", "1.2.4.8"],
  "nameserver": [...foreignNameservers],
  "proxy-server-nameserver": [...domesticNameservers],
  "direct-nameserver": [...domesticNameservers],
  "nameserver-policy": {
    // 逗号键合法，mihomo 会展开成 geosite:private 与 geosite:cn 两条
    "geosite:private,cn": domesticNameservers
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
    "hidden": true
  };

  if (providerNames.length) {
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

// Define main function (script entry)
function main(config) {
  if (!config.rules) return config;

  // ------------------------------------------------------------
  // 1. 策略组
  // ------------------------------------------------------------
  const providerNames = Object.keys(config["proxy-providers"] || {});
  const providerMode = providerNames.length > 0;

  // provider 模式（Merge.yaml 里声明了机场）：节点全部由 proxy-providers
  // 供给，订阅自带的节点和策略组一律丢弃，所有组由本脚本重建。这样
  //   · 不管当前激活的是哪份配置，跑出来的结果都一致
  //   · 每个组都能同时选到所有机场的节点，不再是"切订阅二选一"
  //   · 避免当前订阅的节点被算两遍（一遍 config.proxies、一遍 provider）
  // 没有 provider 时退回老的单订阅模式：复用订阅自带的组。
  const existingGroups = providerMode ? [] : (config["proxy-groups"] || []);
  const nodeNames = providerMode
    ? []
    : (config.proxies || []).map(p => p && p.name).filter(Boolean);
  if (providerMode) config.proxies = [];

  const takenNames = new Set(existingGroups.map(g => g && g.name).filter(Boolean));

  // 主组：provider 模式下订阅的组已经全丢了，自己建一个；否则按候选名单
  // 探测订阅自带的主组（不同机场叫法不一样，写死名字换订阅就会炸：兜底
  // 规则 MATCH 指向不存在的组时 mihomo 会拒绝整份配置）。
  const MAIN_GROUP = providerMode
    ? "Proxy"
    : (MAIN_GROUP_CANDIDATES.find(n => takenNames.has(n)) ||
       (existingGroups.find(
         g => g && g.type === "select" && Array.isArray(g.proxies) && g.proxies.length
       ) || {}).name ||
       null);
  const hasMainGroup = Boolean(MAIN_GROUP);
  if (providerMode) takenNames.add(MAIN_GROUP);

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

  // provider 模式：主组自己建，选项 = 各自动测速组 + DIRECT + 全部节点(use)
  // 单订阅模式：把子组名插进订阅自带主组的选项列表里
  const createdMainGroups = [];
  if (providerMode) {
    createdMainGroups.push({
      "name": MAIN_GROUP,
      "type": "select",
      "proxies": [...autoResolvedNames, "DIRECT"],
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
      "proxies": [MAIN_GROUP, ...autoResolvedNames, "DIRECT"],
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

    // 选项里的第一项就是默认选中项：默认跟随主组
    const options = [];
    if (hasMainGroup) options.push(MAIN_GROUP);
    options.push(...autoResolvedNames, "DIRECT", ...nodeNames);

    const group = { "name": name, "type": "select", "proxies": options };
    if (providerNames.length) group["use"] = providerNames;
    newGroups.push(group);
  }

  // rule-provider 驱动的组（AI / Telegram / iCloud）各建一个 select 组，
  // 逻辑跟上面站点组一致
  const providerGroups = [];
  const providerResolvedNames = [];

  for (const rs of PROVIDER_GROUPS) {
    let name = rs.name;
    for (let i = 2; takenNames.has(name); i++) {
      name = `${rs.name}-${i}`;
    }
    takenNames.add(name);
    providerResolvedNames.push(name);

    const options = [];
    if (hasMainGroup) options.push(MAIN_GROUP);
    options.push(...autoResolvedNames, "DIRECT", ...nodeNames);

    const group = { "name": name, "type": "select", "proxies": options };
    if (providerNames.length) group["use"] = providerNames;
    providerGroups.push(group);
  }

  // 顺序即首页展示顺序：主组打头，自动测速子组是 hidden 的放最后
  config["proxy-groups"] = [
    ...existingGroups,
    ...createdMainGroups,
    ...newGroups,
    ...providerGroups,
    ...autoGroups
  ];

  // 把 PROVIDER_GROUPS 和 FIXED_RULE_SETS 都声明成 rule-providers，
  // mihomo 按 interval 在后台自动刷新，不需要这个脚本重跑
  const ruleProviders = {};
  PROVIDER_GROUPS.forEach(rs => {
    ruleProviders[rs.provider] = {
      type: "http",
      behavior: rs.behavior || "classical",
      format: "yaml",
      url: rs.url,
      path: `./rules/${rs.provider}.yaml`,
      interval: 86400
    };
  });
  FIXED_RULE_SETS.forEach(rs => {
    ruleProviders[rs.provider] = {
      type: "http",
      behavior: rs.behavior || "classical",
      format: "yaml",
      url: rs.url,
      path: `./rules/${rs.provider}.yaml`,
      interval: 86400
    };
  });
  config["rule-providers"] = { ...(config["rule-providers"] || {}), ...ruleProviders };

  // ------------------------------------------------------------
  // 2. 站点独立分组的分流规则
  // ------------------------------------------------------------
  const siteRules = SITE_GROUPS.flatMap(
    (site, i) => site.matchers.map(m => `${m},${resolvedNames[i]}`)
  );

  // PROVIDER_GROUPS 对应的分流规则；必须排在第 6 步的 GEOIP,CN,DIRECT 之前，
  // 否则国内规则集（如国内AI）会先被 GEOIP 命中直连，组形同虚设选不了节点
  const providerRules = PROVIDER_GROUPS.flatMap((rs, i) => [
    `RULE-SET,${rs.provider},${providerResolvedNames[i]}`,
    ...(rs.extraMatchers || []).map(m => `${m},${providerResolvedNames[i]}`)
  ]);

  // ------------------------------------------------------------
  // 3. 固定策略规则集（广告拒绝、Apple 直连），排在最前面优先生效
  // ------------------------------------------------------------
  const fixedRules = FIXED_RULE_SETS.map(rs => `RULE-SET,${rs.provider},${rs.policy}`);

  // ------------------------------------------------------------
  // 4. 本地域名直连
  //    路由器后台 (miwifi.com)、localhost、localdomain 等
  // ------------------------------------------------------------
  const localRules = [
    "GEOSITE,private,DIRECT"
  ];

  // ------------------------------------------------------------
  // 5. 直连白名单
  // ------------------------------------------------------------
  const whitelistRules = [
    // —— 域名层 ——
    "DOMAIN-SUFFIX,baidu.com,DIRECT",
    "DOMAIN-SUFFIX,taobao.com,DIRECT",
    "DOMAIN-SUFFIX,csdn.net,DIRECT",

    // —— IP 层 ——
    // ⚠️ 不要改用 GEOSITE,cn 做国内判断：该分类混有 browserleaks / whoer /
    //    ipinfo 等境外站点，会让它们直连而暴露真实 IP。

    // 局域网 IPv4
    "IP-CIDR,192.168.0.0/16,DIRECT",
    "IP-CIDR,10.0.0.0/8,DIRECT",
    "IP-CIDR,172.16.0.0/12,DIRECT",
    "IP-CIDR,127.0.0.0/8,DIRECT",

    // 局域网 IPv6
    "IP-CIDR6,::1/128,DIRECT",   // 回环
    "IP-CIDR6,fe80::/10,DIRECT", // 链路本地
    "IP-CIDR6,fc00::/7,DIRECT",  // ULA（含 fd00::/8）

    // 国内 IP。不加 no-resolve —— 需对带域名的连接解析后再判断归属
    "GEOIP,CN,DIRECT"
  ];

  // ------------------------------------------------------------
  // 6. 兜底规则 (MATCH 必须放在最后)
  //    主组没解析出来时退回 DIRECT —— 只是保证配置能加载，这种情况下
  //    未命中的流量会全部直连（不走代理），属于异常兜底，正常不会走到
  // ------------------------------------------------------------
  const catchAllRule = [
    `MATCH,${hasMainGroup ? MAIN_GROUP : "DIRECT"}`
  ];

  // ------------------------------------------------------------
  // 7. 合并规则，覆盖订阅原有的规则列表
  //    顺序：固定策略(广告/Apple) > 本地域名 > 站点独立组 > 规则集组
  //         (AI/Telegram/iCloud) > 直连白名单 > 兜底
  // ------------------------------------------------------------
  config.rules = [
    ...fixedRules,
    ...localRules,
    ...siteRules,
    ...providerRules,
    ...whitelistRules,
    ...catchAllRule
  ];

  // 8. 覆盖 DNS 配置
  config.dns = dnsConfig;

  return config;
}
