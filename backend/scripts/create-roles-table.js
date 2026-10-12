/**
 * 建 roles 表（后台「角色管理」/ 2026-10-13）
 * ============================================================================
 * 背景：原系统角色只有 super_admin / editor 两档且无处管理（员工表角色列只读、
 * 下拉只有一个「编辑员」）。本次新增 roles 表作为角色字典 + 权限矩阵存储，
 * 配套 roles-standalone.html 管理页与 /api/admin/roles 接口。
 *
 * ⚠️ 本项目铁律：禁 `prisma migrate dev`，改库一律手写 SQL。
 *    本脚本必须与 prisma/schema.prisma 的 Role 模型保持一致，
 *    改 schema 时同步改这里。
 *
 * ⚠️ 表建在**数据文件**里，不随 deploy 走 —— 部署后必须 SSH 到线上再跑一次
 *    `node scripts/create-roles-table.js --apply`，否则接口报 P2021/P2022。
 *
 * 用法：
 *   node scripts/create-roles-table.js            # 预演（只报告，不建）
 *   node scripts/create-roles-table.js --apply    # 实际执行（幂等，可重复跑）
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const TABLE = 'roles';

// 字段顺序与命名必须与 schema.prisma 的 Role 对齐（物理列名 snake_case）
const DDL = [
  `CREATE TABLE IF NOT EXISTS roles (
     id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
     key         TEXT    NOT NULL,
     name        TEXT    NOT NULL,
     description TEXT,
     permissions TEXT    NOT NULL DEFAULT '{}',
     sort        INTEGER NOT NULL DEFAULT 0,
     builtin     INTEGER NOT NULL DEFAULT 0,
     created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_key ON roles(key)`,
];

// 与后台模块清单一致（settings-standalone MODULES + 新增 roles 模块）
const MODULES = ['pc','pharma','formula','news','learnmore','docs','content','authors','orders','users','careers','tags','settings','roles'];
const allPerms = (view) => {
  const o = {};
  MODULES.forEach(m => { o[m] = { view: view ? 1 : 0, create: view ? 1 : 0, edit: view ? 1 : 0, delete: view ? 1 : 0 }; });
  return JSON.stringify(o);
};

// 内置角色种子（key 幂等；已存在则跳过，不覆盖用户改过的 permissions）
const SEED = [
  { key: 'super_admin', name: '超级管理员', description: '系统内置角色，拥有全部模块的全部权限', sort: 10, builtin: 1, permissions: allPerms(true) },
  { key: 'editor',      name: '编辑员',     description: '默认员工角色，可访问全部业务模块（不含角色管理）', sort: 20, builtin: 1, permissions: (() => { const p = JSON.parse(allPerms(true)); p.roles = { view: 0, create: 0, edit: 0, delete: 0 }; return JSON.stringify(p); })() },
];

(async () => {
  // ① 现状
  const before = await prisma.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${TABLE}'`
  );
  const existed = before && before.length > 0;
  console.log(`${TABLE} 表${existed ? '**已存在**' : '不存在'}`);

  if (existed) {
    const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info(${TABLE})`);
    console.log('现有列：' + cols.map((c) => c.name).join(', '));
    const cnt = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS c FROM ${TABLE}`);
    console.log('现有行数：' + Number(cnt[0].c));
    console.log('');
  }

  if (!APPLY) {
    console.log('=== 将执行（预演，未落库）===');
    DDL.forEach((s) => console.log('  · ' + s.replace(/\s+/g, ' ').trim()));
    console.log('  · 种子：' + SEED.map((s) => s.key).join(', '));
    console.log('');
    console.log('加 --apply 实际执行。');
    return;
  }

  console.log('=== 执行 ===');
  for (const sql of DDL) {
    await prisma.$executeRawUnsafe(sql);
    console.log('  ✓ ' + sql.replace(/\s+/g, ' ').trim().slice(0, 96) + '…');
  }

  // 种子（INSERT OR IGNORE 语义：按 key 查重）
  for (const s of SEED) {
    const dup = await prisma.$queryRawUnsafe(`SELECT id FROM ${TABLE} WHERE key = ?`, s.key);
    if (dup && dup.length) { console.log('  - 跳过种子（已存在）：' + s.key); continue; }
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${TABLE} (key, name, description, permissions, sort, builtin) VALUES (?, ?, ?, ?, ?, ?)`,
      s.key, s.name, s.description, s.permissions, s.sort, s.builtin
    );
    console.log('  ✓ 种子：' + s.key);
  }

  const after = await prisma.$queryRawUnsafe(`PRAGMA table_info(${TABLE})`);
  const rows = await prisma.$queryRawUnsafe(`SELECT key, name, builtin FROM ${TABLE} ORDER BY sort`);
  console.log('');
  console.log('=== 结果 ===');
  console.log('列：' + after.map((c) => c.name).join(', '));
  console.log('行：' + rows.map((r) => `${r.key}(${r.name}${Number(r.builtin) ? ',内置' : ''})`).join(', '));
})()
  .catch((e) => {
    console.error('❌ 失败：', e && e.message ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
