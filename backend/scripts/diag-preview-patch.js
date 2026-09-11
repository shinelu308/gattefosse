/**
 * 冒烟：预览编辑补丁回填（text/img/video 三类）
 * 对库内真实文章（默认 id=9013 haute-couture）做补丁回填——只验证函数，不落库
 */
const path = require('path');
const fs = require('fs');

// 1) 语法检查 iframe 内脚本
const vm = require('vm');
const inlineSrc = fs.readFileSync(path.resolve(__dirname, '../../admin/preview-inline-260911.js'), 'utf8');
new vm.Script(inlineSrc, { filename: 'preview-inline-260911.js' });
console.log('✅ preview-inline-260911.js 语法 OK');

// 2) 回填工具三类补丁
const { applyContentPatches, extractYoutubeId } = require(path.resolve(__dirname, '../dist/utils/content-patch'));

console.log('extractYoutubeId:',
  extractYoutubeId('https://www.youtube.com/watch?v=abc12345678') === 'abc12345678' ? '✅' : '❌',
  extractYoutubeId('https://youtu.be/kD946vstowU') === 'kD946vstowU' ? '✅' : '❌',
  extractYoutubeId('kD946vstowU') === 'kD946vstowU' ? '✅' : '❌',
  extractYoutubeId('https://evil.com') === null ? '✅' : '❌'
);

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const item = await p.newsEvent.findUnique({ where: { id: 9013 }, select: { contentHtml: true } });
  if (!item || !item.contentHtml) { console.log('❌ id=9013 无正文'); process.exit(1); }
  const html = item.contentHtml;

  // jsdom 里找到目标节点构造路径（模拟 iframe 端 path 构造）
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="cp-root">' + html + '</div>');
  const root = dom.window.document.getElementById('cp-root');
  function buildPath(node) {
    const r = root; const pa = []; let cur = node;
    while (cur && cur !== r) { const par = cur.parentNode; pa.unshift({ i: Array.prototype.indexOf.call(par.childNodes, cur), tag: cur.nodeName }); cur = par; }
    return cur === r && pa.length ? pa : null;
  }
  // 找一个文本节点 / img / iframe
  let textNode = null, imgEl = null, ifrEl = null;
  const walker = dom.window.document.createTreeWalker(root, dom.window.NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode())) { if (n.nodeValue.trim().length > 20) { textNode = n; break; } }
  imgEl = root.querySelector('img');
  ifrEl = root.querySelector('iframe.youtube_player');
  console.log('样例目标: text=', !!textNode, '| img=', !!imgEl, '| iframe=', !!ifrEl);

  const patches = [];
  const origText = textNode.nodeValue;
  patches.push({ type: 'text', path: buildPath(textNode), old: origText, next: origText.replace(/Gattefossé/, 'GATTEFOSSE【测试改写】') || origText + '。' });
  if (imgEl) patches.push({ type: 'img', path: buildPath(imgEl), old: imgEl.getAttribute('src'), next: '/uploads/articles/preview-test-new.jpg' });
  if (ifrEl) patches.push({ type: 'video', path: buildPath(ifrEl), old: ifrEl.getAttribute('src'), next: 'https://www.youtube.com/embed/dQw4w9WgXcQ' });

  // 错误补丁（old 故意不匹配）应被拒绝
  patches.push({ type: 'text', path: buildPath(textNode), old: '完全不匹配的旧值xxx', next: 'hack' });

  const before = { imgCount: (html.match(/<img/g) || []).length, classAttr: (html.match(/class="/g) || []).length };
  const result = applyContentPatches(html, patches);
  const after = { imgCount: (result.html.match(/<img/g) || []).length, classAttr: (result.html.match(/class="/g) || []).length };

  console.log('applied =', result.applied, '| failed =', JSON.stringify(result.failed));
  console.log('img 数不变:', before.imgCount === after.imgCount ? '✅' : '❌', `(${before.imgCount}→${after.imgCount})`);
  console.log('class 属性数不变:', before.classAttr === after.classAttr ? '✅' : '❌', `(${before.classAttr}→${after.classAttr})`);
  console.log('文本已改写:', result.html.includes('【测试改写】') ? '✅' : '❌');
  console.log('图片 src 已替换:', result.html.includes('/uploads/articles/preview-test-new.jpg') ? '✅' : '❌');
  console.log('视频 src 已替换:', result.html.includes('dQw4w9WgXcQ') ? '✅' : '❌');
  console.log('原 src 已消失:', imgEl && !result.html.includes(imgEl.getAttribute('src')) ? '✅' : '❌');
  console.log('错误补丁被拒（未写入 hack）:', !result.html.includes('>hack<') ? '✅' : '❌');

  // 结构签名一致性（回填后与原站结构签名应完全一致——只动文本/src）
  const rules = require(path.resolve(__dirname, '../dist/utils/import-rules'));
  const fs2 = require('fs');
  console.log('签名前后一致:', rules.structureSignature(html) === rules.structureSignature(result.html) ? '✅' : '❌');

  await p.$disconnect();
})();
