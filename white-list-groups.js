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

// —— AI 服务规则集 ——
// 来源：https://github.com/VPSDance/ai-proxy-rules（rule-provider，按 interval 自动刷新）
// 海外/国内分开建组方便分别选节点；国内组的域名解析到国内 IP 时会先被
// 第 4 步的 GEOIP,CN,DIRECT 命中，所以对应的 AI 规则必须排在它前面。
//
// 默认用 cdn.jsdelivr.net（2026-08-14 测过能连，最快）。mihomo 不支持
// 一个 url 填多个地址自动轮询，连不上时手动把下面两条 url 里的域名换成：
//   testingcf.jsdelivr.net / fastly.jsdelivr.net / cdn.jsdmirror.com
// 换完只需替换域名，路径（/gh/VPSDance/...）不用动。
const AI_RULE_SETS = [
  {
    name: "国外AI",
    provider: "ai-global",
    url: "https://cdn.jsdelivr.net/gh/VPSDance/ai-proxy-rules@main/rules/clash/global.yaml"
  },
  {
    name: "国内AI",
    provider: "ai-cn",
    url: "https://cdn.jsdelivr.net/gh/VPSDance/ai-proxy-rules@main/rules/clash/cn.yaml"
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
  // 1. 为站点 / AI 服务各建一个 select 策略组
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
    options.push("DIRECT", ...nodeNames);

    const group = { "name": name, "type": "select", "proxies": options };
    if (providerNames.length) group["use"] = providerNames;
    newGroups.push(group);
  }

  // AI 规则集各建一个 select 组，逻辑跟上面站点组一致
  const aiGroups = [];
  const aiResolvedNames = [];

  for (const ai of AI_RULE_SETS) {
    let name = ai.name;
    for (let i = 2; takenNames.has(name); i++) {
      name = `${ai.name}-${i}`;
    }
    takenNames.add(name);
    aiResolvedNames.push(name);

    const options = [];
    if (hasMainGroup) options.push(MAIN_GROUP);
    options.push("DIRECT", ...nodeNames);

    const group = { "name": name, "type": "select", "proxies": options };
    if (providerNames.length) group["use"] = providerNames;
    aiGroups.push(group);
  }

  config["proxy-groups"] = [...existingGroups, ...newGroups, ...aiGroups];

  // AI 规则集声明为 rule-providers，mihomo 按 interval 在后台自动刷新，
  // 不需要这个脚本重跑
  const aiRuleProviders = {};
  AI_RULE_SETS.forEach(ai => {
    aiRuleProviders[ai.provider] = {
      type: "http",
      behavior: "classical",
      format: "yaml",
      url: ai.url,
      path: `./rules/${ai.provider}.yaml`,
      interval: 86400
    };
  });
  config["rule-providers"] = { ...(config["rule-providers"] || {}), ...aiRuleProviders };

  // ------------------------------------------------------------
  // 2. 站点独立分组的分流规则
  // ------------------------------------------------------------
  const siteRules = SITE_GROUPS.flatMap(
    (site, i) => site.matchers.map(m => `${m},${resolvedNames[i]}`)
  );

  // AI 规则集对应的分流规则；必须排在第 4 步的 GEOIP,CN,DIRECT 之前，
  // 否则国内 AI 服务会先被 GEOIP 命中直连，"国内AI" 组形同虚设选不了节点
  const aiRules = AI_RULE_SETS.map(
    (ai, i) => `RULE-SET,${ai.provider},${aiResolvedNames[i]}`
  );

  // ------------------------------------------------------------
  // 3. 本地域名直连，永远排在所有规则最前面
  //    路由器后台 (miwifi.com)、localhost、localdomain 等
  // ------------------------------------------------------------
  const localRules = [
    "GEOSITE,private,DIRECT"
  ];

  // ------------------------------------------------------------
  // 4. 直连白名单
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
  // 5. 兜底规则 (MATCH 必须放在最后)
  // ------------------------------------------------------------
  const catchAllRule = [
    `MATCH,${MAIN_GROUP}`
  ];

  // ------------------------------------------------------------
  // 6. 合并规则，覆盖订阅原有的规则列表
  //    顺序：本地域名 > 站点独立组 > AI规则 > 直连白名单 > 兜底
  // ------------------------------------------------------------
  config.rules = [...localRules, ...siteRules, ...aiRules, ...whitelistRules, ...catchAllRule];

  // 7. 覆盖 DNS 配置
  config.dns = dnsConfig;

  return config;
}
