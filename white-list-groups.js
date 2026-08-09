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
// Clash Verge 外部脚本：白名单直连 + 防 DNS 泄漏
//                      + Google Search / YouTube / X 独立策略组
//
// 基于本仓库 white-list.js，唯一的差别是多建三个 select 策略组，
// 让这三个站点可以各自单独挑节点。其余分流逻辑与 white-list.js 完全一致。
//
// Google Search 组是窄范围的：只含搜索本体、搜索页渲染资源和 Chrome，
// 目的是方便逐个节点试出哪个能用 Google 搜索的 AI Mode。
// Google 系的其他服务（Play 商店、Firebase、golang 等）不在本组，
// 仍走主组 Proxy。
//
// 三个组默认都选中主组（Proxy），也就是说刚启用时行为和 white-list.js
// 一模一样；你在 Clash Verge 的「代理」页里手动切某个组，才会生效。
// ============================================================

// —— 主代理组名 ——
// 必须是你机场订阅里真实存在的组名。若不是 "Proxy"（比如 "🚀 节点选择"），
// 改这一处即可，下面的策略组和兜底规则都会跟着变。
const MAIN_GROUP = "Proxy";

// —— 需要独立选节点的站点 ——
// name     : 生成的策略组名，会出现在 Clash Verge 的「代理」页里
// matchers : 该组的匹配规则（只写规则类型和匹配词，策略由脚本自动补上组名）
//
// ⚠️ 数组顺序 = 规则匹配顺序，不要随意调整，理由见每组注释。
const SITE_GROUPS = [
  {
    // YouTube 必须排在 Google Search 前面：
    // geosite:youtube 里有 full:yt3.googleusercontent.com、youtubei.googleapis.com
    // 这类精确条目，要先于下面 Google Search 的宽后缀匹配，否则会被抢走。
    name: "YouTube",
    matchers: ["GEOSITE,youtube"]
  },
  {
    // 刻意不用 GEOSITE,google —— 那个分类带 include:android / google-play /
    // firebase / golang / kaggle 等一大票，会把 Go 模块下载、Play 商店都拖进来。
    // 这里只保留「搜索本体 + 搜索页渲染 + Chrome」，方便单独测 AI Mode 能用的节点。
    name: "Google Search",
    matchers: [
      // —— 搜索本体：AI Mode (udm=50) 就在这个域下 ——
      // 一并覆盖 accounts / chromewebstore / dl 等所有 *.google.com 子域
      "DOMAIN-SUFFIX,google.com",
      // Google 自 2017 年起已不再跳转 ccTLD，下面两条只是保险，可按需增删
      "DOMAIN-SUFFIX,google.com.hk",
      "DOMAIN-SUFFIX,google.co.jp",

      // —— 搜索页渲染依赖 ——
      "DOMAIN-SUFFIX,gstatic.com",           // 样式 / 脚本 / 图标
      "DOMAIN-SUFFIX,googleusercontent.com", // 结果页图片、头像

      // —— Chrome 浏览器 ——
      "DOMAIN-SUFFIX,chrome.com",
      "DOMAIN-SUFFIX,chromium.org",
      "DOMAIN-SUFFIX,chromestatus.com",
      "DOMAIN-SUFFIX,chromeos.dev",
      "DOMAIN-SUFFIX,chromebook.com",
      "DOMAIN-SUFFIX,gvt1.com",              // Chrome 组件 / 扩展更新
      "DOMAIN-SUFFIX,gvt2.com",
      "DOMAIN-SUFFIX,gvt3.com"

      // 若 AI Mode 出现加载不全 / 报错，再补一条 DOMAIN-SUFFIX,googleapis.com。
      // 默认不加是因为 fonts.googleapis.com 被大量第三方站点引用，
      // 加了会把这些站点的字体请求也拖到本组选的节点上。
    ]
  },
  {
    name: "X",
    matchers: ["GEOSITE,twitter"] // x.com / twitter.com / t.co
  }
];

// —— 防 DNS 泄漏配置（取自 xiaolin-007/clash-verge-script 优化版）——
// 原理：enhanced-mode=fake-ip + respect-rules，让 DNS 查询也按分流规则走——
//        国内域名用国内 DoH 直连解析，国外域名走代理 DoH 解析，避免裸连泄漏。
// 注意：建议同时开启 Clash Verge 的 TUN 模式，DNS 接管才彻底生效。
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
  // 只监听本机回环，避免把 DNS 解析器暴露给同局域网的其他设备。
  // TUN 模式的 dns-hijack 在协议栈内部接管，不经过这个 socket，改动不影响正常使用。
  // 若确实要把本机当作局域网 DNS 共享出去，再改回 0.0.0.0:1053。
  "listen": "127.0.0.1:1053",
  "ipv6": false,
  "prefer-h3": false,
  "respect-rules": true,
  "use-system-hosts": false,
  "cache-algorithm": "arc",
  "enhanced-mode": "fake-ip",
  "fake-ip-range": "198.18.0.1/16",
  "fake-ip-filter": [
    // geosite:private 覆盖 localhost / localdomain / 各家路由器后台域名，
    // 让这些本地域名走真实解析而不是拿到 198.18.x.x 的假 IP。
    "geosite:private",
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
    // 本地域名 + 国内域名都走国内 DoH（nameserver-policy 优先级高于 nameserver，
    // 所以 baidu/taobao 这类不会先去问国外 DNS）。
    // 逗号键会被 mihomo 展开成 geosite:private 与 geosite:cn 两条，语法合法。
    // 注意：公网 DoH 解析不出 192.168.x.x，路由器后台请直接用网关 IP 访问。
    "geosite:private,cn": domesticNameservers
  }
};

