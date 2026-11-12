#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const policy = require('./expected-routes.json');

function parseArgs(argv) {
  const options = { seconds: 30, intervalMs: 500, save: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') return { help: true };
    if (arg === '--save') { options.save = true; continue; }
    if ((arg === '--seconds' || arg === '--interval-ms') && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n)) throw new Error(arg + ' 必须是整数');
      if (arg === '--seconds') options.seconds = n;
      else options.intervalMs = n;
      continue;
    }
    throw new Error('未知参数：' + arg);
  }
  if (options.seconds < 1 || options.seconds > 180) throw new Error('--seconds 范围为 1–180');
  if (options.intervalMs < 200 || options.intervalMs > 5000) throw new Error('--interval-ms 范围为 200–5000');
  return options;
}

function getJSON(socketPath, urlPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ socketPath, path: urlPath, agent: false, timeout: 4000 }, response => {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(urlPath + ' HTTP ' + response.statusCode));
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error(urlPath + ' 超时')));
    request.on('error', reject);
  });
}

function relayReachable() {
  return new Promise(resolve => {
    const request = http.get({ hostname: '127.0.0.1', port: policy.relayPort, path: '/', timeout: 1500 }, response => {
      response.resume();
      resolve(response.statusCode === 200 || response.statusCode === 405);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

function suffixMatches(host, suffix) {
  return host === suffix || host.endsWith('.' + suffix);
}

function isClaudeProcess(metadata) {
  const processPath = metadata.processPath || '';
  const name = metadata.process || '';
  return policy.claude.processPaths.some(pattern => new RegExp(pattern).test(processPath)) ||
    policy.claude.processNames.some(pattern => new RegExp(pattern).test(name));
}

function classify(connection) {
  const metadata = connection.metadata || {};
  const host = String(metadata.host || '').toLowerCase().replace(/\.$/, '');
  const payload = String(connection.rulePayload || '');
  if (isClaudeProcess(metadata) &&
      ((connection.rule === 'GeoSite' && payload === 'private') ||
       (connection.rule === 'IPCIDR' && policy.localRulePayloads.includes(payload)))) return 'local';
  if (payload === policy.ruleSets.domesticAI) return 'domestic_ai';
  if (policy.claude.domainSuffixes.some(suffix => suffixMatches(host, suffix)) ||
      policy.claude.exactDomains.includes(host) ||
      policy.claude.ipRulePayloads.includes(payload) ||
      isClaudeProcess(metadata)) return 'claude';
  if (payload === policy.ruleSets.foreignAI) return 'foreign_ai';
  if (policy.mainGeoSites.includes(payload) && connection.rule === 'GeoSite') return 'main_service';
  if (connection.rule === 'Match') return 'fallback';
  return 'other';
}

function selectorSnapshot(proxies) {
  const names = Object.values(policy.groups).filter(name => name !== policy.groups.relay);
  return Object.fromEntries(names.map(name => [name, proxies.proxies && proxies.proxies[name] ? proxies.proxies[name].now || null : null]));
}

function safeObservation(connection, category, seenAt) {
  const metadata = connection.metadata || {};
  const processPath = metadata.processPath || '';
  const processTag = /\.local\/share\/claude\/versions\/[^/]+$/.test(processPath)
    ? 'Claude Code CLI'
    : /Claude\.app\/Contents\//.test(processPath) ? 'Claude Desktop' : (metadata.process || path.basename(processPath) || null);
  return {
    seenAt, category,
    host: metadata.host || null,
    process: processTag,
    network: metadata.network || null,
    rule: connection.rule || null,
    rulePayload: connection.rulePayload || null,
    chains: Array.isArray(connection.chains) ? connection.chains : []
  };
}

function evaluateConnection(item) {
  const g = policy.groups;
  const chains = item.chains;
  let expected = null;
  let passed = null;
  if (item.category === 'local' || item.category === 'domestic_ai') {
    expected = 'DIRECT';
    passed = chains.includes('DIRECT');
  } else if (item.category === 'claude') {
    expected = g.relay + '；再经 ' + g.claude + ' 和所选 ' + g.claudeExit;
    passed = item.network !== 'udp' && chains.includes(g.relay) && !chains.includes('DIRECT');
  } else if (item.category === 'foreign_ai') {
    expected = g.ai + ' 所选节点';
    passed = chains.includes(g.ai) && !chains.includes('DIRECT');
  } else if (item.category === 'main_service') {
    expected = g.main + ' 所选节点';
    passed = chains.includes(g.main) && !chains.includes('DIRECT');
  } else if (item.category === 'fallback') {
    expected = g.fallback + ' 所选策略';
    passed = chains.includes(g.fallback);
  }
  return { ...item, expected, result: passed === null ? 'NOT_EVALUATED' : passed ? 'PASS' : 'FAIL' };
}

function buildReport(input) {
  const { config, selectorsStart, selectorsEnd, connections, relay, rules, options, errors } = input;
  const orderedRules = (rules && rules.rules) || [];
  const indexOfRule = test => orderedRules.findIndex(test);
  const priority = {
    domesticAI: indexOfRule(r => r.type === 'RuleSet' && r.payload === policy.ruleSets.domesticAI),
    claude: indexOfRule(r => r.proxy === policy.groups.relay),
    foreignAI: indexOfRule(r => r.type === 'RuleSet' && r.payload === policy.ruleSets.foreignAI),
    nativeCLI: indexOfRule(r => r.type === 'ProcessPathRegex' && String(r.payload).includes('local/share/claude/versions'))
  };
  const priorityOK = priority.domesticAI >= 0 && priority.claude > priority.domesticAI &&
    priority.foreignAI > priority.claude && priority.nativeCLI >= 0;
  const groupsChanged = JSON.stringify(selectorsStart) !== JSON.stringify(selectorsEnd);
  const observations = connections.map(x => evaluateConnection(safeObservation(x.connection, classify(x.connection), x.seenAt)));
  const relevant = observations.filter(x => x.category !== 'other');
  if (config.mode !== 'rule') for (const item of relevant) item.result = 'NOT_EVALUATED';
  const evaluated = relevant.filter(x => x.result !== 'NOT_EVALUATED');
  const failures = evaluated.filter(x => x.result === 'FAIL');
  const claude = relevant.filter(x => x.category === 'claude');
  const g = policy.groups;
  const exit = selectorsEnd[g.claudeExit];
  const relayCount = claude.filter(x => x.chains.includes(g.relay)).length;
  const exitCount = observations.filter(x => x.chains.includes(g.claudeExit)).length;
  const transitCount = observations.filter(x => x.chains.includes(g.claude)).length;
  const expectedExit = exit && exit !== policy.exitOff && exit !== 'REJECT';
  const segmentEvidence = {
    relayConnections: relayCount,
    exitConnections: exitCount,
    transitConnections: transitCount,
    conclusion: !claude.length ? 'NO_CLAUDE_TRAFFIC'
      : !relayCount ? 'MISSING_RELAY'
      : !transitCount || (expectedExit && !exitCount) ? 'PARTIAL'
      : 'SEGMENTS_OBSERVED'
  };
  const issues = failures.map(x => ({
    severity: 'high', code: 'ROUTE_MISMATCH', host: x.host, process: x.process,
    expected: x.expected, actual: x.chains, rule: x.rule, rulePayload: x.rulePayload
  }));
  if (!priorityOK) issues.push({ severity: 'high', code: 'RULE_PRIORITY', detail: '国内 AI、Claude、国外 AI 或原生 CLI 规则缺失／顺序异常', priority });
  if (config.mode !== 'rule') issues.push({ severity: 'info', code: 'NOT_RULE_MODE', detail: '规则分流无法在当前模式验证' });
  if (!config.tun || !config.tun.enable) issues.push({ severity: 'info', code: 'TUN_OFF', detail: '不遵循系统代理的应用可能未被捕获' });
  if (!relay) issues.push({ severity: 'high', code: 'RELAY_UNREACHABLE', detail: '本机 Claude IPv4 转发服务未响应' });
  if (groupsChanged) issues.push({ severity: 'info', code: 'SELECTOR_CHANGED', detail: '采样期间分组选择变化，连接可能对应不同选择' });
  const selectedTransit = selectorsEnd[g.claude];
  const selectorsReady = Boolean(selectedTransit && exit && selectedTransit !== 'REJECT' && exit !== 'REJECT');
  if (!selectorsReady) issues.push({ severity: 'info', code: 'CLAUDE_BLOCKED_OR_UNSET', detail: 'Claude 中转或出口为 REJECT／未选择；新连接预期断流' });
  if (errors.length) issues.push({ severity: 'info', code: 'SAMPLING_ERRORS', count: errors.length });
  const fallbackCandidates = [...new Set(relevant.filter(x => x.category === 'fallback' && x.host).map(x => x.host))].slice(0, 50);
  const status = !priorityOK || failures.length || !relay ? 'FAIL'
    : config.mode !== 'rule' || !config.tun?.enable || !selectorsReady || groupsChanged || errors.length ||
      !claude.length || segmentEvidence.conclusion !== 'SEGMENTS_OBSERVED'
      ? 'INCONCLUSIVE' : 'PASS';
  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    status,
    scope: 'Clash Verge active connections; no message content',
    environment: {
      mode: config.mode || null, tun: Boolean(config.tun && config.tun.enable),
      relayReachable: relay, selectors: selectorsEnd, selectorsChanged: groupsChanged,
      rulePriority: priority, rulePriorityOK: priorityOK
    },
    summary: {
      sampledConnections: connections.length,
      relevantConnections: relevant.length,
      claudeConnections: claude.length,
      passed: evaluated.length - failures.length,
      failed: failures.length
    },
    claudeSegments: segmentEvidence,
    issues,
    observations: relevant.slice(0, 200),
    fallbackCandidates,
    limitations: [
      'Clash /connections 只包含采样时仍活动的连接；未出现的流量不能判定为通过。',
      '转发、中转和出口是不同连接；观察到各段不等于逐请求精确关联。',
      '节点实际公网出口 IP 需要目标网站回显或独立探测，分组名称不能证明地理位置。'
    ]
  };
}

async function run(options) {
  const socketPath = process.env.CLASH_CONTROLLER_SOCKET ||
    '/var/run/clash-verge-service/users/' + process.getuid() + '/verge-mihomo.sock';
  const [config, proxiesStart, rules, relay] = await Promise.all([
    getJSON(socketPath, '/configs'),
    getJSON(socketPath, '/proxies'),
    getJSON(socketPath, '/rules'),
    relayReachable()
  ]);
  const seen = new Map();
  const errors = [];
  const stopAt = Date.now() + options.seconds * 1000;
  do {
    try {
      const data = await getJSON(socketPath, '/connections');
      const time = new Date().toISOString();
      for (const connection of data.connections || []) {
        const key = connection.id || [
          connection.start, connection.metadata && connection.metadata.host,
          connection.metadata && connection.metadata.processPath,
          connection.rule, (connection.chains || []).join('/')
        ].join('|');
        if (!seen.has(key)) seen.set(key, { connection, seenAt: time });
      }
    } catch (error) { errors.push(error.message); }
    await new Promise(resolve => setTimeout(resolve, options.intervalMs));
  } while (Date.now() < stopAt);
  const proxiesEnd = await getJSON(socketPath, '/proxies');
  const report = buildReport({
    config, selectorsStart: selectorSnapshot(proxiesStart),
    selectorsEnd: selectorSnapshot(proxiesEnd),
    connections: [...seen.values()], relay, rules, options, errors
  });
  if (options.save) {
    const desktop = path.join(os.homedir(), 'Desktop');
    if (!fs.existsSync(desktop)) throw new Error('桌面目录不存在：' + desktop);
    const stamp = report.checkedAt.replace(/[:.]/g, '-');
    const target = path.join(desktop, 'clash-traffic-check-' + stamp + '.json');
    process.stderr.write('保存本地报告：' + target + '\n');
    fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    report.savedTo = target;
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write('用法：node traffic-monitor/check.cjs [--seconds 30] [--interval-ms 500] [--save]\n默认只输出到终端；--save 另存到桌面。只读取 Clash 状态与连接。\n');
    } else {
      run(options).catch(error => { process.stderr.write('检测失败：' + error.message + '\n'); process.exitCode = 1; });
    }
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
module.exports = { classify, evaluateConnection, buildReport, parseArgs };
