/**
 * 把离线使用手册（docs/manual/使用手册.html）导入数据库 manual_sections
 * ============================================================================
 * 用途：手册「内置到后台」的一次性数据迁移。之后手册的维护都在后台完成。
 *
 * 做什么：
 *   ① 把 docs/manual/assets/raw 下的截图复制到 backend/uploads/manual
 *      （正文里 assets/raw/x.png → /uploads/manual/x.png）
 *   ② 按 <h2>/<h3> 切分成章节，写进 manual_sections
 *      · <h2 id="c5">   → 章（chapter_no / chapter）
 *      · <h3 id="c5-1"> → 节（section_key = 5.1）
 *      · 章导语本身有内容时，另存一节 section_key = 章号，标题「概览」
 *      · 标题里的编号（含 <span class="no">）剥掉，编号由 section_key 承载
 *
 * ⚠️ 幂等策略：**已存在的 section_key 默认跳过**，不覆盖你在后台改过的内容。
 *    需要强制用离线版覆盖，加 --force。
 *
 * 用法：
 *   node scripts/import-manual-sections.js            # 预演：打印将要写入的章节
 *   node scripts/import-manual-sections.js --apply    # 实际写入
 *   node scripts/import-manual-sections.js --apply --force   # 覆盖已有章节
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

const ROOT = path.resolve(__dirname, '../..');
const SRC_HTML = path.join(ROOT, 'docs/manual/使用手册.html');
const SRC_RAW = path.join(ROOT, 'docs/manual/assets/raw');
const DEST_DIR = path.join(__dirname, '../uploads/manual');

/** <h2> 的标题：剥掉 <span class="no"> 里的章号，剩下就是章名（章名本身可能以数字开头，如「3 分钟快速上手」，不再剥） */
function chapterName(raw) {
  return raw
    .replace(/<span class="no">[\s\S]*?<\/span>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** <h3> 的标题：剥掉行首编号 —— `5.1 个人护理 · 成分` → `个人护理 · 成分` */
function sectionTitle(raw) {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*\d+(\.\d+)*\s*[·.、]?\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

(async () => {
  if (!fs.existsSync(SRC_HTML)) throw new Error('找不到 ' + SRC_HTML);
  const html = fs.readFileSync(SRC_HTML, 'utf8');

  // ---------- ① 复制截图 ----------
  const pngs = fs.existsSync(SRC_RAW)
    ? fs.readdirSync(SRC_RAW).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
    : [];
  console.log(`=== ① 截图：${pngs.length} 张 → ${path.relative(ROOT, DEST_DIR)} ===`);
  if (APPLY && pngs.length) {
    if (!fs.existsSync(DEST_DIR)) fs.mkdirSync(DEST_DIR, { recursive: true });
    let copied = 0, skipped = 0;
    for (const f of pngs) {
      const dest = path.join(DEST_DIR, f);
      const src = path.join(SRC_RAW, f);
      if (fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size) { skipped++; continue; }
      fs.copyFileSync(src, dest);
      copied++;
    }
    console.log(`   复制 ${copied} 张，已存在跳过 ${skipped} 张`);
  } else if (!APPLY) {
    console.log('   （预演，未复制）');
  }

  // ---------- ② 切分章节 ----------
  const start = html.indexOf('<h2');
  const end = html.indexOf('</main>');
  if (start < 0 || end < 0) throw new Error('手册 HTML 结构不符合预期（找不到 <h2> 或 </main>）');
  const body = html.slice(start, end);

  const heads = [...body.matchAll(/<h([23])[^>]*id="(c[\d-]+)"[^>]*>([\s\S]*?)<\/h\1>/g)];

  // 先统计每章有几个 <h3>：决定章导语那节叫「概览」还是直接用章名
  const childCount = {};
  for (const h of heads) {
    if (h[1] !== '3') continue;
    const no = h[2].replace(/^c/, '').replace(/-/g, '.').split('.')[0];
    childCount[no] = (childCount[no] || 0) + 1;
  }

  const sections = [];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const level = h[1];
    const id = h[2];                                  // c5 / c5-1
    const segEnd = i + 1 < heads.length ? heads[i + 1].index : body.length;
    const seg = body.slice(h.index + h[0].length, segEnd).trim();

    const key = id.replace(/^c/, '').replace(/-/g, '.'); // c5-1 → 5.1
    const chapterNo = key.split('.')[0];

    if (level === '2') {
      const name = chapterName(h[3]);
      const textLen = seg.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;
      const hasFig = /<figure/i.test(seg);
      if (textLen > 0 || hasFig) {
        // 章导语本身是一节：有子节的章叫「概览」，独节章直接用章名
        const title = childCount[chapterNo] ? '概览' : name;
        sections.push({ key, chapterNo, chapter: name, title, body: seg });
      } else {
        // 空导语：只用来记住章名，供后面的 h3 用
        sections.push({ key: '__chapter__' + chapterNo, chapterNo, chapter: name, title: null, body: '' });
      }
    } else {
      const parent = sections.filter((s) => s.chapterNo === chapterNo).pop();
      const chapter = parent ? parent.chapter : chapterNo;
      sections.push({ key, chapterNo, chapter, title: sectionTitle(h[3]), body: seg });
    }
  }

  // 丢掉只承载章名的占位、补齐 h3 的章名
  const chapterNameOf = {};
  for (const s of sections) if (s.key.startsWith('__chapter__')) chapterNameOf[s.chapterNo] = s.chapter;
  const finalList = sections
    .filter((s) => !s.key.startsWith('__chapter__'))
    .map((s) => ({ ...s, chapter: s.chapter || chapterNameOf[s.chapterNo] || s.chapterNo }));

  // 图片路径本地 → 线上
  const fixImg = (h) => h.replace(/(src|href)="assets\/raw\//g, '$1="/uploads/manual/').replace(/(src|href)="\.\/assets\/raw\//g, '$1="/uploads/manual/');
  finalList.forEach((s) => { s.body = fixImg(s.body); });

  console.log('');
  console.log(`=== ② 章节：共 ${finalList.length} 节 ===`);
  for (const s of finalList) {
    const textLen = s.body.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;
    const figs = (s.body.match(/<figure/gi) || []).length;
    console.log(`   ${s.key.padEnd(5)} [${s.chapterNo}] ${s.chapter} / ${s.title}　${textLen} 字 · ${figs} 图`);
  }

  if (!APPLY) {
    console.log('');
    console.log('预演结束，未写库。加 --apply 实际写入（已存在的 section_key 会跳过）。');
    return;
  }

  // ---------- ③ 写库 ----------
  console.log('');
  console.log('=== ③ 写入 manual_sections ===');
  let created = 0, updated = 0, skipped = 0;
  const chaptersTouched = [...new Set(finalList.map((s) => s.chapterNo))];
  const existingRows = await prisma.manualSection.findMany();
  // 章节顺序：按已有的最大 sortOrder 往后排；同一章内按出现顺序
  let order = 10;
  for (let i = 0; i < finalList.length; i++) {
    const s = finalList[i];
    const exist = existingRows.find((r) => r.sectionKey === s.key);
    const data = {
      chapterNo: s.chapterNo,
      chapter: s.chapter,
      title: s.title,
      bodyHtml: s.body,
      sortOrder: (i + 1) * 10,
      updatedBy: 'import-manual-sections',
      updatedAt: new Date(),
    };
    if (exist && !FORCE) { skipped++; order = (i + 1) * 10; continue; }
    if (exist) {
      await prisma.manualSection.update({ where: { id: exist.id }, data });
      updated++;
    } else {
      await prisma.manualSection.create({ data: { sectionKey: s.key, ...data } });
      created++;
    }
  }
  console.log(`   新建 ${created} 节，覆盖 ${updated} 节，跳过（已存在）${skipped} 节`);
  console.log(`   涉及章：${chaptersTouched.join(', ')}`);
  const total = await prisma.manualSection.count();
  console.log(`   表内共 ${total} 节`);
  if (skipped && !FORCE) {
    console.log('   ⚠️ 被跳过的章节保留了后台已编辑的版本；要改用离线版覆盖请加 --force');
  }
})()
  .catch((e) => {
    console.error('❌ 失败：', e && e.message ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
