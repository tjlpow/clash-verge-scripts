// CLASH_VARIANT: safe
// CLASH_VARIANT_STATUS: ready
// ============================================================
// clash-verge-safe：国内直连，其余流量经手选跳板和 ISP 出口。
// 规则、真实 ISP 链路和 Claude IPv4 转发已在隔离内核中验证。
//
// 迭代流程
// 1. **修改**：只编辑本机 profiles/clash-verge-safe.js，不直接改 Script.js。
// 2. **检查**：验证规则顺序、国内名单、DNS、出口链和节点失败时的断流。
// 3. **启用**：检查通过后运行 node switch-clash-verge.js safe。
//    切换命令只更新 Script.js；由用户自行重启 Clash Verge 并实测。
// 4. **提交**：核对远程 SHA，提交 clash-verge-safe.js 和相关 README。
//    维护时不重启或切换 Clash 的配置、模式及节点。
//
// 机场订阅和 ISP 凭据只存本机 Merge.yaml，不写入公开脚本。
// 退出 Clash 后的系统级断网保护暂不实现；本版仅保证核心运行时的规则保护。
// ============================================================

const SAFE_JUMP_GROUP = "🪜 Jump";
const SAFE_EXIT_GROUP = "🌍 Overseas Exit";
const SAFE_EXIT_PROVIDER_SOURCE = "ClaudeExit";
const SAFE_EXIT_PROVIDER = "safe-exit-1";
const CLAUDE_IPV4_RELAY_NAME = "Claude IPv4 relay";
const CLAUDE_IPV4_RELAY_PORT = 7899;
const CLAUDE_IPV4_UPSTREAM_PORT = 7901;
const TERMINAL_PORT = 7898;

const CLAUDE_DOMAINS = [
  "DOMAIN-SUFFIX,anthropic.com",
  "DOMAIN-SUFFIX,claude.ai",
  "DOMAIN-SUFFIX,claude.com",
  "DOMAIN-SUFFIX,clau.de",
  "DOMAIN-SUFFIX,claudemcpclient.com",
  "DOMAIN-SUFFIX,claudemcpcontent.com",
  "DOMAIN-SUFFIX,claudeusercontent.com",
  "DOMAIN,servd-anthropic-website.b-cdn.net",
  "DOMAIN,anthropic.com.cdn.cloudflare.net",
  "DOMAIN,anthropic.auth0.com",
  "DOMAIN,anthropic-com.ghost.io"
];
const CLAUDE_APPS = [
  "PROCESS-PATH-REGEX,(^|/)(Claude\\.app/Contents/|\\.local/share/claude/versions/[^/]+$)",
  "PROCESS-NAME-REGEX,^(Claude|claude)( Helper.*)?$"
];
const CLAUDE_IPS = [
  "IP-CIDR,160.79.104.0/21",
  "IP-CIDR6,2607:6bc0::/32",
  "IP-ASN,399358"
];

const BILIBILI_DOMAINS = [
  "bilibili.com", "bilibili.tv", "bilibiligame.cn", "bilibiligame.co",
  "bilibiligame.net", "biligame.co", "biligame.com", "biligame.net",
  "acgvideo.com", "biliapi.net", "biliimg.com", "bilivideo.com",
  "hdslb.com", "b23.tv"
];

function withReject(rules) {
  return rules.flatMap(function(rule) {
    const parts = rule.split(",");
    const policy = parts.length - (parts[parts.length - 1] === "no-resolve" ? 2 : 1);
    parts[policy] = "REJECT";
    return [rule, parts.join(",")];
  });
}

function provider(name, behavior, url, proxy) {
  return {
    type: "http", behavior: behavior, format: "yaml",
    url: url, path: "./profiles/safe-" + name + ".yaml",
    interval: 86400, proxy: proxy
  };
}

