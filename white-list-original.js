// Define main function (script entry)

function main(config) {
    if (!config.rules) return config;

    // 1. 定义你的直连白名单 (格式："规则类型, 匹配词, 策略")
    // 策略填写 DIRECT 代表直连，不走代理
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
    // 请将 "🚀 节点选择" 替换为你订阅中真实存在的代理组名称（如 "🎯 全球直连" 或 "🇺🇸 美国节点" 等）
    const catchAllRule = [
        "MATCH,Proxy"
    ];

    // 3. 将白名单和兜底规则合并，直接覆盖现有的规则列表
    // 这样当脚本启用时，机场原有的复杂分流规则会被完全替换为你的白名单模式
    config.rules = [...whitelistRules, ...catchAllRule];

    return config;
}
