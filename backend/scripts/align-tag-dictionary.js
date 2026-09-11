/**
 * 标签字典 ↔ 产品数据 对齐 & 脏数据清洗（2026-09-12）
 *
 * 背景（详见 docs/标签体系校验报告-260912.md）：
 *   - 15 个「产品线/分类」维度里 9 个不对齐：数据有·字典缺 117 条，字典有·数据零用 116 条
 *   - 根因：pc 字典曾由 scripts/sync-tag-dictionary.ts 从原中文站标签树 API 全量重灌（权威、已核对）；
 *     配方与药用辅料的字典仍是早期人工种的老词表（来自英文站分类），与中文站导入的数据是「同一批
 *     英文词的两个中文译法」——字典「软膏」vs 数据「软膏剂」、字典「Emulium Kappa MB」vs 数据
 *     「Emulium® Kappa MB」。
 *
 * 对齐方向（本脚本的判定规则）：
 *   - pc 全部分类：**字典为权威**（2026-09-12 实测原站标签树，逐项吻合）→ 产品数据里不在字典的
 *     值视为导入错位，移出该字段（原文完整备份，可 --restore）
 *   - formulation / pharma：**数据为权威**（原站中文站没有这两条线的标签树，字典无从参照）
 *     → 字典补齐 + 归一化改名 + 清理零命中条目
 *
 * 用法：
 *   node scripts/align-tag-dictionary.js              # 预演，只打印不写库
 *   node scripts/align-tag-dictionary.js --apply      # 实际执行（先自动落盘备份）
 *   node scripts/align-tag-dictionary.js --restore scripts/tag-dict-backup-XXXX.json
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const RESTORE_IDX = process.argv.indexOf('--restore');
const BACKUP_DIR = path.resolve(__dirname);

/* ============================ 维度映射 ============================ */
const DIMS = [
  { table: 'pc_ingredients', model: 'pcIngredient', pl: 'pc', cat: 'functionality', col: 'functionality_tag', field: 'functionalityTag' },
  { table: 'pc_ingredients', model: 'pcIngredient', pl: 'pc', cat: 'application', col: 'application_tag', field: 'applicationTag' },
  { table: 'pc_ingredients', model: 'pcIngredient', pl: 'pc', cat: 'concept', col: 'concept_tag', field: 'conceptTag' },
  { table: 'pc_ingredients', model: 'pcIngredient', pl: 'pc', cat: 'claim', col: 'claim_tag', field: 'claimTag' },
  { table: 'pc_ingredients', model: 'pcIngredient', pl: 'pc', cat: 'characteristic', col: 'characteristic_tag', field: 'characteristicTag' },
  { table: 'pc_ingredients', model: 'pcIngredient', pl: 'pc', cat: 'naturality', col: 'naturality_label', field: 'naturalityLabel' },
  { table: 'formulations', model: 'formulation', pl: 'formulation', cat: 'application', col: 'application_tag', field: 'applicationTag' },
  { table: 'formulations', model: 'formulation', pl: 'formulation', cat: 'form', col: 'form_tag', field: 'formTag' },
  { table: 'formulations', model: 'formulation', pl: 'formulation', cat: 'claim', col: 'claim_tag', field: 'claimTag' },
  { table: 'formulations', model: 'formulation', pl: 'formulation', cat: 'ingredient', col: 'concept_tag', field: 'conceptTag' },
  { table: 'formulations', model: 'formulation', pl: 'formulation', cat: 'naturalityIndex', col: 'naturality_index', field: 'naturalityIndex' },
  { table: 'pharma_products', model: 'pharmaProduct', pl: 'pharma', cat: 'market', col: 'market_tag', field: 'marketTag' },
  { table: 'pharma_products', model: 'pharmaProduct', pl: 'pharma', cat: 'route', col: 'route_tag', field: 'routeTag' },
  { table: 'pharma_products', model: 'pharmaProduct', pl: 'pharma', cat: 'functionality', col: 'functionality_tag', field: 'functionalityTag' },
  { table: 'pharma_products', model: 'pharmaProduct', pl: 'pharma', cat: 'dosage_form', col: 'dosage_form_tag', field: 'dosageFormTag' },
];

