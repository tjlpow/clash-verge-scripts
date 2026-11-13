#!/usr/bin/env node
// 管理 Clash Verge 的全局扩展脚本。只写本机 Script.js，不操作 Clash 进程或策略组。
// 版本源码：clash-verge.js（current）和 clash-verge-safe.js（safe）。
// safe 标记为 ready 且提供 main(config) 后才能切换。

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const child = require("node:child_process");

const root = __dirname;
const active = path.join(root, "Script.js");
const variants = {
  current: path.join(root, "clash-verge.js"),
  safe: path.join(root, "clash-verge-safe.js")
};

function read(file) {
  return fs.readFileSync(file);
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function inspect(name) {
  const file = variants[name];
  const content = read(file);
  const head = content.toString("utf8", 0, Math.min(content.length, 512));
  const variant = head.match(/^\/\/ CLASH_VARIANT: ([a-z]+)$/m)?.[1];
  const state = head.match(/^\/\/ CLASH_VARIANT_STATUS: ([a-z]+)$/m)?.[1];
  if (variant !== name || !["ready", "draft"].includes(state)) {
    throw new Error(`${path.basename(file)} 的版本或状态标记无效`);
  }
  return { file, content, state };
}

function activeMode() {
  const current = read(active);
  for (const name of Object.keys(variants)) {
    if (digest(current) === digest(read(variants[name]))) return name;
  }
  return "custom";
}

function checkReady(name, variant) {
  if (variant.state !== "ready") {
    throw new Error(`${name} 版仍为 draft；真实出口链路通过验收前不能启用`);
  }
  if (!/\bfunction\s+main\s*\(/.test(variant.content.toString("utf8"))) {
    throw new Error(`${name} 版缺少 main(config)，不能启用`);
  }
  const result = child.spawnSync(process.execPath, ["--check", variant.file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${name} 版语法检查失败：${result.stderr.trim()}`);
  if (name === "safe") {
    for (const file of ["safe-direct.yaml", "safe-cncidr.yaml", "safe-reject.yaml", "safe-ai-cn.yaml"]) {
      const cache = path.join(root, file);
      if (!fs.existsSync(cache) || !fs.readFileSync(cache, "utf8").slice(0, 600).includes("payload:")) {
        throw new Error(`缺少有效的 ${file}；请先预存安全版规则集`);
      }
    }
  }
}

// 原位写入，保留 Clash Verge 已登记的 Script.js 文件与 inode。
function writeActive(content) {
  const previous = read(active);
  const fd = fs.openSync(active, "r+");
  try {
    let offset = 0;
    while (offset < content.length) {
      const n = fs.writeSync(fd, content, offset, content.length - offset, offset);
      if (n <= 0) throw new Error("写入 Script.js 失败");
      offset += n;
    }
    fs.ftruncateSync(fd, content.length);
    fs.fsyncSync(fd);
  } catch (error) {
    try {
      fs.writeSync(fd, previous, 0, previous.length, 0);
      fs.ftruncateSync(fd, previous.length);
      fs.fsyncSync(fd);
    } catch (restoreError) {
      throw new Error(`写入失败且恢复失败：${error.message}；${restoreError.message}`);
    }
    throw error;
  } finally {
    fs.closeSync(fd);
  }
  if (digest(read(active)) !== digest(content)) throw new Error("Script.js 写入校验失败");
}

function run(command) {
  if (!command || command === "status") {
    const mode = activeMode();
    console.log(`运行入口：${active}\n当前版本：${mode}`);
    for (const name of Object.keys(variants)) {
      const variant = inspect(name);
      console.log(`${name}：${variant.state}（${path.basename(variant.file)}）`);
    }
    return;
  }
  if (!Object.hasOwn(variants, command)) {
    throw new Error("用法：node switch-clash-verge.js [status|current|safe]");
  }
  const variant = inspect(command);
  checkReady(command, variant);
  const before = activeMode();
  if (before === "custom") {
    throw new Error("Script.js 与两份源码都不一致；请先核对并保存改动，避免覆盖");
  }
  if (before === command) {
    console.log(`已经是 ${command} 版，无需切换。`);
    return;
  }
  writeActive(variant.content);
  console.log(`已将 ${command} 版写入 Script.js；请自行重启 Clash Verge 并核对策略组。`);
}

try {
  run(process.argv[2]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
