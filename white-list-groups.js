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
//   白名单直连 + 防 DNS 泄漏 + YouTube / X / 国外AI / 国内AI 独立策略组
//
// 各组均为 select，默认选中主组 Proxy；在 Clash Verge「代理」页
// 手动切换后才会分流到不同节点。
//
// 各项配置的取舍理由记在提交历史里，不在本文件重复：
//   https://github.com/tjlpow/clash-verge-scripts/commits/main/white-list-groups.js
// ============================================================

// —— 主代理组名 ——
// 必须是订阅里真实存在的组名。改这一处，策略组和兜底规则都会跟着变。
const MAIN_GROUP = "Proxy";

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

// —— 按流量倍率筛选的自动测速子组 ——
// 都是 url-test + filter：在筛出来的节点里自动选延迟最低的，本身不在
// 首页单独显示（见下方 hidden: true），只作为 "Proxy" 的备选项出现。
// filter 是正则，直接匹配节点名里的"流量倍率:x"部分：
//   0\.\d+        只匹配 0.x（严格小于 1）
//   (0\.\d+|1)    匹配 0.x 或者正好等于 1（即 <=1，排除 >1 的节点）
// 这依赖当前订阅节点名"国家-代号-流量倍率:x"的固定格式，换机场/改了
// 节点命名方式的话，这几条 filter 要跟着重新核对。
const LOW_RATIO_GROUPS = [
  { name: "Auto 低倍率", filter: "流量倍率:0\\.\\d+$" },
  { name: "美国", filter: "^美国.*流量倍率:(0\\.\\d+|1)$" },
  { name: "荷兰", filter: "^荷兰.*流量倍率:(0\\.\\d+|1)$" },
  { name: "日本", filter: "^日本.*流量倍率:(0\\.\\d+|1)$" }
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
    url: "https://cdn.jsdelivr.net/gh/VPSDance/ai-proxy-rules@main/rules/clash/global.yaml"
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

// Define main function (script entry)
function main(config) {
  if (!config.rules) return config;

  // ------------------------------------------------------------
  // 1. 为站点 / 规则集各建一个 select 策略组
  // ------------------------------------------------------------
  const existingGroups = config["proxy-groups"] || [];
  const takenNames = new Set(existingGroups.map(g => g && g.name).filter(Boolean));

  // 订阅里的全部节点名；用 proxy-providers 的订阅这里可能是空的，靠下面的 use 兜底
  const nodeNames = (config.proxies || []).map(p => p && p.name).filter(Boolean);
  const providerNames = Object.keys(config["proxy-providers"] || {});

  // 主组不存在就不往选项里放，避免生成一个指向空气的策略导致配置加载失败
  const hasMainGroup = takenNames.has(MAIN_GROUP);

  // 订阅原有的组（Proxy、Auto 等）目前节点是写死的名单。这里统一给它们
  // 补上 use，以后新增机场只要注册成 proxy-providers，这些组（含 Auto
  // 自动测速）会自动把新机场节点纳入，不用逐个组手动改。
  if (providerNames.length) {
    for (const g of existingGroups) {
      if (!g || !g.proxies) continue;
      g.use = Array.from(new Set([...(g.use || []), ...providerNames]));
    }
  }

  // 按 HIDDEN_GROUPS 名单把订阅原有的组标记为 hidden，不影响功能，
  // 只是尝试不让它单独出现在首页
  for (const g of existingGroups) {
    if (g && HIDDEN_GROUPS.includes(g.name)) g.hidden = true;
  }

  // 订阅自带的 "Auto" 组：过滤掉流量倍率 >1 的节点，只在性价比更高的
  // 节点里自动测速，避免它自动选到消耗流量更贵的节点
  const autoGroupObj = existingGroups.find(g => g && g.name === "Auto");
  if (autoGroupObj && Array.isArray(autoGroupObj.proxies)) {
    autoGroupObj.proxies = autoGroupObj.proxies.filter(n => /流量倍率:(0\.\d+|1)$/.test(n));
  }

  // 按流量倍率筛选的自动测速子组：url-test + filter，hidden 不占首页位置。
  // 提前建好，好把组名塞进下面所有首页可见组的选项列表里当备选项。
  const lowRatioGroups = [];
  const lowRatioResolvedNames = [];

  for (const lr of LOW_RATIO_GROUPS) {
    let name = lr.name;
    for (let i = 2; takenNames.has(name); i++) {
      name = `${lr.name}-${i}`;
    }
    takenNames.add(name);
    lowRatioResolvedNames.push(name);

    // mihomo 的 filter 只对 use（proxy-providers）拉进来的节点生效，对
    // 写死在 proxies 里的节点不起作用，所以这里先用同一条正则在 JS 里
    // 把 nodeNames 过滤一遍，避免不符合条件的节点也被塞进候选池
    const matched = nodeNames.filter(n => new RegExp(lr.filter).test(n));

    const group = {
      "name": name,
      "type": "url-test",
      "url": "http://www.gstatic.com/generate_204",
      "interval": 300,
      "tolerance": 50,
      "filter": lr.filter, // 留着给未来的 proxy-providers 节点用
      "hidden": true,
      "proxies": matched
    };
    if (providerNames.length) group["use"] = providerNames;
    lowRatioGroups.push(group);
  }

  // 塞进 Proxy 的选项列表（跟在 Auto 后面）；找不到 Proxy 就跳过，避免
  // 生成指向空气的引用
  if (hasMainGroup) {
    const mainGroupObj = existingGroups.find(g => g && g.name === MAIN_GROUP);
    const autoIndex = mainGroupObj.proxies.indexOf("Auto");
    const insertAt = autoIndex === -1 ? 0 : autoIndex + 1;
    mainGroupObj.proxies.splice(insertAt, 0, ...lowRatioResolvedNames);
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
    options.push(...lowRatioResolvedNames, "DIRECT", ...nodeNames);

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
    options.push(...lowRatioResolvedNames, "DIRECT", ...nodeNames);

    const group = { "name": name, "type": "select", "proxies": options };
    if (providerNames.length) group["use"] = providerNames;
    providerGroups.push(group);
  }

  config["proxy-groups"] = [...existingGroups, ...newGroups, ...providerGroups, ...lowRatioGroups];

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
  const providerRules = PROVIDER_GROUPS.map(
    (rs, i) => `RULE-SET,${rs.provider},${providerResolvedNames[i]}`
  );

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
  // ------------------------------------------------------------
  const catchAllRule = [
    `MATCH,${MAIN_GROUP}`
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