/** article_theme 是文章标签（label=英文原词 / value=中文译文，成对存在），不参与产品对齐 */
const SKIP_PRODUCT_LINES = new Set(['article_theme']);

/**
 * 明确不属于筛选面、由「产品页文案」被误抓进来的碎片（按「表.列」限定）。
 * 判据：单字碎片（含有 / AHA）、身体部位名词（眼部 / 面部 / 身体，本属「应用领域」维度）、
 * 整句文案（焕然一新的肌肤）、错别字（失误质地）。
 */
const JUNK_BY_COL = {
  'formulations.claim_tag': ['含有', 'AHA', '眼部', '面部', '身体', '焕然一新的肌肤', '失误质地'],
};

/** --keep-dead：保留对齐后零命中的字典条目（默认删除，与原站 facet「只显示有内容的值」一致） */
const KEEP_DEAD = process.argv.includes('--keep-dead');

/* ============================ 工具 ============================ */
const splitTags = (s) => String(s == null ? '' : s).split(',').map((x) => x.trim()).filter(Boolean);

/** HTML 实体最小解码（导入残留 &mdash; / &nbsp;） */
function decodeEntities(s) {
  return String(s)
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

const hasMeaning = (t) => /[A-Za-z0-9\u4e00-\u9fa5]/.test(t);

/** 归一化：去 ®™©、去空白与常见分隔符、小写 —— 用于「Emulium Kappa MB ↔ Emulium® Kappa MB」这类匹配 */
const norm = (s) =>
  decodeEntities(String(s))
    .replace(/[®™©]/g, '')
    .replace(/[\s\u3000、，,（）()\[\]【】·\/\\\-—–_]/g, '')
    .toLowerCase();

/**
 * 把一个字典值匹配到数据里实际使用的值。
 * 顺序：精确 → 归一化相等 → 前缀唯一。
 *
 * ⚠️ 刻意不做「包含匹配」：曾试出 `溶剂 → 增溶剂` 这种语义错误（溶剂≠增溶剂）。
 *    包含类候选一律走「删旧条目 + 新增正确条目」，净内容等价但不猜语义。
 * 例：凝胶→凝胶剂(前缀)、硬脂→硬脂（栓剂基质）(前缀)、Emulium Kappa MB→Emulium® Kappa MB(归一化)
 */
function matchToData(dictVal, dataVals) {
  if (dataVals.includes(dictVal)) return { hit: dictVal, how: 'exact' };
  const n = norm(dictVal);
  const byNorm = dataVals.filter((d) => norm(d) === n);
  if (byNorm.length === 1) return { hit: byNorm[0], how: 'normalized' };
  const byPrefix = dataVals.filter((d) => d.startsWith(dictVal) && d !== dictVal);
  if (byPrefix.length === 1) return { hit: byPrefix[0], how: 'prefix' };
  return null;
}

/* ============================ 备份 / 还原 ============================ */
async function snapshot() {
  const dict = await prisma.$queryRawUnsafe(
    'SELECT id, product_line, category, label, value, sort_order FROM tag_dictionary ORDER BY id'
  );
  const products = {};
  for (const d of DIMS) {
    const rows = await prisma.$queryRawUnsafe(`SELECT id, "${d.col}" AS v FROM ${d.table}`);
    products[`${d.table}.${d.col}`] = rows.map((r) => ({ id: r.id, v: r.v }));
  }
  return { takenAt: new Date().toISOString(), dict, products };
}

async function restore(file) {
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('从备份还原：' + file + '（' + snap.takenAt + '）');
  await prisma.tagDictionary.deleteMany({});
  for (const d of snap.dict) {
    await prisma.tagDictionary.create({
      data: { id: d.id, productLine: d.product_line, category: d.category, label: d.label, value: d.value, sortOrder: d.sort_order },
    });
  }
  for (const key of Object.keys(snap.products)) {
    const [table, col] = key.split('.');
    const model = DIMS.find((x) => x.table === table && x.col === col).model;
    const field = DIMS.find((x) => x.table === table && x.col === col).field;
    for (const r of snap.products[key]) {
      await prisma[model].update({ where: { id: r.id }, data: { [field]: r.v } });
    }
  }
  console.log('✅ 已还原：字典 ' + snap.dict.length + ' 条，产品字段 ' + Object.keys(snap.products).length + ' 个维度');
}

/* ============================ 主流程 ============================ */
async function main() {
  if (RESTORE_IDX > -1) return restore(process.argv[RESTORE_IDX + 1]);

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  console.log(APPLY ? '⚙️  执行模式（会写库，先自动备份）' : '🔍 预演模式（只打印，不写库）');

  const dictRows = await prisma.$queryRawUnsafe(
    'SELECT id, product_line, category, label, value, sort_order FROM tag_dictionary ORDER BY product_line, category, sort_order, id'
  );
  const dictByKey = new Map();
  for (const d of dictRows) {
    const k = `${d.product_line}||${d.category}`;
    if (!dictByKey.has(k)) dictByKey.set(k, []);
    dictByKey.get(k).push(d);
  }

  /* ---------- 第 1 步：读产品数据 + 清洗脏值 ---------- */
  const dataOfDim = new Map();
  const dataCleanPlan = []; // 产品字段清洗计划
  for (const d of DIMS) {
    const rows = await prisma.$queryRawUnsafe(`SELECT id, "${d.col}" AS v FROM ${d.table}`);
    const entries = [];
    for (const r of rows) {
      const raw = r.v == null ? '' : String(r.v);
      const tokens = splitTags(raw).map((t) => decodeEntities(t).replace(/\s+/g, ' ').trim());
      const junk = JUNK_BY_COL[`${d.table}.${d.col}`] || [];
      const kept = [];
      const dropped = [];
      for (const t of tokens) {
        if (!t || !hasMeaning(t)) { dropped.push(t || '(空)'); continue; }  // 纯符号（如 "+"）
        if (junk.includes(t)) { dropped.push(t + '(非筛选面)'); continue; } // 页面文案碎片
        if (kept.includes(t)) { dropped.push(t + '(重复)'); continue; }     // 字段内重复
        kept.push(t);
      }
      const next = kept.join(',');
      if (next !== raw.trim()) dataCleanPlan.push({ dim: d, id: r.id, before: raw, after: next, dropped });
      entries.push({ id: r.id, raw, cleaned: kept });
    }
    dataOfDim.set(d, entries);
  }

  /* ---------- 第 2 步：pc 线以字典为权威，移出不在原站筛选面的值 ---------- */
  const pcAuthorityPlan = [];
  for (const d of DIMS) {
    if (d.pl !== 'pc') continue;
    const allow = new Set((dictByKey.get(`${d.pl}||${d.cat}`) || []).map((x) => x.value));
    for (const e of dataOfDim.get(d)) {
      const out = e.cleaned.filter((t) => !allow.has(t));
      if (out.length) {
        pcAuthorityPlan.push({ dim: d, id: e.id, removed: out });
        e.cleaned = e.cleaned.filter((t) => allow.has(t));
      }
    }
  }

  /* ---------- 第 3 步：字典对齐（改名 / 新增 / 删除） ---------- */
  const plan = { rename: [], add: [], del: [], skipDims: [] };
  for (const [key, rows] of dictByKey) {
    const [pl, cat] = key.split('||');
    const dim = DIMS.find((x) => x.pl === pl && x.cat === cat);
    if (!dim) { plan.skipDims.push(`${pl}/${cat}（无产品字段承载，跳过）`); continue; }
    const dataVals = [...new Set(dataOfDim.get(dim).flatMap((e) => e.cleaned))];
    const taken = new Set();
    for (const row of rows) {
      const m = matchToData(row.value, dataVals);
      if (!m) { plan.del.push({ dim, row }); continue; }
      if (taken.has(m.hit)) { plan.del.push({ dim, row, dupeOf: m.hit }); continue; }
      taken.add(m.hit);
      if (row.value !== m.hit || row.label !== m.hit) {
        plan.rename.push({ dim, row, to: m.hit, how: m.how });
      }
    }
    // 数据用到的值，字典里没有 → 补
    const dictNow = new Set(rows.map((r) => r.value));
    for (const v of dataVals) {
      if (!dictNow.has(v) && !taken.has(v)) { plan.add.push({ dim, value: v }); taken.add(v); }
    }
  }

  /* ---------- 输出计划 ---------- */
  console.log('\n=== ① 产品字段脏值清洗（HTML实体解码 / 去纯符号 / 去重）===');
  if (!dataCleanPlan.length) console.log('  无');
  for (const p of dataCleanPlan) {
    console.log(`  ${p.dim.table}#${p.id} ${p.dim.col}`);
    console.log(`      前: ${JSON.stringify(p.before)}`);
    console.log(`      后: ${JSON.stringify(p.after)}   丢弃: ${JSON.stringify(p.dropped)}`);
  }

  console.log('\n=== ② pc 线：移出不在原站筛选面的值（字典为权威）===');
  if (!pcAuthorityPlan.length) console.log('  无');
  for (const p of pcAuthorityPlan) {
    console.log(`  ${p.dim.table}#${p.id} ${p.dim.col}  移出 ${p.removed.length} 项: ${p.removed.join(' | ')}`);
  }

  console.log('\n=== ③ 字典改名（对齐到数据实际使用的写法）===');
  for (const pl of ['pc', 'formulation', 'pharma']) {
    const list = plan.rename.filter((r) => r.dim.pl === pl);
    if (!list.length) continue;
    console.log(`\n  ▸ ${pl}（${list.length} 条）`);
    for (const r of list) console.log(`      #${r.row.id} [${r.dim.cat}] ${JSON.stringify(r.row.value)} → ${JSON.stringify(r.to)}   (${r.how})`);
  }

  console.log('\n=== ④ 字典新增（数据在用、字典缺失）===');
  for (const pl of ['pc', 'formulation', 'pharma']) {
    const list = plan.add.filter((r) => r.dim.pl === pl);
    if (!list.length) continue;
    console.log(`\n  ▸ ${pl}（${list.length} 条）`);
    const byCat = {};
    for (const a of list) (byCat[a.dim.cat] = byCat[a.dim.cat] || []).push(a.value);
    for (const c of Object.keys(byCat)) console.log(`      [${c}] ${byCat[c].join(' | ')}`);
  }

  console.log(`\n=== ⑤ 字典零命中条目（${KEEP_DEAD ? '--keep-dead：本次保留' : '将删除'}）===`);
  for (const pl of ['pc', 'formulation', 'pharma']) {
    const list = plan.del.filter((r) => r.dim.pl === pl);
    if (!list.length) continue;
    console.log(`\n  ▸ ${pl}（${list.length} 条）`);
    const byCat = {};
    for (const a of list) (byCat[a.dim.cat] = byCat[a.dim.cat] || []).push(a.row.value + (a.dupeOf ? '⇢' + a.dupeOf : ''));
    for (const c of Object.keys(byCat)) console.log(`      [${c}] ${byCat[c].join(' | ')}`);
  }

  if (plan.skipDims.length) {
    console.log('\n=== ⑥ 跳过（无产品字段承载）===');
    for (const s of plan.skipDims) console.log('  ' + s);
  }

  const total = dataCleanPlan.length + pcAuthorityPlan.length + plan.rename.length + plan.add.length + plan.del.length;
  console.log(`\n合计变更 ${total} 项：清洗 ${dataCleanPlan.length} · 移出 ${pcAuthorityPlan.length} · 改名 ${plan.rename.length} · 新增 ${plan.add.length} · 删除 ${plan.del.length}`);

  if (!APPLY) {
    console.log('\n（预演结束，未写库。确认无误后加 --apply 执行）');
    await prisma.$disconnect();
    return;
  }

  /* ---------- 备份 ---------- */
  const snapPath = path.join(BACKUP_DIR, `tag-dict-backup-${stamp}.json`);
  fs.writeFileSync(snapPath, JSON.stringify(await snapshot(), null, 1), 'utf8');
  console.log('\n💾 备份已写入 ' + snapPath);

  const planPath = path.join(BACKUP_DIR, `tag-dict-plan-${stamp}.json`);
  fs.writeFileSync(
    planPath,
    JSON.stringify(
      {
        clean: dataCleanPlan.map((p) => ({ table: p.dim.table, id: p.id, col: p.dim.col, before: p.before, after: p.after, dropped: p.dropped })),
        pcRemoved: pcAuthorityPlan.map((p) => ({ table: p.dim.table, id: p.id, col: p.dim.col, removed: p.removed })),
        rename: plan.rename.map((r) => ({ id: r.row.id, dim: `${r.dim.pl}/${r.dim.cat}`, from: r.row.value, to: r.to, how: r.how })),
        add: plan.add.map((a) => ({ dim: `${a.dim.pl}/${a.dim.cat}`, value: a.value })),
        del: plan.del.map((d) => ({ id: d.row.id, dim: `${d.dim.pl}/${d.dim.cat}`, value: d.row.value, label: d.row.label })),
      },
      null,
      1
    ),
    'utf8'
  );
  console.log('📋 变更清单已写入 ' + planPath);

  /* ---------- 执行 ---------- */
  let nClean = 0;
  for (const p of dataCleanPlan) {
    await prisma[p.dim.model].update({ where: { id: p.id }, data: { [p.dim.field]: p.after } });
    nClean++;
  }
  let nPc = 0;
  for (const p of pcAuthorityPlan) {
    const e = dataOfDim.get(p.dim).find((x) => x.id === p.id);
    await prisma[p.dim.model].update({ where: { id: p.id }, data: { [p.dim.field]: e.cleaned.join(',') } });
    nPc++;
  }
  let nRename = 0;
  for (const r of plan.rename) {
    await prisma.tagDictionary.update({ where: { id: r.row.id }, data: { label: r.to, value: r.to } });
    nRename++;
  }
  let nAdd = 0;
  for (const a of plan.add) {
    const maxRow = await prisma.tagDictionary.aggregate({ where: { productLine: a.dim.pl, category: a.dim.cat }, _max: { sortOrder: true } });
    await prisma.tagDictionary.create({
      data: { productLine: a.dim.pl, category: a.dim.cat, label: a.value, value: a.value, sortOrder: (maxRow._max.sortOrder || 0) + 1 },
    });
    nAdd++;
  }
  let nDel = 0;
  if (KEEP_DEAD) {
    console.log('ℹ️  --keep-dead：保留 ' + plan.del.length + ' 条零命中条目，本次未删除');
  } else {
    for (const d of plan.del) {
      await prisma.tagDictionary.delete({ where: { id: d.row.id } });
      nDel++;
    }
  }
  console.log(`✅ 执行完成：清洗 ${nClean} · 移出 ${nPc} · 改名 ${nRename} · 新增 ${nAdd} · 删除 ${nDel}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('💥 失败：', e);
  await prisma.$disconnect();
  process.exit(1);
});
