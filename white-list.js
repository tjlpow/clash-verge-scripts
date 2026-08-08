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

  // 1. 定义你的直连白名单 (格式："规则类型, 匹配词, 策略")
  //    策略填写 DIRECT 代表直连，不走代理
  const whitelistRules = [
    // —— 域名层判断（带域名的连接在这里就分流完，不触发额外解析）——

    // 本地域名直连：路由器后台 (miwifi.com)、localhost、localdomain 等
    "GEOSITE,private,DIRECT",

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
