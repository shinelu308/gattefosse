/**
 * press 页补齐英文站缺失的 PR 年份组（幂等）
 * 来源：https://www.gattefosse.com/press（.localize_tmp/press_en_raw.html）
 * 动作：
 *  1. 提取英文站 2026 / 2025 两个完整 acc item，插入本地 accordion 最前部
 *  2. 提取英文站 2024 组缺失的 2 条 PR（india-inauguration / color-pulse），插入本地 2024 组列表开头
 *  3. 本地 2024 组收起（collapsed），保持仅首组展开（对齐英文站）
 *  /files/ 相对链接统一重写为 https://www.gattefosse.com/files/ 绝对链接
 * 幂等：插入段用 <!-- EN_PR_START --> / <!-- EN_PR_END --> 标记包裹，重跑先剥离再插入
 * 运行：cd backend && npx tsx scripts/import-press-en-prs.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const RAW = '../.localize_tmp/press_en_raw.html';
const MARK_S = '<!-- EN_PR_START -->';
const MARK_E = '<!-- EN_PR_END -->';

function stripMarks(html: string): string {
  // 剥离之前插入的带标记段（可能多处）
  let out = html;
  while (out.includes(MARK_S) && out.includes(MARK_E)) {
    const s = out.indexOf(MARK_S);
    const e = out.indexOf(MARK_E, s);
    if (e === -1) break;
    out = out.slice(0, s) + out.slice(e + MARK_E.length);
  }
  return out;
}

function rewriteFiles(seg: string): string {
  return seg.split('href="/files/').join('href="https://www.gattefosse.com/files/');
}

async function main() {
  const fs = await import('fs');
  const raw = fs.readFileSync(RAW, 'utf8');

  // —— 提取英文站 acc item 段 ——
  const parts = raw.split('<!-- debut acc item -->');
  if (parts.length < 4) throw new Error(`EN raw acc items 不足: ${parts.length - 1}`);
  const getItem = (seg: string) => {
    const fin = seg.indexOf('<!-- fin acc item -->');
    return seg.slice(0, fin).trim();
  };
  const acc2026 = getItem(parts[1]);
  const acc2025 = getItem(parts[2]);
  const acc2024en = getItem(parts[3]);

  // 2024 缺失条目（li 级提取）
  const lis = acc2024en.split('<li class="c-link c-link--document">').slice(1)
    .map(s => '<li class="c-link c-link--document">' + s.slice(0, s.indexOf('</li>') + 5));
  const liIndia = lis.find(s => s.includes('india-inauguration'));
  const liColor = lis.find(s => s.includes('color-pulse'));
  if (!liIndia || !liColor) throw new Error('未找到 2024 缺失条目 india/color-pulse');

  // —— 读取本地当前内容 ——
  const row = await prisma.pageContent.findUnique({ where: { id: 97 } });
  if (!row) throw new Error('page_contents id=97 (press) 不存在');
  let html = stripMarks(row.contentHtml);

  // 1) 2024 组收起：accordion-button 加 collapsed，collapse 去 show
  const acc2024Local = html.match(/id="accordion-2024-[^"]*"[\s\S]*?<\/ul>\s*<\/div>/);
  if (acc2024Local) {
    let seg2024 = acc2024Local[0];
    const fixed = seg2024
      .replace(/class="panel-title accordion-button"(?![^>]*collapsed)/, 'class="panel-title accordion-button collapsed"')
      .replace(/aria-expanded="true"/, 'aria-expanded="false"')
      .replace(/class="panel-collapse collapse show"/, 'class="panel-collapse collapse"');
    html = html.replace(seg2024, fixed);
  }

  // 2) 2024 组列表开头插入缺失 2 条
  const ul2024 = html.match(/id="accordion-2024-[^"]*"[\s\S]*?<ul class="c-liste-document__list">/);
  if (!ul2024) throw new Error('未找到本地 2024 组 ul');
  const insertLi = MARK_S + rewriteFiles(liIndia + '\n' + liColor) + MARK_E;
  html = html.replace(ul2024[0], ul2024[0] + '\n' + insertLi);

  // 3) 最前部插入 2026 / 2025 年组（包裹 field__item，与本地结构一致）
  const wrap = (item: string) =>
    `<div class="field__item">${MARK_S}\n<!-- debut acc item -->\n${rewriteFiles(item)}\n<!-- fin acc item -->${MARK_E}</div>`;
  const anchor = 'field--label-hidden field__items">';
  const idx = html.indexOf(anchor);
  if (idx === -1) throw new Error('未找到 accordion field__items 锚点');
  const insertAt = idx + anchor.length;
  html = html.slice(0, insertAt) + '\n' + wrap(acc2026) + '\n' + wrap(acc2025) + html.slice(insertAt);

  // 4) 底部相关卡图：本地无 about-us.jpg.webp，重写为已有 .jpg.jpg 变体
  html = html.split('2023-06/about-us.jpg.webp').join('2023-06/about-us.jpg.jpg');

  // 5) 官方图片区：删除多余的 rd2 竖图条目（英文站为 12 张无此图，竖图会撑乱 4 列网格）
  const rd2Idx = html.indexOf('gattefosse_rd2_chloelapeyssonnie');
  if (rd2Idx !== -1) {
    const fs2 = html.lastIndexOf('<div class="field__item">', rd2Idx);
    const fe2 = html.indexOf('</article>', rd2Idx) + '</article>'.length;
    html = html.slice(0, fs2) + html.slice(fe2);
  }

  // 6) 官方图片区：rd1 条目后多一个 </div> 提前闭合 gallery 容器，导致 garden1 被挤出 4 列网格
  const badClose = '</article>\n</div>\n\n</div>\n<div class="field__item">\n<article';
  const goodClose = '</article>\n</div>\n<div class="field__item">\n<article';
  html = html.split(badClose).join(goodClose);

  await prisma.pageContent.update({ where: { id: 97 }, data: { contentHtml: html } });

  // 自检
  const years = [...html.matchAll(/id="nav-(\d{4})"/g)].map(m => m[1]);
  const docCount = (html.match(/c-link--document/g) || []).length;
  console.log('OK years:', years.join(','));
  console.log('OK c-link--document:', docCount);
  console.log('OK len:', html.length);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
