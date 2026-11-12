#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const policy = require('./expected-routes.json');

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
    const request = http.get({ hostname: '127.0.0.1', port: Number(process.env.CLAUDE_RELAY_PORT || policy.relayPort), path: '/', timeout: 1500 }, response => {
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

function selectedLeaf(proxies, name) {
  const visited = new Set();
  let current = name;
  while (current && proxies.proxies && proxies.proxies[current] && proxies.proxies[current].now) {
    if (visited.has(current)) return null;
    visited.add(current);
    current = proxies.proxies[current].now;
  }
  return current || null;
}

function probeIPv4(port) {
  return new Promise(resolve => {
    execFile('/usr/bin/curl', [
      '--fail', '--silent', '--show-error', '--ipv4', '--max-time', '8',
      '--proxy', 'http://127.0.0.1:' + port, '--noproxy', '',
      'https://api4.ipify.org'
    ], { timeout: 9000, maxBuffer: 1024, env: { PATH: '/usr/bin:/bin' } }, (error, stdout) => {
      const value = String(stdout).trim();
      const parts = value.split('.');
      const valid = parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
      resolve(error ? { ip: null, error: String(error.message).slice(0, 180) }
        : valid ? { ip: value, error: null }
          : { ip: null, error: 'IPv4 回显结果无效' });
    });
  });
}

async function captureEgress(socketPath) {
  const at = new Date().toISOString();
  let proxies;
  try { proxies = await getJSON(socketPath, '/proxies'); }
  catch (error) { return { at, transit: { node: null, ip: null, error: '分组读取失败：' + error.message }, exit: null }; }
  const transitGroup = policy.groups.claude;
  const exitGroup = policy.groups.claudeExit;
  const transitSelection = proxies.proxies?.[transitGroup]?.now || null;
  const exitSelection = proxies.proxies?.[exitGroup]?.now || null;
  const transitProbe = probeIPv4(7900);
  const exitProbe = exitSelection && exitSelection !== policy.exitOff && exitSelection !== 'REJECT'
    ? probeIPv4(7901) : null;
  const transit = {
    selection: transitSelection, node: selectedLeaf(proxies, transitSelection),
    ...await transitProbe
  };
  let exit;
  if (exitSelection === policy.exitOff) {
    exit = { selection: exitSelection, node: transit.node, ip: transit.ip,
      error: transit.error, via: 'transit' };
  } else if (exitSelection === 'REJECT' || !exitSelection) {
    exit = { selection: exitSelection, node: null, ip: null, error: '出口已拒绝或未设置', via: 'blocked' };
  } else {
    exit = { selection: exitSelection, node: selectedLeaf(proxies, exitSelection),
      ...await exitProbe, via: 'chain' };
  }
  let selectionChangedDuringProbe = false;
  try {
    const after = await getJSON(socketPath, '/proxies');
    selectionChangedDuringProbe = after.proxies?.[transitGroup]?.now !== transitSelection ||
      after.proxies?.[exitGroup]?.now !== exitSelection ||
      selectedLeaf(after, transitSelection) !== transit.node ||
      (exit.via === 'chain' && selectedLeaf(after, exitSelection) !== exit.node);
  } catch { selectionChangedDuringProbe = true; }
  return { at, transit, exit, selectionChangedDuringProbe };
}

function egressSummary(samples) {
  const describe = key => {
    const values = samples.map(sample => sample[key]).filter(Boolean);
    const ips = [...new Set(values.map(value => value.ip).filter(Boolean))];
    const nodes = [...new Set(values.map(value => value.node).filter(Boolean))];
    return {
      nodes, ips, successfulProbes: values.filter(value => value.ip).length,
      failedProbes: values.filter(value => !value.ip).length,
      stability: !ips.length ? 'UNKNOWN' : ips.length > 1 ? 'CHANGED' : 'SAME_AT_SAMPLE_TIMES'
    };
  };
  return { cadenceSeconds: 60, samples, transit: describe('transit'), exit: describe('exit') };
}

function isProbeConnection(item) {
  return item.host === 'api4.ipify.org' ||
    (item.process === 'curl' && [7900, 7901].includes(Number(item.destinationPort)));
}


const BASE_DIR = path.join(os.tmpdir(), 'clash-traffic-monitor');
const POINTER = path.join(BASE_DIR, 'current.json');
const INTERVAL_MS = 250;
const MAX_MS = 60 * 60 * 1000;
const MAX_CONNECTIONS = 20000;

function ensureBase() {
  fs.mkdirSync(BASE_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(BASE_DIR, 0o700);
}

function writeJSON(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function currentSession() {
  if (!fs.existsSync(POINTER)) throw new Error('没有当前检测；先选择开始检测');
  const state = readJSON(POINTER);
  const realBase = fs.realpathSync(BASE_DIR);
  const realSession = fs.realpathSync(state.dir);
  if (path.dirname(realSession) !== realBase ||
      !path.basename(realSession).startsWith('session-') ||
      !fs.existsSync(path.join(realSession, 'session.marker'))) {
    throw new Error('临时会话路径无效');
  }
  return { ...state, dir: realSession };
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function connectionKey(connection) {
  return connection.id || [
    connection.start, connection.metadata && connection.metadata.host,
    connection.metadata && connection.metadata.processPath,
    connection.rule, (connection.chains || []).join('/')
  ].join('|');
}

function recordSnapshot(seen, data, at, startedAt, overflow) {
  for (const connection of data.connections || []) {
    const key = connectionKey(connection);
    const upload = Number(connection.upload || 0);
    const download = Number(connection.download || 0);
    let item = seen.get(key);
    if (!item) {
      if (seen.size >= MAX_CONNECTIONS) { overflow.count++; continue; }
      item = {
        connection, firstSeenAt: at, lastSeenAt: at,
        firstUpload: upload, firstDownload: download,
        lastUpload: upload, lastDownload: download,
        newDuringCapture: Number.isFinite(Date.parse(connection.start)) &&
          Date.parse(connection.start) >= Date.parse(startedAt),
        sampleCount: 1
      };
      seen.set(key, item);
    } else {
      item.connection = connection;
      item.lastSeenAt = at;
      item.lastUpload = upload;
      item.lastDownload = download;
      item.sampleCount++;
    }
  }
}

function safeObservation(item) {
  const connection = item.connection;
  const metadata = connection.metadata || {};
  const processPath = metadata.processPath || '';
  const processTag = /\.local\/share\/claude\/versions\/[^/]+$/.test(processPath)
    ? 'Claude Code CLI'
    : /Claude\.app\/Contents\//.test(processPath)
      ? 'Claude Desktop' : path.basename(metadata.process || processPath) || null;
  const uploadDelta = Math.max(0, item.lastUpload - item.firstUpload);
  const downloadDelta = Math.max(0, item.lastDownload - item.firstDownload);
  return {
    firstSeenAt: item.firstSeenAt,
    lastSeenAt: item.lastSeenAt,
    newDuringCapture: item.newDuringCapture,
    uploadDelta, downloadDelta,
    activeDuringCapture: item.newDuringCapture || uploadDelta + downloadDelta > 0,
    sampleCount: item.sampleCount,
    category: classify(connection),
    host: metadata.host || null,
    process: processTag,
    destinationPort: metadata.destinationPort || null,
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
  const { config, configEnd, selectorsStart, selectorsEnd, connections, relay, rules,
    startedAt, endedAt, sampleCount, errors, overflow, autoStopped, egressSamples = [] } = input;
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
  const modeChanged = config.mode !== configEnd.mode || Boolean(config.tun?.enable) !== Boolean(configEnd.tun?.enable);
  const all = connections.map(x => evaluateConnection(safeObservation(x)));
  const active = all.filter(x => x.activeDuringCapture && !isProbeConnection(x));
  const relevant = active.filter(x => x.category !== 'other');
  if (config.mode !== 'rule') for (const item of relevant) item.result = 'NOT_EVALUATED';
  const evaluated = relevant.filter(x => x.result !== 'NOT_EVALUATED');
  const failures = evaluated.filter(x => x.result === 'FAIL');
  const claude = relevant.filter(x => x.category === 'claude');
  const g = policy.groups;
  const exit = selectorsEnd[g.claudeExit];
  const relayCount = claude.filter(x => x.chains.includes(g.relay)).length;
  const exitCount = active.filter(x => x.chains.includes(g.claudeExit)).length;
  const transitCount = active.filter(x => x.chains.includes(g.claude)).length;
  const expectedExit = exit && exit !== policy.exitOff && exit !== 'REJECT';
  const segmentEvidence = {
    relayConnections: relayCount,
    exitConnections: exitCount,
    transitConnections: transitCount,
    conclusion: !claude.length ? 'NO_CLAUDE_ACTIVITY'
      : !relayCount ? 'MISSING_RELAY'
      : !transitCount || (expectedExit && !exitCount) ? 'PARTIAL'
      : 'SEGMENTS_OBSERVED'
  };
  const issues = failures.map(x => ({
    severity: 'high', code: 'ROUTE_MISMATCH', host: x.host, process: x.process,
    expected: x.expected, actual: x.chains, rule: x.rule, rulePayload: x.rulePayload
  }));
  if (!priorityOK) issues.push({ severity: 'high', code: 'RULE_PRIORITY', priority });
  if (config.mode !== 'rule') issues.push({ severity: 'info', code: 'NOT_RULE_MODE' });
  if (!config.tun || !config.tun.enable) issues.push({ severity: 'info', code: 'TUN_OFF' });
  if (!relay) issues.push({ severity: 'high', code: 'RELAY_UNREACHABLE' });
  if (groupsChanged) issues.push({ severity: 'info', code: 'SELECTOR_CHANGED' });
  if (modeChanged) issues.push({ severity: 'info', code: 'MODE_OR_TUN_CHANGED' });
  const transit = selectorsEnd[g.claude];
  const selectorsReady = Boolean(transit && exit && transit !== 'REJECT' && exit !== 'REJECT');
  if (!selectorsReady) issues.push({ severity: 'info', code: 'CLAUDE_BLOCKED_OR_UNSET' });
  if (errors.length) issues.push({ severity: 'info', code: 'SAMPLING_ERRORS', count: errors.length });
  if (overflow.count) issues.push({ severity: 'info', code: 'CONNECTION_LIMIT', count: overflow.count });
  if (autoStopped) issues.push({ severity: 'info', code: 'MAX_DURATION_REACHED' });
  const status = !priorityOK || failures.length || !relay ? 'FAIL'
    : config.mode !== 'rule' || !config.tun?.enable || !selectorsReady || groupsChanged ||
      modeChanged || errors.length || overflow.count || autoStopped || !claude.length ||
      segmentEvidence.conclusion !== 'SEGMENTS_OBSERVED' ? 'INCONCLUSIVE' : 'PASS';
  return {
    schemaVersion: 3,
    startedAt, endedAt, status,
    scope: 'All observed Clash active connections; metadata only',
    environment: {
      mode: config.mode || null, tun: Boolean(config.tun && config.tun.enable),
      relayReachable: relay, selectors: selectorsEnd, selectorsChanged: groupsChanged,
      modeChanged, rulePriority: priority, rulePriorityOK: priorityOK
    },
    summary: {
      samples: sampleCount,
      observedConnections: all.length,
      activeConnections: active.length,
      activeClaudeConnections: claude.length,
      passed: evaluated.length - failures.length,
      failed: failures.length
    },
    claudeSegments: segmentEvidence,
    egress: egressSummary(egressSamples),
    issues,
    connections: all,
    fallbackCandidates: [...new Set(relevant.filter(x => x.category === 'fallback' && x.host).map(x => x.host))].slice(0, 100),
    limitations: [
      'Clash /connections 是活跃连接快照，极短连接仍可能在采样间隔内消失。',
      '已有连接仅在采样期间字节数增加时计入本次活动；新连接按建立时间识别。',
      '转发、中转和出口是不同连接；观察到各段不等于逐请求精确关联。',
      '公网 IPv4 通过独立回显请求定时探测；同一 IP 只代表采样时刻相同，无法证明间隔内没有变化。',
      '回显请求与 Claude 业务请求是不同连接；中转 IP 不等于 Anthropic 实际看到的最终出口 IP。'
    ]
  };
}

function markdown(report, jsonPath) {
  const clean = value => String(value === null || value === undefined ? '' : value)
    .replace(/[\r\n|]/g, ' ').slice(0, 180);
  const lines = [
    '# Clash 流量检测报告',
    '',
    '- **结论**：' + report.status,
    '- **采样**：' + report.startedAt + ' → ' + report.endedAt,
    '- **模式 / TUN**：' + clean(report.environment.mode) + ' / ' + report.environment.tun,
    '- **Claude 中转 / 出口**：' + clean(report.environment.selectors[policy.groups.claude]) +
      ' / ' + clean(report.environment.selectors[policy.groups.claudeExit]),
    '- **转发服务**：' + (report.environment.relayReachable ? '可达' : '不可达'),
    '- **连接**：观察 ' + report.summary.observedConnections + ' 条；采样期间有活动 ' +
      report.summary.activeConnections + ' 条；Claude 活动 ' + report.summary.activeClaudeConnections + ' 条',
    '- **原始元数据**：' + jsonPath,
    '',
    '## 链路段',
    '',
    '- relay：' + report.claudeSegments.relayConnections,
    '- 出口：' + report.claudeSegments.exitConnections,
    '- 中转：' + report.claudeSegments.transitConnections,
    '- 判定：' + report.claudeSegments.conclusion,
    '',
    '## 公网 IPv4 探测',
    '',
    '- **中转节点**：' + (report.egress.transit.nodes.map(clean).join('、') || '未确认'),
    '- **中转 IPv4**：' + (report.egress.transit.ips.join('、') || '未探测到'),
    '- **中转稳定性**：' + report.egress.transit.stability + '（仅代表采样时刻）',
    '- **最终出口 IPv4**：' + (report.egress.exit.ips.join('、') || '未探测到'),
    '',
    '| 时间 | 中转选择 / 实际节点 | 中转 IPv4 | 出口选择 / 实际节点 | 最终出口 IPv4 | 探测结果 |',
    '| --- | --- | --- | --- | --- | --- |'
  ];
  for (const sample of report.egress.samples) {
    lines.push('| ' + clean(sample.at) + ' | ' +
      clean([sample.transit?.selection, sample.transit?.node].filter(Boolean).join(' → ')) + ' | ' +
      clean(sample.transit?.ip || '未知') + ' | ' +
      clean([sample.exit?.selection, sample.exit?.node].filter(Boolean).join(' → ')) + ' | ' +
      clean(sample.exit?.ip || '未知') + ' | ' +
      clean([sample.transit?.error, sample.exit?.error,
        sample.selectionChangedDuringProbe ? '探测期间分组变化，节点与 IP 的对应关系不确定' : null]
        .filter(Boolean).join('；') || '成功') + ' |');
  }
  if (!report.egress.samples.length) lines.push('| 未执行 | | | | | |');
  lines.push('',
    '## 异常',
    ''
  );
  if (!report.issues.length) lines.push('未发现已证实异常。');
  else for (const issue of report.issues) lines.push('- ' + clean(issue.code) + '：' + clean(issue.host || issue.detail || issue.count || ''));
  lines.push('', '## 相关活动连接', '',
    '| 域名 | 进程 | 命中规则 | 实际链路 | 结果 | 上传 / 下载变化 |',
    '| --- | --- | --- | --- | --- | --- |');
  for (const item of report.connections.filter(x => x.activeDuringCapture && x.category !== 'other').slice(0, 100)) {
    lines.push('| ' + clean(item.host) + ' | ' + clean(item.process) + ' | ' +
      clean(item.rule + ':' + item.rulePayload) + ' | ' + clean(item.chains.join(' → ')) +
      ' | ' + item.result + ' | ' + item.uploadDelta + ' / ' + item.downloadDelta + ' |');
  }
  if (!report.summary.activeClaudeConnections) lines.push('', '本次未观察到 Claude 请求活动，不能判定其业务链路正常。');
  lines.push('', '## 边界', '', ...report.limitations.map(x => '- ' + x), '');
  return lines.join('\n');
}

async function worker(dir) {
  try {
    const socketPath = process.env.CLASH_CONTROLLER_SOCKET ||
      '/var/run/clash-verge-service/users/' + process.getuid() + '/verge-mihomo.sock';
    const [config, proxiesStart, rules, relay] = await Promise.all([
      getJSON(socketPath, '/configs'), getJSON(socketPath, '/proxies'),
      getJSON(socketPath, '/rules'), relayReachable()
    ]);
    const startedAt = new Date().toISOString();
    const seen = new Map();
    const errors = [];
    const overflow = { count: 0 };
    const egressSamples = [];
    let pendingProbe = null;
    let lastProbeAt = 0;
    const launchProbe = () => {
      if (pendingProbe) return;
      lastProbeAt = Date.now();
      pendingProbe = captureEgress(socketPath)
        .then(result => egressSamples.push(result))
        .catch(error => egressSamples.push({ at: new Date().toISOString(),
          transit: { node: null, ip: null, error: error.message }, exit: null }))
        .finally(() => { pendingProbe = null; });
    };
    let sampleCount = 0;
    const sample = async () => {
      try {
        const data = await getJSON(socketPath, '/connections');
        recordSnapshot(seen, data, new Date().toISOString(), startedAt, overflow);
        sampleCount++;
      } catch (error) { if (errors.length < 20) errors.push(error.message); }
    };
    await sample();
    if (!sampleCount) throw new Error('首次连接快照失败：' + (errors[0] || '未知错误'));
    writeJSON(path.join(dir, 'ready.json'), { startedAt, pid: process.pid });
    launchProbe();
    while (!fs.existsSync(path.join(dir, 'stop')) && Date.now() - Date.parse(startedAt) < MAX_MS) {
      await sleep(INTERVAL_MS);
      await sample();
      if (Date.now() - lastProbeAt >= 60000) launchProbe();
    }
    if (pendingProbe) await pendingProbe;
    egressSamples.push(await captureEgress(socketPath));
    const autoStopped = !fs.existsSync(path.join(dir, 'stop'));
    const endedAt = new Date().toISOString();
    let configEnd = config;
    let proxiesEnd = proxiesStart;
    try {
      [configEnd, proxiesEnd] = await Promise.all([
        getJSON(socketPath, '/configs'), getJSON(socketPath, '/proxies')
      ]);
    } catch (error) { errors.push('结束时状态读取失败：' + error.message); }
    const report = buildReport({
      config, configEnd, selectorsStart: selectorSnapshot(proxiesStart),
      selectorsEnd: selectorSnapshot(proxiesEnd), rules, relay,
      connections: [...seen.values()], startedAt, endedAt,
      sampleCount, errors, overflow, autoStopped, egressSamples
    });
    const jsonPath = path.join(dir, 'report.json');
    const mdPath = path.join(dir, 'report.md');
    writeJSON(jsonPath, report);
    fs.writeFileSync(mdPath, markdown(report, jsonPath), { mode: 0o600 });
    writeJSON(path.join(dir, 'done.json'), {
      status: report.status, report: mdPath, raw: jsonPath,
      startedAt, endedAt, summary: report.summary
    });
  } catch (error) {
    writeJSON(path.join(dir, 'error.json'), { error: error.message, at: new Date().toISOString() });
    process.exitCode = 1;
  }
}

async function start() {
  ensureBase();
  if (fs.existsSync(POINTER)) {
    const prior = currentSession();
    if (!fs.existsSync(path.join(prior.dir, 'done.json')) &&
        !fs.existsSync(path.join(prior.dir, 'error.json')) &&
        isAlive(prior.pid)) throw new Error('已有采样正在进行；先回复结束检测');
  }
  const dir = fs.mkdtempSync(path.join(BASE_DIR, 'session-'));
  fs.chmodSync(dir, 0o700);
  fs.writeFileSync(path.join(dir, 'session.marker'), 'clash-traffic-monitor-v2\n', { mode: 0o600 });
  const log = fs.openSync(path.join(dir, 'worker.log'), 'a', 0o600);
  const child = spawn(process.execPath, [__filename, 'worker', dir], {
    detached: true, stdio: ['ignore', log, log], env: process.env
  });
  child.unref();
  fs.closeSync(log);
  writeJSON(POINTER, { dir, pid: child.pid });
  for (let i = 0; i < 50; i++) {
    if (fs.existsSync(path.join(dir, 'ready.json'))) {
      return { state: 'READY', dir, ...readJSON(path.join(dir, 'ready.json')) };
    }
    if (fs.existsSync(path.join(dir, 'error.json'))) throw new Error(readJSON(path.join(dir, 'error.json')).error);
    if (!isAlive(child.pid)) throw new Error('采样进程已退出；查看 ' + path.join(dir, 'worker.log'));
    await sleep(200);
  }
  process.kill(child.pid, 'SIGTERM');
  throw new Error('采样启动超时');
}

async function stop() {
  const state = currentSession();
  const donePath = path.join(state.dir, 'done.json');
  if (!fs.existsSync(donePath)) fs.writeFileSync(path.join(state.dir, 'stop'), '', { mode: 0o600 });
  for (let i = 0; i < 160; i++) {
    if (fs.existsSync(donePath)) return { state: 'DONE', ...readJSON(donePath) };
    if (fs.existsSync(path.join(state.dir, 'error.json'))) throw new Error(readJSON(path.join(state.dir, 'error.json')).error);
    if (!isAlive(state.pid)) throw new Error('采样进程异常退出；查看 ' + path.join(state.dir, 'worker.log'));
    await sleep(200);
  }
  throw new Error('采样停止超时；可再次执行 stop');
}

function status() {
  const state = currentSession();
  const done = path.join(state.dir, 'done.json');
  if (fs.existsSync(done)) return { state: 'DONE', ...readJSON(done) };
  if (fs.existsSync(path.join(state.dir, 'error.json'))) return { state: 'ERROR', ...readJSON(path.join(state.dir, 'error.json')) };
  return { state: isAlive(state.pid) ? 'RUNNING' : 'STOPPED_UNEXPECTEDLY',
    dir: state.dir, ready: fs.existsSync(path.join(state.dir, 'ready.json')) };
}

function clear() {
  ensureBase();
  if (fs.existsSync(POINTER)) {
    const state = currentSession();
    if (!fs.existsSync(path.join(state.dir, 'done.json')) &&
        !fs.existsSync(path.join(state.dir, 'error.json')) &&
        isAlive(state.pid)) throw new Error('采样仍在进行；先结束检测');
  }
  let removed = 0;
  for (const name of fs.readdirSync(BASE_DIR)) {
    if (!name.startsWith('session-')) continue;
    const dir = path.join(BASE_DIR, name);
    if (!fs.existsSync(path.join(dir, 'session.marker'))) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    removed++;
  }
  if (fs.existsSync(POINTER)) fs.unlinkSync(POINTER);
  return { state: 'CLEARED', removedSessions: removed };
}

async function main() {
  const command = process.argv[2] || 'help';
  if (command === 'help' || command === '--help') {
    process.stdout.write('用法：node check.cjs start|stop|status|clear\n报告保存在对话临时目录；采样持续到 stop，最长 60 分钟。\n');
    return;
  }
  if (command === 'worker') { await worker(process.argv[3]); return; }
  const result = command === 'start' ? await start()
    : command === 'stop' ? await stop()
    : command === 'status' ? status()
    : command === 'clear' ? clear()
    : (() => { throw new Error('未知命令：' + command); })();
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (require.main === module) {
  main().catch(error => { process.stderr.write('检测失败：' + error.message + '\n'); process.exitCode = 1; });
}
module.exports = { classify, safeObservation, evaluateConnection, buildReport, recordSnapshot,
  markdown, selectedLeaf, egressSummary, captureEgress };
