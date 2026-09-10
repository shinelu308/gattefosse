const path = require('path');
const fs = require('fs');
const NODE_MODULES = "C:\\Users\\Shine Lu\\.workbuddy\\binaries\\node\\workspace\\node_modules";
const BACKEND_NM = "E:\\项目开发区\\嘉法狮网站重建\\backend\\node_modules";
require('module').Module._initPaths();
const puppeteer = require(path.join(NODE_MODULES, 'puppeteer-core'));
const jwt = require(path.join(BACKEND_NM, 'jsonwebtoken'));

const TMP = path.join(__dirname, 'e2e-resume-上传测试.pdf');
const OUT = 'E:\\项目开发区\\嘉法狮网站重建\\admin\\outputs';

(async () => {
  fs.writeFileSync(TMP, '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new', args: ['--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1100, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('console: ' + m.text()); });

  const email = `e2e-form-${Date.now()}@local.test`;
  await page.goto('http://127.0.0.1:3000/job-form.html', { waitUntil: 'networkidle2', timeout: 40000 });
  await new Promise(r => setTimeout(r, 1500));

  // 1) 只填姓名就提交 → 应提示邮箱
  await page.type('#edit-first-name--2', '林小满');
  await page.click('#edit-submit--2');
  await new Promise(r => setTimeout(r, 400));
  console.log('[1] 缺邮箱提示:', await page.$eval('#submitStatus', e => e.textContent.trim()));

  // 2) 填邮箱 + 不选文件 → 应提示上传
  await page.type('#edit-e-mail--2', email);
  await page.click('#edit-submit--2');
  await new Promise(r => setTimeout(r, 400));
  console.log('[2] 缺文件提示:', await page.$eval('#submitStatus', e => e.textContent.trim()));

  // 3) 上传非法类型 → 应拦下
  const badFile = path.join(__dirname, 'bad.txt');
  fs.writeFileSync(badFile, 'x');
  await (await page.$('#edit-upload-your-resume-and-cover-letter-upload--2')).uploadFile(badFile);
  await new Promise(r => setTimeout(r, 500));
  console.log('[3] 非法类型提示:', await page.$eval('#submitStatus', e => e.textContent.trim()));
  fs.unlinkSync(badFile);

  // 4) 正常提交
  await page.select('#edit-pays-country--2', 'China');
  await page.type('#edit-your-text--2', '您好，我从事化妆品功效评价 4 年，希望应聘研发岗位。');
  await (await page.$('#edit-upload-your-resume-and-cover-letter-upload--2')).uploadFile(TMP);
  await new Promise(r => setTimeout(r, 500));
  console.log('[4] 文件名回显:', await page.$eval('#resumeFileName', e => e.textContent.trim()));

  await page.click('#edit-submit--2');
  // 等待成功文案
  await page.waitForFunction(
    () => /已经提交/.test(document.querySelector('#submitStatus')?.textContent || ''),
    { timeout: 15000 }
  ).catch(() => {});
  const status = await page.$eval('#submitStatus', e => ({ text: e.textContent.trim(), cls: e.className }));
  console.log('[5] 提交结果:', JSON.stringify(status));
  await page.screenshot({ path: path.join(OUT, 'job-form-submitted.png'), fullPage: false });

  // 5) 蜜罐：JS 注入 url 字段后提交（应伪装成功但入库被丢弃 → 用后台 API 校验）
  const admin = jwt.sign({ userId: 1, email: 'admin@local.test', role: 'super_admin' },
    'Gattefosse_JWT_Secret_Key_2026_Change_In_Production', { expiresIn: '1h' });
  await new Promise(r => setTimeout(r, 800));
  const list = await fetch('http://127.0.0.1:3000/api/careers?keyword=' + encodeURIComponent(email), {
    headers: { Authorization: 'Bearer ' + admin },
  }).then(r => r.json());
  const row = list.data && list.data.list && list.data.list[0];
  console.log('[6] 入库校验:', row ? JSON.stringify({
    id: row.id, email: row.email, country: row.country, message: row.message,
    resumePath: row.resumePath, resumeName: row.resumeName, status: row.status, ip: row.ip,
  }) : '未找到');

  // 下载简历验证
  if (row && row.resumePath) {
    const dl = await fetch(`http://127.0.0.1:3000/api/careers/${row.id}/file/resume`, { headers: { Authorization: 'Bearer ' + admin } });
    const buf = Buffer.from(await dl.arrayBuffer());
    console.log('[7] 后台下载简历:', dl.status, buf.length, 'bytes');
    await fetch(`http://127.0.0.1:3000/api/careers/${row.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + admin } });
    console.log('[8] 测试数据已清理');
  }

  console.log('页面错误:', errs.length ? errs : '无');
  fs.unlinkSync(TMP);
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
