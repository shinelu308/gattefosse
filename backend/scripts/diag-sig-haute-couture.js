/**
 * 诊断脚本：复现「正文结构与原站一致」校验失败
 * 用 dist 编译产物对比校验器签名（originContent）与导入器签名（blocks 拼接）
 */
const fs = require('fs');
const path = require('path');
const rules = require(path.resolve(__dirname, '../dist/utils/import-rules'));

const html = fs.readFileSync(path.resolve(__dirname, '../haute-origin-tmp.html'), 'utf8');

// ===== 校验器路径：originContent =====
const articleDiv = rules.extractDivByClass(html, 'node--view-mode-full');
console.log('articleDiv len =', articleDiv ? articleDiv.length : 'NULL');
const start = articleDiv.indexOf('<div class="node__content">');
console.log('node__content start =', start);
const oContent = rules.extractBalancedDiv(articleDiv, start);
console.log('oContent len =', oContent ? oContent.length : 'NULL');
const s1 = rules.structureSignature(rules.removeParagraphBlocks(oContent, ['widget', 'linked-content']));
console.log('\n=== 校验器签名（原站） ===');
console.log(s1);

// ===== 导入器路径：splitChildDivs → blocks =====
function splitChildDivs(divHtml) {
  const openEnd = divHtml.indexOf('>');
  if (openEnd < 0) return [];
  let i = openEnd + 1;
  const children = [];
  while (i < divHtml.length) {
    const nextDiv = divHtml.indexOf('<div', i);
    const closeIdx = divHtml.indexOf('</div>', i);
    if (nextDiv < 0) break;
    if (closeIdx >= 0 && closeIdx < nextDiv) break;
    const frag = rules.extractBalancedDiv(divHtml, nextDiv);
    if (!frag) break;
    children.push(frag);
    i = nextDiv + frag.length;
  }
  return children;
}
function getAttr(fragment, attr) {
  const m = new RegExp(attr + '="([^"]*)"').exec(fragment);
  return m ? m[1] : null;
}
const contentDiv = rules.extractBalancedDiv(articleDiv, start);
const children = splitChildDivs(contentDiv);
console.log('\n=== splitChildDivs 子区块（共 ' + children.length + ' 个） ===');
const blocks = [];
children.forEach((child, idx) => {
  const cls = getAttr(child, 'class') || '';
  let decision = 'KEEP';
  if (cls.includes('paragraph--type--widget') || cls.includes('salesforce')) decision = 'SKIP-widget';
  else if (cls.includes('paragraph--type--linked-content')) decision = 'SKIP-linked';
  if (decision === 'KEEP') blocks.push(child);
  console.log(`[${idx}] ${decision} | class="${cls.slice(0, 110)}"`);
});

let contentHtml = blocks.join('\n');
// 视频区块转 iframe（镜像导入器新逻辑）
contentHtml = contentHtml.replace(
  /<div([^>]*class="[^"]*youtube_player[^"]*"[^>]*)><\/div>/gi,
  (full, attrs) => {
    const vidM = /\bvideoID="([^"]+)"/i.exec(attrs);
    if (!vidM || !/^[A-Za-z0-9_-]{6,20}$/.test(vidM[1])) return full;
    return `<iframe class="youtube_player" src="https://www.youtube.com/embed/${vidM[1]}" title="Video player" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  },
);
const cleaned = rules.cleanBingLinks(contentHtml);
contentHtml = cleaned.html;
const s2 = rules.structureSignature(rules.removeParagraphBlocks(contentHtml, ['widget', 'linked-content']));
console.log('\n=== 导入器签名（模拟产出） ===');
console.log(s2);
console.log('\n签名一致 =', s1 === s2);

// 逐 token 对比
const t1 = s1.split('>');
const t2 = s2.split('>');
console.log('\ntoken 数：原站 ' + t1.length + ' / 导入 ' + t2.length);
const max = Math.max(t1.length, t2.length);
for (let i = 0; i < max; i++) {
  if (t1[i] !== t2[i]) {
    console.log(`首个差异 @${i}: 原站="${t1.slice(i, i + 6).join('>')}"  导入="${t2.slice(i, i + 6).join('>')}"`);
    break;
  }
}
