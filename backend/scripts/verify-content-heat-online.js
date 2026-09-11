/**
 * 内容热度「线上」复核脚本（2026-09-12）
 * 在服务器上运行：cd /opt/gattefosse/backend && node scripts/verify-content-heat-online.js
 *
 * 覆盖：鉴权 / 采集写入 / 属地解析 / 去重 / 宽松 body / 展示层口径 / 板块筛选 /
 *      未浏览清单 / 收尾清理。所有测试数据以 online-check- 前缀命名，末尾自动清除。
 */
const fs = require('fs');
const http = require('http');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const p = new PrismaClient();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const PUB_IP = '8.8.8.8';

let pass = 0, fail = 0;
const failures = [];
function chk(name, cond, extra) {
  const ok = !!cond;
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}

function req(opts, body) {
  return new Promise((resolve) => {
    const r = http.request(opts, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch { /* 非 json */ }
        resolve({ status: res.statusCode, raw: b, json });
      });
    });
    r.on('error', (e) => resolve({ status: 0, raw: String(e.message), json: null }));
    if (body !== undefined) r.write(body);
    r.end();
  });
}

function post(events, { ip = PUB_IP, ua = UA, ctype = 'application/json', path = '/online-check' } = {}) {
  const body = JSON.stringify({ path, events });
  return req({
    host: 'localhost', port: 3000, path: '/api/track/content', method: 'POST',
    headers: {
      'Content-Type': ctype,
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': ua,
      'X-Forwarded-For': ip,
    },
  }, body);
}

function getHeat(qs, token) {
  const headers = { 'User-Agent': UA };
  if (token) headers.Authorization = 'Bearer ' + token;
  return req({ host: 'localhost', port: 3000, path: '/api/stats/content-heat' + qs, method: 'GET', headers });
}

