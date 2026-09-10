const path = require('path');
const NODE_MODULES = "C:\\Users\\Shine Lu\\.workbuddy\\binaries\\node\\workspace\\node_modules";
const BACKEND_NM = "E:\\项目开发区\\嘉法狮网站重建\\backend\\node_modules";
process.env.NODE_PATH = NODE_MODULES + ';' + BACKEND_NM;
require('module').Module._initPaths();
const puppeteer = require(path.join(NODE_MODULES, 'puppeteer-core'));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SECRET = 'Gattefosse_JWT_Secret_Key_2026_Change_In_Production';
const jwt = require(path.join(BACKEND_NM, 'jsonwebtoken'));

(async () => {
  const token = jwt.sign({ userId: 1, email: 'admin@local.test', role: 'super_admin' }, SECRET, { expiresIn: '1h' });
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--proxy-bypass-list=*'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  // 先落到同源页面注入 token
  await page.goto('http://127.0.0.1:3000/admin/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.evaluate(t => { try { localStorage.setItem('admin_token', t); } catch (e) {} }, token);

  // 1) 主后台：导航是否出现「招聘管理」
  await page.goto('http://127.0.0.1:3000/admin/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
  const nav = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.nav-item')).map(a => a.textContent.trim());
    return { items, hasCareer: items.some(t => t.includes('招聘管理')) };
  });
  console.log('[1] 主后台导航:', JSON.stringify(nav.hasCareer), '| 运营组相关:', nav.items.filter(t => /招聘|用户管理|系统设置|标签管理/.test(t)));

  // 点击招聘管理，检查 iframe 是否加载子页面
  await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('.nav-item')).find(x => x.textContent.includes('招聘管理'));
    if (a) a.click();
  });
  await new Promise(r => setTimeout(r, 3000));
  const iframeInfo = await page.evaluate(() => {
    const f = document.querySelector('.content iframe');
    return { src: f ? f.getAttribute('src') : null };
  });
  console.log('[2] iframe src:', iframeInfo.src);

  // 2) 直接打开子页面，验证渲染
  await page.goto('http://127.0.0.1:3000/admin/careers-standalone.html', { waitUntil: 'networkidle2', timeout: 30000 });
  const sub = await page.evaluate(() => ({
    title: document.querySelector('.page-title')?.textContent?.trim(),
    pills: Array.from(document.querySelectorAll('.status-pill')).map(p => p.textContent.trim()),
    cols: Array.from(document.querySelectorAll('thead th')).map(t => t.textContent.trim()),
    empty: document.querySelector('td.empty')?.textContent?.trim(),
    hasApp: !!document.querySelector('#app').__vue_app__ || document.querySelectorAll('.card').length > 0,
  }));
  console.log('[3] 子页面:', JSON.stringify(sub, null, 1));

  // 3) 设置页 Tab5 邮件通知是否存在
  await page.goto('http://127.0.0.1:3000/admin/settings-standalone.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  const smtpTab = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.tab')).map(t => t.textContent.trim());
    const has = !!document.querySelector('#tab-smtp');
    return { tabs, hasSmtpCard: has, hasTestBtn: !!document.querySelector('#smtpTestBtn') };
  });
  console.log('[4] 设置页:', JSON.stringify(smtpTab));

  // 截图存档
  await page.evaluate(() => { const t = Array.from(document.querySelectorAll('.tab')).find(x => x.textContent.includes('邮件通知')); if (t) t.click(); });
  await new Promise(r => setTimeout(r, 800));
  const outDir = 'E:\\项目开发区\\嘉法狮网站重建\\admin\\outputs';
  await page.screenshot({ path: path.join(outDir, 'smtp-settings.png'), fullPage: false });
  await page.goto('http://127.0.0.1:3000/admin/careers-standalone.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(outDir, 'careers-admin.png'), fullPage: false });

  console.log('[5] 页面错误:', errs.length ? errs : '无');
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
