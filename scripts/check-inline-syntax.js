/**
 * 前台内联脚本语法体检
 *
 * 用途：site/*.html 里的内联 <script> 一旦有语法错误，整个 Vue app 会静默挂载失败
 *      （页面 #app 空白，但在浏览器里只报一行 SyntaxError，很容易漏）。
 *      原本这类残骸多次出现在「静态模式」改造之后（axios(...).then(...) 被替换成
 *      console.log 但没删干净闭包体）。本脚本用 vm.Script 只编译不执行，全量体检。
 *
 * 用法：
 *   node scripts/check-inline-syntax.js                  # 默认体检 site/*.html
 *   node scripts/check-inline-syntax.js site/a.html ...  # 指定文件
 *
 * 退出码：全部通过 0，存在语法错误 1（可用于 CI / 提交前自检）
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function defaultTargets() {
  const dir = path.join(__dirname, '..', 'site');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort().map((f) => path.join('site', f));
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : defaultTargets();

let bad = 0;
let totalBlocks = 0;

for (const f of files) {
  if (!fs.existsSync(f)) {
    console.log(`  ! 文件不存在：${f}`);
    bad++;
    continue;
  }
  const html = fs.readFileSync(f, 'utf8');
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, idx = 0, n = 0, errs = 0;
  while ((m = re.exec(html))) {
    idx++;
    const attrs = m[1] || '';
    const code = m[2] || '';
    if (/\bsrc\s*=/.test(attrs)) continue;               // 外链脚本跳过
    // 跳过非 JS 脚本（Drupal 的 application/json 配置块等，否则 JSON 会被误判为 JS）
    const typeMatch = /type\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
    const type = typeMatch ? typeMatch[1].toLowerCase() : '';
    if (type && !/javascript|ecmascript|module/.test(type)) continue;
    if (!code.trim()) continue;
    n++;
    totalBlocks++;
    const line = html.slice(0, m.index).split('\n').length;   // 脚本起始行号
    try {
      new vm.Script(code, { filename: `${f}#${idx}` });
    } catch (e) {
      errs++;
      bad++;
      console.log(`  ✗ ${f}:${line} — ${e.message}`);
    }
  }
  if (n > 0) console.log(`${errs === 0 ? '  ✓' : '  ✗'} ${f} — 内联脚本 ${n} 个，语法错误 ${errs} 个`);
}

console.log(
  bad === 0
    ? `\n✅ ${files.length} 个文件 / ${totalBlocks} 段内联脚本，语法全部通过`
    : `\n❌ 共 ${bad} 处语法错误`
);
process.exit(bad === 0 ? 0 : 1);