(async () => {
  // ---------- 清理上次残留 ----------
  const pre = await p.contentView.deleteMany({
    where: { OR: [{ objectId: { startsWith: 'online-check' } }, { objectId: { startsWith: 'verify-online' } }] },
  });
  if (pre.count) console.log('（清理上次残留 ' + pre.count + ' 行）');

  // ---------- 1. 鉴权 ----------
  const env = fs.readFileSync(__dirname + '/../.env', 'utf8');
  const secret = (env.match(/^JWT_SECRET=(.*)$/m) || [])[1].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, "$1");
  const u = await p.user.findFirst({ where: { role: 'super_admin' }, select: { id: true, email: true } });
  chk('① 找到 super_admin 账号', !!u, u && u.email);

  const token = jwt.sign({ userId: u.id, email: u.email, role: 'super_admin' }, secret, { expiresIn: '10m' });
  const me = await req({ host: 'localhost', port: 3000, path: '/api/auth/me', method: 'GET', headers: { Authorization: 'Bearer ' + token, 'User-Agent': UA } });
  chk('② 铸出的 token 可登录（/api/auth/me = 200）', me.status === 200, me.status);

  const noauth = await getHeat('?range=7d', null);
  chk('③ 未带 token 访问内容热度被拒（401）', noauth.status === 401, noauth.status);

  const okAuth = await getHeat('?range=7d', token);
  chk('④ 带 token 访问成功（200, code=0）', okAuth.status === 200 && okAuth.json && okAuth.json.code === 0, okAuth.status);

  // ---------- 2. 采集写入 ----------
  const r1 = await post([
    { type: 'pc_product', id: 'online-check-pc', name: '线上复核原料', section: 'personal_care', event: 'view' },
    { type: 'document', id: 'online-check-doc', name: '线上复核技术数据表', section: 'personal_care', event: 'download', parentId: 'online-check-pc', parentName: '线上复核原料' },
    { type: 'pharma_product', id: 'online-check-pharma', name: '线上复核辅料', section: 'pharma', event: 'view' },
  ]);
  chk('⑤ 正常事件写入成功（accepted=3）', r1.json && r1.json.data && r1.json.data.accepted === 3, r1.json && r1.json.data);

  const rows = await p.contentView.findMany({ where: { objectId: { startsWith: 'online-check' } }, orderBy: { id: 'asc' } });
  chk('⑥ 落库行数 = 3', rows.length === 3, rows.length);

  const docRow = rows.find((r) => r.objectType === 'document');
  chk('⑦ X-Forwarded-For 透传真实 IP（ip=' + PUB_IP + '）', rows[0] && (rows[0].ip || '').replace(/^::ffff:/, '') === PUB_IP, rows[0] && rows[0].ip);
  chk('⑧ 公网 IP 属地解析成功（非空）', !!(rows[0] && rows[0].region), rows[0] && rows[0].region);
  chk('⑨ 资料事件带父对象（parentId/parentName）', docRow && docRow.parentId === 'online-check-pc' && docRow.parentName === '线上复核原料', docRow && [docRow.parentId, docRow.parentName]);
  chk('⑩ pagePath 归一为去 query 的路径', rows.every((r) => r.pagePath === '/online-check'), [...new Set(rows.map((r) => r.pagePath))]);
  chk('⑪ 各事件 section/eventType 正确', rows.some((r) => r.section === 'personal_care' && r.eventType === 'view') && rows.some((r) => r.section === 'pharma'), rows.map((r) => r.section + '/' + r.eventType));

  // ---------- 3. 去重 ----------
  const again = await post([{ type: 'pc_product', id: 'online-check-pc', name: '线上复核原料', section: 'personal_care', event: 'view' }]);
  const cntAfter = await p.contentView.count({ where: { objectId: 'online-check-pc' } });
  chk('⑫ 30 秒内同访客重复上报被去重（=1 行）', cntAfter === 1, { accepted: again.json && again.json.data, rows: cntAfter });

  // ---------- 4. 宽松 body（sendBeacon Blob 会被标成 text/plain） ----------
  const loose = await post([{ type: 'article', id: 'online-check-article', name: '线上复核文章', section: 'learn_more', event: 'view' }], { ctype: 'text/plain' });
  chk('⑬ text/plain（sendBeacon Blob）也能解析', loose.json && loose.json.data && loose.json.data.accepted === 1, loose.json && loose.json.data);

  // ---------- 5. 聚合口径 ----------
  const heat = await getHeat('?range=7d', token);
  const d = heat.json && heat.json.data;
  chk('⑭ 摘要 PV 计入本次写入（≥4）', d && d.summary.pv >= 4, d && d.summary);
  chk('⑮ summary.dayKeys 为 7 天', d && Array.isArray(d.dayKeys) && d.dayKeys.length === 7, d && d.dayKeys);

  const pcSec = d && (d.sections || []).find((s) => s.key === 'personal_care');
  const pcGroup = pcSec && (pcSec.groups || []).find((g) => g.type === 'pc_product');
  const pcItem = pcGroup && (pcGroup.items || []).find((i) => i.id === 'online-check-pc');
  chk('⑯ 个人护理板块出现该原料且 PV=1 / UV=1', pcItem && pcItem.pv === 1 && pcItem.uv === 1, pcItem && { pv: pcItem.pv, uv: pcItem.uv });
  chk('⑰ 榜单项带 7 天 sparkline', pcItem && Array.isArray(pcItem.spark) && pcItem.spark.length === 7 && pcItem.spark.reduce((a, b) => a + b, 0) === 1, pcItem && pcItem.spark);
  chk('⑱ 覆盖率分母存在（pc_product.total 为数字）', pcGroup && typeof pcGroup.total === 'number', pcGroup && pcGroup.total);

  const docGroup = pcSec && (pcSec.groups || []).find((g) => g.type === 'document');
  const docItem = docGroup && (docGroup.items || []).find((i) => i.id === 'online-check-doc');
  chk('⑲ 资料榜展示其归属产品名', docItem && docItem.parentName === '线上复核原料', docItem && docItem.parentName);

  const allIds = [];
  (d.sections || []).forEach((s) => (s.groups || []).forEach((g) => (g.items || []).forEach((i) => allIds.push(i.id))));
  chk('⑳ 展示层剔除内网行（verify-online-1 不出现）', !allIds.includes('verify-online-1'), allIds.filter((x) => x.indexOf('verify') >= 0));

  const pharma = await getHeat('?range=pharma-bad&section=pharma', token);
  const pd = pharma.json && pharma.json.data;
  chk('㉑ 非法 range 回退为 7d', pd && pd.range === '7d', pd && pd.range);
  chk('㉒ section=pharma 只返回药用辅料板块', pd && pd.sections.length === 1 && pd.sections[0].key === 'pharma', pd && pd.sections.map((s) => s.key));

  const zero = await getHeat('?range=7d&withZero=1', token);
  const zd = zero.json && zero.json.data;
  chk('㉓ withZero=1 返回未被浏览清单', zd && zd.unviewed && Array.isArray(zd.unviewed.pc_product), zd && zd.unviewed && Object.keys(zd.unviewed));
  chk('㉔ 未被浏览清单不含刚浏览过的对象', zd && !(zd.unviewed.pc_product || []).some((x) => x.id === 'online-check-pc'), null);

  // ---------- 6. 收尾清理 ----------
  const cleaned = await p.contentView.deleteMany({
    where: { OR: [{ objectId: { startsWith: 'online-check' } }, { objectId: { startsWith: 'verify-online' } }] },
  });
  const left = await p.contentView.count();
  chk('㉕ 测试数据已清理（表内剩余 ' + left + ' 行）', left === 0, { deleted: cleaned.count, left });

  console.log('\n=== 结果 ===');
  console.log('通过 ' + pass + ' / 共 ' + (pass + fail) + (fail ? '，失败：' + failures.join('、') : '，0 失败'));
  await p.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('ERR', e && e.message);
  await p.$disconnect().catch(() => {});
  process.exit(1);
});
