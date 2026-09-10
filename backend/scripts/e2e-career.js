const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const BASE = 'http://127.0.0.1:3000';
const SECRET = 'Gattefosse_JWT_Secret_Key_2026_Change_In_Production';

function log(t, v) { console.log(`\n=== ${t} ===`); if (v !== undefined) console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2)); }

async function main() {
  // 0. 造一个测试 PDF
  const tmpPdf = path.join(__dirname, 'e2e-resume.pdf');
  fs.writeFileSync(tmpPdf, '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

  // 1. 匿名上传简历
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(tmpPdf)], { type: 'application/pdf' }), '张三-简历.pdf');
  const up = await fetch(`${BASE}/api/careers/upload?kind=resume`, { method: 'POST', body: fd });
  const upJson = await up.json();
  log('1. 上传简历', upJson);

  const token = upJson?.data?.token;
  if (!token) throw new Error('上传失败，无 token');

  // 2. 提交申请
  const email = `e2e-${Date.now()}@local.test`;
  const create = await fetch(`${BASE}/api/careers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: '三', lastName: '张',
      email, phone: '13800000000', country: 'China',
      position: '应用研发工程师', jobFunction: 'Personal care',
      message: '我对贵公司的个人护理原料研发岗位非常感兴趣。',
      resumeToken: token, resumeName: '张三-简历.pdf',
      agreed: true,
      url: '',
    }),
  });
  const createJson = await create.json();
  log('2. 提交申请', createJson);
  const appId = createJson?.data?.id;
  if (!appId) throw new Error('提交失败');

  // 3. 重复提交应被拦截
  const dup = await fetch(`${BASE}/api/careers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: '三', lastName: '张', email, country: 'China', position: '工程师', jobFunction: 'Support', message: '重复提交测试', agreed: true }),
  });
  log('3. 重复提交（应 429）', { status: dup.status, body: await dup.json() });

  // 4. 蜜罐字段
  const honey = await fetch(`${BASE}/api/careers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'B', lastName: 'T', email: 'bot@spam.test', country: 'China', position: 'x', jobFunction: 'Support', message: 'spam', agreed: true, url: 'http://spam' }),
  });
  log('4. 蜜罐提交（应伪装成功且不入库）', await honey.json());

  // 5. 未同意隐私政策
  const noAgree = await fetch(`${BASE}/api/careers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: '四', lastName: '李', email: 'lisi@local.test', country: 'China', position: '工程师', jobFunction: 'Support', message: '未同意隐私', agreed: false }),
  });
  log('5. 未同意隐私（应 400）', { status: noAgree.status, body: await noAgree.json() });

  // 6. 匿名访问后台接口（应 401）
  const anon = await fetch(`${BASE}/api/careers`);
  log('6. 匿名取列表（应 401）', { status: anon.status, body: await anon.json() });

  // 7. 带 token 取列表
  const jwtToken = jwt.sign({ userId: 1, email: 'admin@local.test', role: 'super_admin' }, SECRET, { expiresIn: '1h' });
  const H = { Authorization: `Bearer ${jwtToken}` };
  const list = await fetch(`${BASE}/api/careers?limit=5`, { headers: H });
  const listJson = await list.json();
  log('7. 列表（鉴权）', { total: listJson.data?.pagination?.total, counts: listJson.data?.counts, first: listJson.data?.list?.[0] });

  // 8. 关键词筛选
  const kw = await fetch(`${BASE}/api/careers?keyword=${encodeURIComponent('张三')}`, { headers: H });
  log('8. 关键词筛选', { total: (await kw.json()).data?.pagination?.total });

  // 9. 下载简历
  const dl = await fetch(`${BASE}/api/careers/${appId}/file/resume`, { headers: H });
  const buf = Buffer.from(await dl.arrayBuffer());
  log('9. 下载简历', { status: dl.status, contentType: dl.headers.get('content-type'), disposition: dl.headers.get('content-disposition'), bytes: buf.length });

  // 10. 匿名下载（应 401）
  const dlAnon = await fetch(`${BASE}/api/careers/${appId}/file/resume`);
  log('10. 匿名下载（应 401）', { status: dlAnon.status });

  // 11. 更新状态 + 备注
  const upd = await fetch(`${BASE}/api/careers/${appId}`, {
    method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'interview', notes: '简历匹配度高，安排一面' }),
  });
  const updJson = await upd.json();
  log('11. 更新状态', { status: updJson.data?.status, notes: updJson.data?.notes, reviewedAt: updJson.data?.reviewedAt });

  // 12. 非法状态
  const bad = await fetch(`${BASE}/api/careers/${appId}`, {
    method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'hacked' }),
  });
  log('12. 非法状态（应 400）', { status: bad.status, body: await bad.json() });

  // 收尾：删除测试数据
  const del = await fetch(`${BASE}/api/careers/${appId}`, { method: 'DELETE', headers: H });
  log('13. 删除测试申请', await del.json());

  fs.unlinkSync(tmpPdf);
  console.log('\n✅ E2E 完成');
}

main().catch((e) => { console.error('❌ E2E 失败:', e); process.exit(1); });
