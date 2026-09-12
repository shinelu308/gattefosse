/**
 * 建 manual_sections 表（后台「使用手册」/ 2026-09-12）
 * ============================================================================
 * 背景：操作人员需要在后台直接查使用手册，且系统界面改版后手册的文字与截图
 * 要能自己更新，不用等发版。因此把手册按「章节」入库，后台提供浏览 + 编辑。
 *
 * ⚠️ 本项目铁律：禁 `prisma migrate dev`，改库一律手写 SQL。
 *    本脚本必须与 prisma/schema.prisma 的 ManualSection 模型保持一致，
 *    改 schema 时同步改这里。
 *
 * ⚠️ 表建在**数据文件**里，不随 deploy 走 —— 部署后必须 SSH 到线上再跑一次
 *    `node scripts/create-manual-sections-table.js --apply`，否则接口报 P2021/P2022。
 *
 * 用法：
 *   node scripts/create-manual-sections-table.js            # 预演（只报告，不建）
 *   node scripts/create-manual-sections-table.js --apply    # 实际执行（幂等，可重复跑）
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const TABLE = 'manual_sections';

// 字段顺序与命名必须与 schema.prisma 的 ManualSection 对齐（物理列名 snake_case）
const DDL = [
  `CREATE TABLE IF NOT EXISTS manual_sections (
     id           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
     section_key  TEXT    NOT NULL,
     chapter_no   TEXT    NOT NULL,
     chapter      TEXT    NOT NULL,
     title        TEXT    NOT NULL,
     body_html    TEXT,
     sort_order   INTEGER NOT NULL DEFAULT 0,
     is_published INTEGER NOT NULL DEFAULT 1,
     updated_by   TEXT,
     created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  // 章节号唯一：section_key 是幂等导入与后台定位的锚点
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ms_section_key ON manual_sections(section_key)`,
  // 目录按 sort_order 排
  `CREATE INDEX IF NOT EXISTS idx_ms_sort ON manual_sections(sort_order)`,
];

(async () => {
  // ① 参照一张已有表确认 DATETIME / 默认值风格一致
  const ref = await prisma.$queryRawUnsafe(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='page_contents'`
  );
  if (ref && ref.length) {
    console.log('=== 参照 page_contents 的 DDL（确认风格一致）===');
    console.log(String(ref[0].sql).replace(/\s+/g, ' ').trim().slice(0, 300));
    console.log('');
  }

  // ② 现状
  const before = await prisma.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${TABLE}'`
  );
  const existed = before && before.length > 0;
  console.log(`${TABLE} 表${existed ? '**已存在**' : '不存在'}`);

  if (existed) {
    const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info(${TABLE})`);
    console.log('现有列：' + cols.map((c) => c.name).join(', '));
    const idx = await prisma.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='${TABLE}'`
    );
    console.log('现有索引：' + (idx.map((i) => i.name).join(', ') || '(无)'));
    const cnt = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS c FROM ${TABLE}`);
    console.log('现有行数：' + Number(cnt[0].c));
    console.log('');
  }

  if (!APPLY) {
    console.log('=== 将执行（预演，未落库）===');
    DDL.forEach((s) => console.log('  · ' + s.replace(/\s+/g, ' ').trim()));
    console.log('');
    console.log('加 --apply 实际执行。');
    return;
  }

  console.log('=== 执行 ===');
  for (const sql of DDL) {
    await prisma.$executeRawUnsafe(sql);
    console.log('  ✓ ' + sql.replace(/\s+/g, ' ').trim().slice(0, 96) + '…');
  }

  const after = await prisma.$queryRawUnsafe(`PRAGMA table_info(${TABLE})`);
  const idxAfter = await prisma.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='${TABLE}' ORDER BY name`
  );
  console.log('');
  console.log('=== 结果 ===');
  console.log('列：' + after.map((c) => c.name).join(', '));
  console.log('索引：' + idxAfter.map((i) => i.name).join(', '));
  console.log(existed ? '（幂等重复执行，结构未变）' : '（新建完成）');
})()
  .catch((e) => {
    console.error('❌ 失败：', e && e.message ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
