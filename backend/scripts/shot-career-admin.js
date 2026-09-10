const path = require('path');
const NODE_MODULES = "C:\\Users\\Shine Lu\\.workbuddy\\binaries\\node\\workspace\\node_modules";
const BACKEND_NM = "E:\\项目开发区\\嘉法狮网站重建\\backend\\node_modules";
require('module').Module._initPaths();
const puppeteer = require(path.join(NODE_MODULES, 'puppeteer-core'));
const jwt = require(path.join(BACKEND_NM, 'jsonwebtoken'));

const BASE = 'http://127.0.0.1:3000';
const OUT = 'E:\\项目开发区\\嘉法狮网站重建\\admin\\outputs';
const SECRET = 'Gattefosse_JWT_Secret_Key_2026_Change_In_Production';

(async () => {
  const token = jwt.sign({ userId: 1, email: 'admin@local.test', role: 'super_admin' }, SECRET, { expiresIn: '2h' });
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

  // 造两条：一条双附件 + 各字段齐全，一条仅简历
  const mk = async (payload) => {
    // 上传附件
    const up = async (name, kind) => {
      const fd = new FormData();
      fd.append('file', new Blob([Buffer.from('%PDF-1.4\nx\n%%EOF\n')], { type: 'application/pdf' }), name);
      const r = await fetch(`${BASE}/api/careers/upload?kind=${kind}`, { method: 'POST', body: fd });
      return (await r.json()).data;
    };
    const res = await up(payload.resumeName, 'resume');
    const cov = payload.coverName ? await up(payload.coverName, 'cover') : null;
    return fetch(BASE + '/api/careers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: payload.firstName, lastName: payload.lastName, email: payload.email,
        country: payload.country, position: payload.position, jobFunction: payload.jobFunction,
        message: payload.message,
        resumeToken: res.token, resumeName: res.name,
        coverLetterToken: cov ? cov.token : '', coverLetterName: cov ? cov.name : '',
        agreed: true,
      }),
    }).then(r => r.json());
  };

  const stamp = Date.now();
  const a = await mk({
    firstName: '思远', lastName: '王', email: `e2e-full-${stamp}@local.test`,
    country: 'China', position: '应用研发工程师', jobFunction: 'Personal care',
    message: '您好，我拥有 5 年化妆品活性成分应用研究经验，熟悉配方稳定性评估与体外功效测试，非常希望加入贵公司个人护理团队。',
    resumeName: '王思远-简历.pdf', coverName: '王思远-求职信.pdf',
  });
  const b = await mk({
    firstName: '墨', lastName: '李', email: `e2e-lite-${stamp}@local.test`,
    country: 'France', position: 'Regulatory Affairs Specialist', jobFunction: 'Pharmaceuticals',
    message: 'Currently based in Lyon, looking for a regulatory role covering the APAC region.',
    resumeName: '李墨-CV.pdf',
  });
  const ids = [a.data && a.data.id, b.data && b.data.id].filter(Boolean);
  console.log('种子 ids:', ids.join(','));

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new', args: ['--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));

  await page.goto(BASE + '/admin/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(t => localStorage.setItem('admin_token', t), token);
  await page.goto(BASE + '/admin/careers-standalone.html', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(OUT, 'careers-list.png'), fullPage: true });

  // 打开第一条（双附件）详情
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const t = rows.find(r => r.querySelectorAll('.file-link').length === 2) || rows[0];
    const btn = t && Array.from(t.querySelectorAll('.btn')).find(x => x.textContent.trim() === '详情');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 900));
  const modal = await page.evaluate(() => {
    const m = document.querySelector('.modal-overlay .modal-card');
    if (!m) return null;
    return {
      rows: Array.from(m.querySelectorAll('.detail-grid dt')).map((dt, i) => dt.textContent.trim() + ' = ' + m.querySelectorAll('.detail-grid dd')[i].textContent.trim()),
      files: Array.from(m.querySelectorAll('.detail-grid .file-link')).map(a => a.textContent.trim()),
      statusOptions: Array.from(m.querySelectorAll('select option')).map(o => o.textContent.trim()),
    };
  });
  console.log('详情弹框:', JSON.stringify(modal, null, 1));
  await page.screenshot({ path: path.join(OUT, 'careers-detail.png') });

  // 列表里职能领域显示
  const listFn = await page.evaluate(() => Array.from(document.querySelectorAll('tbody .sub-cell')).map(e => e.textContent.trim()));
  console.log('列表副文本:', JSON.stringify(listFn));

  console.log('页面错误:', errs.length ? errs : '无');
  await browser.close();

  for (const id of ids) await fetch(BASE + '/api/careers/' + id, { method: 'DELETE', headers: H });
  console.log('已清理测试数据');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
