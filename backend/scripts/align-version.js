/**
 * 本地版本号对齐线上（每次 deploy 后线上会 +1，本地需跟上）
 *
 * 用法：cd backend && node scripts/align-version.js
 *
 * 背景：线上 deploy 会更新线上 dist/index.js → 线上 system_version +1；
 *       本地不编译则版本不变 → 两边不一致。
 * ⚠️ 只改 system_version，**保留本地 system_build_id**（= 本地 dist/index.js 的 mtime），
 *    否则下次本地启动会被误判为「新构建」再 +1。
 */
const https = require('https');
const { PrismaClient } = require('@prisma/client');

const ONLINE = process.env.ONLINE || 'https://gattefosse.loudaren.com';
const p = new PrismaClient();

function fetchOnlineVersion() {
  return new Promise((resolve, reject) => {
    const req = https.get(ONLINE + '/api/settings', { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => {
        const m = s.match(/system_version":"([^"]+)"/);
        m ? resolve(m[1]) : reject(new Error('线上未返回 system_version'));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求线上超时')); });
  });
}

(async () => {
  const online = await fetchOnlineVersion();
  const before = await p.$queryRawUnsafe(
    "SELECT key, value FROM settings WHERE key IN ('system_version','system_build_id')"
  );
  const localVer = (before.find((r) => r.key === 'system_version') || {}).value;
  console.log('线上 ' + online + '  |  本地 ' + localVer);

  if (localVer === online) {
    console.log('已一致，无需改动（build_id 保持不变）');
  } else {
    await p.$executeRawUnsafe('UPDATE settings SET value = ? WHERE key = ?', online, 'system_version');
    const after = await p.$queryRawUnsafe(
      "SELECT key, value FROM settings WHERE key IN ('system_version','system_build_id')"
    );
    console.log('已对齐 → ' + JSON.stringify(after));
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  try { await p.$disconnect(); } catch (x) {}
  process.exit(1);
});
