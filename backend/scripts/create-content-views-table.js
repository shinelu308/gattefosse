/**
 * 建 content_views 表（内容浏览事件 / 2026-09-12）
 * ============================================================================
 * 背景：`page_views` 只记「去 query 的页面路径」，产品详情页 57 个产品全压成一条，
 * 资料（PDF）走静态直链更是完全收不到 —— 营销上无法回答"哪个产品/哪份资料被看得多"。
 * 因此新增独立的 content_views 表承载「业务对象口径」，与 page_views 的「流量口径」并存。
 *
 * ⚠️ 本表**不能**靠 prisma migrate 建（项目铁律：禁 `prisma migrate dev`，
 *    改库一律手写 SQL）。建表脚本必须与 prisma/schema.prisma 的 ContentView 模型
 *    保持一致，改动 schema 时同步改这里。
 *
 * ⚠️ 索引/表建在**数据文件**里，不随 deploy 走 —— 部署后必须 SSH 到线上再跑一次
 *    `node scripts/create-content-views-table.js --apply`。
 *
 * 用法：
 *   node scripts/create-content-views-table.js            # 预演（只报告，不建）
 *   node scripts/create-content-views-table.js --apply    # 实际执行（幂等，可重复跑）
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

// 表结构：字段顺序与命名必须与 schema.prisma 的 ContentView 对齐（物理列名用 snake_case）
const DDL = [
  `CREATE TABLE IF NOT EXISTS content_views (
     id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
     object_type TEXT    NOT NULL,
     object_id   TEXT    NOT NULL,
     object_name TEXT,
     section     TEXT,
     event_type  TEXT    NOT NULL DEFAULT 'view',
     page_path   TEXT,
     parent_id   TEXT,
     parent_name TEXT,
     visitor_id  TEXT    NOT NULL,
     ip          TEXT,
     ua          TEXT,
     referer     TEXT,
     region      TEXT,
     created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  // 榜单主查询：按对象类型分组 + 按对象聚合
  `CREATE INDEX IF NOT EXISTS idx_cv_type_object ON content_views(object_type, object_id)`,
  // 热度时间窗 + 区分浏览/下载
  `CREATE INDEX IF NOT EXISTS idx_cv_event_time  ON content_views(event_type, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_cv_created_at  ON content_views(created_at)`,
  // UV 去重统计
  `CREATE INDEX IF NOT EXISTS idx_cv_visitor     ON content_views(visitor_id)`,
  // 按板块筛选
  `CREATE INDEX IF NOT EXISTS idx_cv_section     ON content_views(section)`,
];

(async () => {
  // ① 先看一眼参照表 page_views 的真实 DDL，确认 DATETIME 风格与 prisma 一致
  const ref = await prisma.$queryRawUnsafe(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='page_views'`
  );
  if (ref && ref.length) {
    console.log('=== 参照 page_views 的 DDL（确认风格一致）===');
    console.log(String(ref[0].sql).replace(/\s+/g, ' ').trim());
    console.log('');
  }

  // ② 现状
  const before = await prisma.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='content_views'`
  );
  const existed = before && before.length > 0;
  console.log(`content_views 表${existed ? '**已存在**' : '不存在'}`);

  if (existed) {
    const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info(content_views)`);
    console.log('现有列：' + cols.map((c) => c.name).join(', '));
    const idx = await prisma.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='content_views'`
    );
    console.log('现有索引：' + (idx.map((i) => i.name).join(', ') || '(无)'));
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

  const after = await prisma.$queryRawUnsafe(`PRAGMA table_info(content_views)`);
  const idxAfter = await prisma.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='content_views' ORDER BY name`
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
