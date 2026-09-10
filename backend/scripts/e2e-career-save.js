const path = require('path');
const NODE_MODULES = "C:\\Users\\Shine Lu\\.workbuddy\\binaries\\node\\workspace\\node_modules";
const BACKEND_NM = "E:\\项目开发区\\嘉法狮网站重建\\backend\\node_modules";
require('module').Module._initPaths();
const puppeteer = require(path.join(NODE_MODULES, 'puppeteer-core'));
const jwt = require(path.join(BACKEND_NM, 'jsonwebtoken'));

const BASE = 'http://127.0.0.1:3000';
const SECRET = 'Gattefosse_JWT_Secret_Key_2026_Change_In_Production';

(async () => {
  const token = jwt.sign({ userId: 1, email: 'admin@local.test', role: 'super_admin' }, SECRET, { expiresIn: '2h' });
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

  // 造一条待处理申请
  const email = `e2e-save-${Date.now()}@local.test`;
  const created = await fetch(BASE + '/api/careers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: '保存测试', email, country: '中国', position: '测试岗位', message: '验证保存后弹框关闭', agreed: true }),
  }).then(r => r.json());
  const id = created.data.id;

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new', args: ['--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('dialog', async d => { errs.push('意外弹窗: ' + d.message()); await d.dismiss(); });

  await page.goto(BASE + '/admin/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(t => localStorage.setItem('admin_token', t), token);
  await page.goto(BASE + '/admin/careers-standalone.html?keyword=' + encodeURIComponent(email), { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  // 打开详情
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('tbody .btn')).find(x => x.textContent.trim() === '详情');
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 700));
  console.log('[1] 点击前弹框存在:', await page.evaluate(() => !!document.querySelector('.modal-overlay')));

  // 改状态 + 备注，点保存
  await page.select('.modal-card select', 'interview');
  await page.evaluate(() => {
    const ta = document.querySelector('.modal-card textarea');
    ta.value = '已沟通，约定面试';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.modal-card .btn')).find(x => x.textContent.trim() === '保存');
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 1800));

  console.log('[2] 点击保存后弹框存在:', await page.evaluate(() => !!document.querySelector('.modal-overlay')));
  console.log('[3] 列表状态徽标:', await page.evaluate(() => document.querySelector('tbody .st')?.textContent?.trim()));

  // 复查后端是否真的落库
  const row = await fetch(BASE + '/api/careers/' + id, { headers: H }).then(r => r.json());
  console.log('[4] 后端入库:', JSON.stringify({ status: row.data.status, notes: row.data.notes, reviewedAt: !!row.data.reviewedAt }));

  // 再打开一次，确认备注回填
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('tbody .btn')).find(x => x.textContent.trim() === '详情');
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 700));
  console.log('[5] 详情回填:', await page.evaluate(() => ({
    select: document.querySelector('.modal-card select')?.value,
    notes: document.querySelector('.modal-card textarea')?.value,
  })));

  console.log('[6] 页面错误:', errs.length ? errs : '无');

  await fetch(BASE + '/api/careers/' + id, { method: 'DELETE', headers: H });
  console.log('[7] 测试数据已清理');
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
