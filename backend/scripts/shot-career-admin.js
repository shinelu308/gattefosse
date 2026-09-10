const path = require('path');
const NODE_MODULES = "C:\\Users\\Shine Lu\\.workbuddy\\binaries\\node\\workspace\\node_modules";
const BACKEND_NM = "E:\\项目开发区\\嘉法狮网站重建\\backend\\node_modules";
require('module').Module._initPaths();
const puppeteer = require(path.join(NODE_MODULES, 'puppeteer-core'));
const jwt = require(path.join(BACKEND_NM, 'jsonwebtoken'));

const OUT = 'E:\\项目开发区\\嘉法狮网站重建\\admin\\outputs';

(async () => {
  const token = jwt.sign({ userId: 1, email: 'admin@local.test', role: 'super_admin' },
    'Gattefosse_JWT_Secret_Key_2026_Change_In_Production', { expiresIn: '2h' });

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new', args: ['--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1080, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));

  await page.goto('http://127.0.0.1:3000/admin/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(t => localStorage.setItem('admin_token', t), token);

  await page.goto('http://127.0.0.1:3000/admin/careers-standalone.html', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(OUT, 'careers-list.png'), fullPage: true });

  // 打开详情弹框（第一条：王思远）
  const ok = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('tbody .btn'));
    const target = btns.find(b => b.textContent.trim() === '详情');
    if (!target) return false;
    target.click();
    return true;
  });
  await new Promise(r => setTimeout(r, 900));
  const modal = await page.evaluate(() => {
    const m = document.querySelector('.modal-overlay .modal-card');
    if (!m) return null;
    return {
      head: m.querySelector('h3')?.textContent?.trim(),
      rows: Array.from(m.querySelectorAll('.detail-grid dt')).map(d => d.textContent.trim()),
      hasMsg: !!m.querySelector('.msg-box'),
      hasNotesField: !!m.querySelector('textarea'),
      statusOptions: Array.from(m.querySelectorAll('select option')).map(o => o.textContent.trim()),
      shortcuts: Array.from(m.querySelectorAll('.btn-sm')).map(b => b.textContent.trim()).filter(Boolean),
    };
  });
  console.log('详情弹框:', JSON.stringify({ opened: ok, ...(modal || {}) }, null, 1));
  if (modal) await page.screenshot({ path: path.join(OUT, 'careers-detail.png') });

  await page.keyboard.press('Escape');
  await page.evaluate(() => { const b = document.querySelector('.modal-overlay .btn-sm'); if (b) b.click(); });

  // 状态筛选：点击「面试」
  await page.evaluate(() => {
    const p = Array.from(document.querySelectorAll('.status-pill')).find(x => x.textContent.includes('面试'));
    if (p) p.click();
  });
  await new Promise(r => setTimeout(r, 1200));
  const filtered = await page.evaluate(() => ({
    rows: document.querySelectorAll('tbody tr').length,
    names: Array.from(document.querySelectorAll('tbody .name-cell')).map(n => n.textContent.trim()),
    total: document.querySelector('.pager') ? 'paged' : 'single',
    countText: document.querySelector('.card-header span[style*="color:#888"]')?.textContent?.trim(),
  }));
  console.log('筛选「面试」:', JSON.stringify(filtered));

  console.log('页面错误:', errs.length ? errs : '无');
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
