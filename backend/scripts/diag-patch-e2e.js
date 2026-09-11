/**
 * E2E 冒烟：content-patches 接口（真实 HTTP 调用，测试后回滚数据）
 * 1. 记录 id=9013 原始 contentHtml
 * 2. 构造 text + video 两类补丁（jsdom 构造正确路径）
 * 3. POST /api/news/9013/content-patches
 * 4. 校验响应 + 错误补丁拒绝场景
 * 5. 回滚原始 contentHtml
 */
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const p = new PrismaClient();

const API = 'http://localhost:3000/api';
const TOKEN = jwt.sign({ id: 1, username: 'patch-smoke', role: 'super_admin' }, 'Gattefosse_JWT_Secret_Key_2026_Change_In_Production', { expiresIn: '10m' });

(async () => {
  const item = await p.newsEvent.findUnique({ where: { id: 9013 }, select: { contentHtml: true } });
  const original = item.contentHtml;
  fs.writeFileSync(path.resolve(__dirname, 'tmp-9013-backup.html'), original);
  console.log('原始 contentHtml 长度 =', original.length, '（备份至 scripts/tmp-9013-backup.html）');

  // 构造补丁路径
  const dom = new JSDOM('<div id="cp-root">' + original + '</div>');
  const root = dom.window.document.getElementById('cp-root');
  function buildPath(node) {
    const pa = []; let cur = node;
    while (cur && cur !== root) { const par = cur.parentNode; pa.unshift({ i: Array.prototype.indexOf.call(par.childNodes, cur), tag: cur.nodeName }); cur = par; }
    return cur === root && pa.length ? pa : null;
  }
  let textNode = null;
  const walker = dom.window.document.createTreeWalker(root, dom.window.NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode())) { if (n.nodeValue.trim().length > 30) { textNode = n; break; } }
  const ifrEl = root.querySelector('iframe.youtube_player');
  const origText = textNode.nodeValue;
  const origVideo = ifrEl.getAttribute('src');

  const patches = [
    { type: 'text', path: buildPath(textNode), old: origText, next: '【接口冒烟】' + origText },
    { type: 'video', path: buildPath(ifrEl), old: origVideo, next: 'https://www.youtube.com/embed/SMOKE123456' },
  ];

  // 正常补丁
  let r = await fetch(API + '/news/9013/content-patches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ patches }),
  });
  let j = await r.json();
  console.log('正常补丁: HTTP', r.status, '| code =', j.code, '| message =', j.message);
  const ok1 = j.code === 0 && j.data.html.includes('【接口冒烟】') && j.data.html.includes('SMOKE123456');
  console.log('  文本+视频已落库:', ok1 ? '✅' : '❌');

  // 错误补丁（old 不匹配）应 400
  r = await fetch(API + '/news/9013/content-patches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ patches: [{ type: 'text', path: patches[0].path, old: '错误旧值', next: 'hack' }] }),
  });
  j = await r.json();
  console.log('错误补丁: HTTP', r.status, '| code =', j.code, '|', (j.message || '').slice(0, 60));
  console.log('  被拒绝:', r.status === 400 && !JSON.stringify(j).includes('hack') ? '✅' : '❌');

  // 回滚
  await p.newsEvent.update({ where: { id: 9013 }, data: { contentHtml: original } });
  const after = await p.newsEvent.findUnique({ where: { id: 9013 }, select: { contentHtml: true } });
  console.log('回滚后与原文一致:', after.contentHtml === original ? '✅' : '❌');
  fs.unlinkSync(path.resolve(__dirname, 'tmp-9013-backup.html'));
  await p.$disconnect();
})();