// Define main function (script entry)
function main(config) {
  if (!config.rules) return config;

  // ------------------------------------------------------------
  // 1. 为三个站点各建一个 select 策略组
  // ------------------------------------------------------------
  const existingGroups = config["proxy-groups"] || [];
  const takenNames = new Set(existingGroups.map(g => g && g.name).filter(Boolean));

  // 订阅里的全部节点名；用 proxy-providers 的订阅这里可能是空的，靠下面的 use 兜底
  const nodeNames = (config.proxies || []).map(p => p && p.name).filter(Boolean);
  const providerNames = Object.keys(config["proxy-providers"] || {});

  // 主组不存在就不往选项里放，避免生成一个指向空气的策略导致配置加载失败
  const hasMainGroup = takenNames.has(MAIN_GROUP);

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

    // 选项里的第一项就是默认选中项：默认跟随主组，保持原有行为
    const options = [];
    if (hasMainGroup) options.push(MAIN_GROUP);
    options.push("DIRECT", ...nodeNames);

    const group = { "name": name, "type": "select", "proxies": options };
    if (providerNames.length) group["use"] = providerNames;
    newGroups.push(group);
  }

  config["proxy-groups"] = [...existingGroups, ...newGroups];

  // ------------------------------------------------------------
  // 2. 三个站点的分流规则（顺序见文件顶部 SITE_GROUPS 的说明）
  // ------------------------------------------------------------
  const siteRules = SITE_GROUPS.flatMap(
    (site, i) => site.matchers.map(m => `${m},${resolvedNames[i]}`)
  );

  // ------------------------------------------------------------
  // 3. 本地域名直连，永远排在所有规则最前面
  //    路由器后台 (miwifi.com)、localhost、localdomain 等
  // ------------------------------------------------------------
  const localRules = [
    "GEOSITE,private,DIRECT"
  ];

  // ------------------------------------------------------------
  // 4. 直连白名单（与 white-list.js 相同）
  // ------------------------------------------------------------
  const whitelistRules = [
    // —— 域名层判断（带域名的连接在这里就分流完，不触发额外解析）——

    // 国内常用服务直连示例 (可根据你需要直连的网站自行增删)
    "DOMAIN-SUFFIX,baidu.com,DIRECT",
    "DOMAIN-SUFFIX,taobao.com,DIRECT",
    "DOMAIN-SUFFIX,csdn.net,DIRECT",
    // ElevenLabs 走代理会被风控拦截，必须直连（注意：会暴露真实 IP）
    "DOMAIN-SUFFIX,elevenlabs.io,DIRECT",
    "DOMAIN-SUFFIX,api.elevenlabs.io,DIRECT",

    // —— IP 层判断 ——
    //
    // ⚠️ 刻意不使用 GEOSITE,cn，别再加回来：
    //    mihomo 实际加载的 geosite.dat（MetaCubeX/meta-rules-dat）里的 cn 分类
    //    远比 v2fly 上游的 data/cn 宽，混进了 browserleaks.com / whoer.net /
    //    ipinfo.io / ipleak.net 等一批境外站点。用它做直连判断会让这些站点
    //    绕过代理，直接暴露你的真实 IP —— 实测就是这么泄漏的。
    //    改用 GEOIP 按「解析出来的真实 IP 归属」判断，准确得多。

    // 局域网 IP 直连 (强烈建议保留，防止本地局域网设备断连)
    "IP-CIDR,192.168.0.0/16,DIRECT",
    "IP-CIDR,10.0.0.0/8,DIRECT",
    "IP-CIDR,172.16.0.0/12,DIRECT",
    "IP-CIDR,127.0.0.0/8,DIRECT",

    // IPv6 局域网段，与上面的 IPv4 规则对称。
    // Clash Verge 配置里 ipv6: true 时，纯 IPv6 的本地连接才不会被 MATCH 吃掉。
    "IP-CIDR6,::1/128,DIRECT",   // 回环
    "IP-CIDR6,fe80::/10,DIRECT", // 链路本地（局域网设备发现）
    "IP-CIDR6,fc00::/7,DIRECT",  // 唯一本地地址 ULA（含 fd00::/8）

    // 国内 IP 直连。
    // 这里不能加 no-resolve —— 必须让它对带域名的连接也做一次解析来判断归属，
    // 否则所有国内网站都会落到 MATCH 走代理。代价是一次 DNS 解析（有缓存）。
    "GEOIP,CN,DIRECT"
  ];

  // ------------------------------------------------------------
  // 5. 兜底规则 (MATCH 必须放在最后)
  // ------------------------------------------------------------
  const catchAllRule = [
    `MATCH,${MAIN_GROUP}`
  ];

  // ------------------------------------------------------------
  // 6. 合并规则，覆盖订阅原有的规则列表
  //    顺序：本地域名 > 三站点独立组 > 直连白名单 > 兜底
  //    三站点排在白名单之前，是为了让它们完全由你手动指定的组接管，
  //    不被后面的 GEOSITE,cn / GEOIP,CN 抢走（例如 google.cn）。
  // ------------------------------------------------------------
  config.rules = [...localRules, ...siteRules, ...whitelistRules, ...catchAllRule];

  // 7. 覆盖 DNS 配置：启用 fake-ip 防泄漏（其余配置不动）
  config.dns = dnsConfig;

  return config;
} 