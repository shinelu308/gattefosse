#!/usr/bin/env node
/**
 * 嘉法狮站点统一启动器（前台 / + 后台 /admin + API，统一 3000 端口）
 *
 * 做四件事：
 *   1. 结束占用 3000 端口的旧进程
 *   2. 比较 backend/src/**\/*.ts 与 backend/dist/**\/*.js 的最大 mtime，只在新代码时才编译
 *      （避免白编译一次把版本号 system_build_id 顶上去）
 *   3. 需要时跑 tsc
 *   4. 以常驻方式启动 node dist/index.js
 *
 * 用法：  node scripts/start-site.js
 *        node scripts/start-site.js --skip-tsc     强制不编译
 *        node scripts/start-site.js --force-tsc    强制编译
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BE = path.join(ROOT, 'backend');
const ENTRY = path.join(BE, 'dist', 'index.js');
const NODE = process.execPath;
const PORT = process.env.PORT || '3000';

const argv = process.argv.slice(2);
const FORCE_TSC = argv.includes('--force-tsc');
const SKIP_TSC = argv.includes('--skip-tsc');

const out = (m) => process.stdout.write(m + '\n');
const line = () => out('-'.repeat(52));

/* ---------- 1. 结束占用端口的旧进程 ---------- */
function killPort(port) {
  const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
  if (r.error || r.status !== 0 || !r.stdout) {
    out('  ! 无法读取 netstat，跳过旧进程清理');
    return;
  }
  const pids = new Set();
  for (const raw of r.stdout.split(/\r?\n/)) {
    if (!raw.includes(':' + port)) continue;
    if (!/LISTENING/i.test(raw)) continue;
    const cols = raw.trim().split(/\s+/);
    const pid = cols[cols.length - 1];
    if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
  }
  if (!pids.size) {
    out('  3000 端口空闲，无需清理');
    return;
  }
  for (const pid of pids) {
    out('  结束旧进程 PID ' + pid);
    spawnSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' });
  }
}

/* ---------- 2. 目录最大 mtime ---------- */
function maxMtime(dir, ext) {
  let max = 0;
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        walk(p);
      } else if (e.name.endsWith(ext)) {
        try {
          const t = fs.statSync(p).mtimeMs;
          if (t > max) max = t;
        } catch { /* ignore */ }
      }
    }
  };
  walk(dir);
  return max;
}

/* ---------- main ---------- */
line();
out('  嘉法狮站点启动器');
out('  前台 http://localhost:' + PORT + '/    后台 http://localhost:' + PORT + '/admin/');
line();

out('[1/3] 清理端口 ' + PORT);
killPort(PORT);

out('');
out('[2/3] 检查是否需要编译');

let needTsc = false;
let why = '';

if (SKIP_TSC) {
  why = '按要求跳过编译';
} else if (!fs.existsSync(ENTRY)) {
  needTsc = true;
  why = 'dist/index.js 不存在';
} else {
  const srcMax = maxMtime(path.join(BE, 'src'), '.ts');
  const distMax = maxMtime(path.join(BE, 'dist'), '.js');
  const srcT = srcMax ? new Date(srcMax).toLocaleString() : '(无)';
  const distT = distMax ? new Date(distMax).toLocaleString() : '(无)';
  out('  src  最新: ' + srcT);
  out('  dist 最新: ' + distT);
  if (FORCE_TSC) {
    needTsc = true;
    why = '指定 --force-tsc';
  } else if (srcMax > distMax + 1000) {
    needTsc = true;
    why = 'src 比 dist 新';
  } else {
    why = 'dist 已是最新，跳过编译（不递增版本号）';
  }
}
out('  → ' + why);

if (needTsc) {
  const tscBin = path.join(BE, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!fs.existsSync(tscBin)) {
    out('  ! 找不到 ' + tscBin + '，请先在 backend 下 npm install');
    process.exit(1);
  }
  out('  正在编译（node ' + path.relative(BE, tscBin) + '）...');
  const r = spawnSync(NODE, [tscBin], { cwd: BE, stdio: 'inherit' });
  if (r.status !== 0) {
    line();
    out('  编译失败（exit ' + r.status + '），已中止。把上面的报错发我即可。');
    process.exit(1);
  }
  out('  编译完成');
}

out('');
out('[3/3] 启动服务（保持本窗口不要关闭）');
line();
out('  前台  http://localhost:' + PORT + '/');
out('  后台  http://localhost:' + PORT + '/admin/');
out('  停止  在本窗口按 Ctrl+C');
line();
out('');

const child = spawn(NODE, [ENTRY], {
  cwd: BE,
  stdio: 'inherit',
  env: Object.assign({}, process.env, { PORT: String(PORT) }),
});

const bye = () => {
  out('\n正在停止服务...');
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  setTimeout(() => process.exit(0), 400);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);

child.on('exit', (code) => {
  out('\n服务已退出（exit ' + code + '）。');
  process.exit(code === null ? 1 : code);
});