function main(config) {
  const providers = config["proxy-providers"] || {};
  const ordinary = Object.keys(providers).filter(function(name) {
    return name !== SAFE_EXIT_PROVIDER_SOURCE && name !== SAFE_EXIT_PROVIDER;
  });
  const source = providers[SAFE_EXIT_PROVIDER_SOURCE];
  if (!ordinary.length) throw new Error("安全版缺少跳板节点集合");
  if (!source || source.type !== "inline" || !Array.isArray(source.payload) || !source.payload.length) {
    throw new Error("安全版需要 Merge.yaml 中的 inline ClaudeExit 集合");
  }
  if (providers[SAFE_EXIT_PROVIDER]) throw new Error("安全版出口集合名称冲突");
  if (source.payload.some(function(node) {
    return !node || node.type !== "socks5" || !node.name ||
      !node.server || !node.port || !node.username || !node.password;
  })) throw new Error("安全版出口只接受完整的 SOCKS5 认证节点");

  // 普通机场只供跳板使用；直接/拒绝类型不进入跳板候选。
  ordinary.forEach(function(name) {
    const item = providers[name];
    const excluded = String(item["exclude-type"] || "").split("|").filter(Boolean);
    providers[name] = Object.assign({}, item, {
      "exclude-type": Array.from(new Set(excluded.concat(["direct", "reject"]))).join("|")
    });
  });

  // ISP 的原始节点不出现在运行配置中。只保留强制经跳板拨号的副本。
  const override = Object.assign({}, source.override || {});
  delete override["override-expr"];
  override["dialer-proxy"] = SAFE_JUMP_GROUP;
  override.udp = false;
  providers[SAFE_EXIT_PROVIDER] = Object.assign({}, source, {
    path: "./providers/" + SAFE_EXIT_PROVIDER + ".yaml",
    override: override,
    "exclude-type": "direct|reject|hysteria|hysteria2|tuic|wireguard|tailscale",
    "health-check": Object.assign({}, source["health-check"] || {}, { enable: false })
  });
  delete providers[SAFE_EXIT_PROVIDER_SOURCE];
  config["proxy-providers"] = providers;

  // 两组均为手选，初始 REJECT；无 DIRECT、自动测速或备用节点回退。
  config.proxies = [
    { name: CLAUDE_IPV4_RELAY_NAME, type: "http",
      server: "127.0.0.1", port: CLAUDE_IPV4_RELAY_PORT, udp: false }
  ];
  config["proxy-groups"] = [
    { name: SAFE_JUMP_GROUP, type: "select", proxies: ["REJECT"],
      use: ordinary, "empty-fallback": "REJECT" },
    { name: SAFE_EXIT_GROUP, type: "select", proxies: ["REJECT"],
      use: [SAFE_EXIT_PROVIDER], "empty-fallback": "REJECT", "disable-udp": true },
    { name: "GLOBAL", type: "select", proxies: [SAFE_EXIT_GROUP, "REJECT"],
      "empty-fallback": "REJECT" }
  ];

  // 远程规则集每天更新。下载经出口；本地已有缓存可在节点暂时不可用时继续使用。
  const sourceBase = "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/";
  config["rule-providers"] = {
    "safe-direct": provider("direct", "domain", sourceBase + "direct.txt", SAFE_EXIT_GROUP),
    "safe-cncidr": provider("cncidr", "ipcidr", sourceBase + "cncidr.txt", SAFE_EXIT_GROUP),
    "safe-reject": provider("reject", "domain", sourceBase + "reject.txt", SAFE_EXIT_GROUP),
    "safe-ai-cn": provider("ai-cn", "classical",
      "https://cdn.jsdelivr.net/gh/VPSDance/ai-proxy-rules@main/rules/clash/cn.yaml", SAFE_EXIT_GROUP)
  };

  const localRules = [
    "GEOSITE,private,DIRECT",
    "IP-CIDR,0.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,100.64.0.0/10,DIRECT,no-resolve",
    "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,169.254.0.0/16,DIRECT,no-resolve",
    "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
    "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
    "IP-CIDR6,::1/128,DIRECT,no-resolve",
    "IP-CIDR6,fe80::/10,DIRECT,no-resolve",
    "IP-CIDR6,fc00::/7,DIRECT,no-resolve"
  ];
  const biliRules = BILIBILI_DOMAINS.map(function(domain) {
    return "DOMAIN-SUFFIX," + domain + ",DIRECT";
  }).concat([
    "DOMAIN-KEYWORD,mirrorakam,DIRECT",
    "DOMAIN,p-bstarstatic.akamaized.net,DIRECT",
    "DOMAIN,p.bstarstatic.com,DIRECT"
  ]);
  const wechatRules = [
    "PROCESS-NAME,WeChat,DIRECT",
    "PROCESS-NAME,WeChatAppEx Helper,DIRECT"
  ];
  const claudeRules = CLAUDE_DOMAINS.concat(CLAUDE_APPS).map(function(rule) {
    return rule + "," + CLAUDE_IPV4_RELAY_NAME;
  });
  const claudeIPRules = CLAUDE_IPS.map(function(rule) {
    return rule + "," + CLAUDE_IPV4_RELAY_NAME + ",no-resolve";
  });
  const udpGuard = CLAUDE_DOMAINS.concat(CLAUDE_APPS).map(function(rule) {
    return "AND,((NETWORK,udp),(" + rule + ")),REJECT";
  });
  udpGuard.push("AND,((NETWORK,udp),(RULE-SET,safe-ai-cn)),REJECT");
  udpGuard.push("AND,((NETWORK,udp),(GEOSITE,geolocation-!cn)),REJECT");

  config.rules = [
    "RULE-SET,safe-reject,REJECT",
    ...localRules,
    ...udpGuard,
    "RULE-SET,safe-ai-cn,DIRECT",
    ...withReject(claudeRules),
    ...withReject(claudeIPRules),
    ...biliRules,
    ...wechatRules,
    ...withReject(["GEOSITE,geolocation-!cn," + SAFE_EXIT_GROUP]),
    "RULE-SET,safe-direct,DIRECT",
    "RULE-SET,safe-cncidr,DIRECT,no-resolve",
    "GEOIP,CN,DIRECT,no-resolve",
    "NETWORK,udp,REJECT",
    ...withReject(["MATCH," + SAFE_EXIT_GROUP])
  ];

  const domesticDNS = ["https://223.5.5.5/dns-query", "https://doh.pub/dns-query"];
  config.dns = {
    enable: true,
    listen: "127.0.0.1:53",
    ipv6: false,
    "prefer-h3": false,
    "respect-rules": true,
    "use-system-hosts": false,
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",
    "fake-ip-filter": ["geosite:private", "+.lan", "+.local",
      "+.in-addr.arpa", "+.ip6.arpa", "localhost.work.weixin.qq.com"],
    "default-nameserver": ["223.5.5.5", "119.29.29.29"],
    "proxy-server-nameserver": domesticDNS,
    "direct-nameserver": domesticDNS.map(function(url) { return url + "#DIRECT"; }),
    "direct-nameserver-follow-policy": true,
    nameserver: [
      "https://1.1.1.1/dns-query#" + SAFE_EXIT_GROUP,
      "https://8.8.8.8/dns-query#" + SAFE_EXIT_GROUP
    ],
    "nameserver-policy": { "geosite:private": "system" }
  };

  const names = ["terminal-ai", "claude-ipv4-upstream", "claude-exit-upstream"];
  const listeners = (config.listeners || []).filter(function(item) {
    return !names.includes(item.name);
  });
  const occupied = [
    config.port, config["socks-port"], config["mixed-port"],
    config["redir-port"], config["tproxy-port"]
  ];
  [TERMINAL_PORT, CLAUDE_IPV4_RELAY_PORT, CLAUDE_IPV4_UPSTREAM_PORT].forEach(function(port) {
    if (occupied.includes(port) || listeners.some(function(item) { return item.port === port; })) {
      throw new Error("安全版本机端口冲突：" + port);
    }
  });
  config.listeners = listeners.concat([
    { name: "terminal-ai", type: "mixed", listen: "127.0.0.1", port: TERMINAL_PORT },
    { name: "claude-exit-upstream", type: "mixed", listen: "127.0.0.1",
      port: CLAUDE_IPV4_UPSTREAM_PORT, proxy: SAFE_EXIT_GROUP }
  ]);
  config.sniffer = Object.assign({}, config.sniffer || {});
  config.sniffer["skip-src-address"] = Array.from(new Set(
    (config.sniffer["skip-src-address"] || []).concat(["127.0.0.1/32"])
  ));
  config.mode = "rule";
  config.ipv6 = false;
  config["find-process-mode"] = "always";
  // TUN 开关和 DNS 劫持由 Clash Verge 设置管理；系统级断网开关不在本脚本中。
  return config;
}
