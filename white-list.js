// ============================================================
// Clash Verge 外部脚本：白名单直连模式 + 防 DNS 泄漏
// 仅白名单内的域名/IP 走 DIRECT，其余全部走代理组
// ============================================================

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
  "listen": "0.0.0.0:1053",
  "ipv6": false,
  "prefer-h3": false,
  "respect-rules": true,
  "use-system-hosts": false,
  "cache-algorithm": "arc",
  "enhanced-mode": "fake-ip",
  "fake-ip-range": "198.18.0.1/16",
  "fake-ip-filter": [
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
    "geosite:private,cn": domesticNameservers
  }
};

// Define main function (script entry)
function main(config) {
  if (!config.rules) return config;

  // 1. 定义你的直连白名单 (格式："规则类型, 匹配词, 策略")
  //    策略填写 DIRECT 代表直连，不走代理
  const whitelistRules = [
    // 局域网 IP 直连 (强烈建议保留，防止本地局域网设备断连)
    "IP-CIDR,192.168.0.0/16,DIRECT",
    "IP-CIDR,10.0.0.0/8,DIRECT",
    "IP-CIDR,172.16.0.0/12,DIRECT",
    "IP-CIDR,127.0.0.0/8,DIRECT",

    // 国内常用服务直连示例 (可根据你需要直连的网站自行增删)
    "DOMAIN-SUFFIX,baidu.com,DIRECT",
    "DOMAIN-SUFFIX,taobao.com,DIRECT",
    "DOMAIN-SUFFIX,csdn.net,DIRECT",
    "DOMAIN-SUFFIX,elevenlabs.io,DIRECT",
    "DOMAIN-SUFFIX,api.elevenlabs.io,DIRECT",

    // 也可以直接利用 GEOIP 判断国内 IP 直连
    "GEOIP,CN,DIRECT"
  ];

  // 2. 定义兜底规则 (MATCH 必须放在最后)
  //    下面写死的是 "Proxy"，即你机场订阅里真实存在的那个主代理组。
  //    如果你的主组不叫 Proxy（比如叫 "🚀 节点选择" / "🎯 全球直连"），
  //    把下面 "Proxy" 改成你实际的组名即可。
  const catchAllRule = [
    "MATCH,Proxy"
  ];

  // 3. 将白名单和兜底规则合并，直接覆盖现有的规则列表
  //    这样当脚本启用时，机场原有的复杂分流规则会被完全替换为你的白名单模式
  config.rules = [...whitelistRules, ...catchAllRule];

  // 4. 覆盖 DNS 配置：启用 fake-ip 防泄漏（其余配置不动）
  config.dns = dnsConfig;

  return config;
}
