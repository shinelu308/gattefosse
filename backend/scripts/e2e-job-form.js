const path = require('path');
const fs = require('fs');
const NODE_MODULES = "C:\\Users\\Shine Lu\\.workbuddy\\binaries\\node\\workspace\\node_modules";
const BACKEND_NM = "E:\\项目开发区\\嘉法狮网站重建\\backend\\node_modules";
require('module').Module._initPaths();
const puppeteer = require(path.join(NODE_MODULES, 'puppeteer-core'));
const jwt = require(path.join(BACKEND_NM, 'jsonwebtoken'));

const BASE = 'http://127.0.0.1:3000';
const OUT = 'E:\\项目开发区\\嘉法狮网站重建\\admin\\outputs';
const TMP_RESUME = path.join(__dirname, 'e2e-简历-张三.pdf');
const TMP_COVER = path.join(__dirname, 'e2e-求职信-张三.pdf');

(async () => {
  fs.writeFileSync(TMP_RESUME, '%PDF-1.4\nresume\n%%EOF\n');
  fs.writeFileSync(TMP_COVER, '%PDF-1.4\ncover letter\n%%EOF\n');

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new', args: ['--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1200, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', async d => { errs.push('意外 alert: ' + d.message()); await d.dismiss(); });

  const email = `e2e-job-${Date.now()}@local.test`;
  await page.goto(BASE + '/job-form.html', { waitUntil: 'networkidle2', timeout: 40000 });
  await new Promise(r => setTimeout(r, 1500));

  // 1) 字段齐备性 + 国家下拉
  const struct = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('form.webform-submission-form label, form.webform-submission-form legend'))
      .map(l => l.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const sel = document.querySelector('#edit-pays-country--2');
    const fnSel = document.querySelector('#edit-function--2');
    return {
      labels,
      countryCount: sel ? sel.options.length : 0,
      countryDefault: sel ? sel.value : null,
      countrySamples: sel ? [sel.options[1], sel.options[sel.options.length - 1]].map(o => o.value + '=' + o.textContent) : [],
      hk: sel ? Array.from(sel.options).filter(o => /Taiwan|Hong Kong|Macao/.test(o.value)).map(o => o.value + '=' + o.textContent) : [],
      functions: fnSel ? Array.from(fnSel.options).map(o => o.value + '=' + o.textContent) : [],
      fileInputs: Array.from(document.querySelectorAll('form input[type=file]')).map(f => f.id),
    };
  });
  console.log('[1] 字段:', JSON.stringify(struct.labels));
  console.log('[2] 国家下拉:', struct.countryCount, '项 | 默认:', struct.countryDefault, '| 抽样:', JSON.stringify(struct.countrySamples), '| 港澳台:', JSON.stringify(struct.hk));
  console.log('[3] 职能领域:', JSON.stringify(struct.functions), '| 文件控件:', JSON.stringify(struct.fileInputs));

  // 2) 逐级校验
  const step = async (setup, tip) => {
    if (setup) await setup();
    await page.click('#edit-submit--2');
    await new Promise(r => setTimeout(r, 350));
    const t = await page.$eval('#submitStatus', e => e.textContent.trim());
    console.log(`[校验] ${tip} → ${t}`);
  };
  await step(null, '空表单');
  await page.type('#edit-first-name--2', '三');
  await step(null, '只填名');
  await page.type('#edit-last-name--2', '张');
  await step(null, '只填姓名');
  await page.type('#edit-e-mail--2', email);
  await step(null, '未填期望岗位');
  await page.type('#edit-desired-job--2', '应用研发工程师');
  await step(null, '未选职能领域');
  await page.select('#edit-function--2', 'Personal care');
  await step(null, '未填内容');
  await page.type('#edit-your-text--2', '我拥有 5 年化妆品活性成分应用研究经验，希望加入个人护理团队。');
  await step(null, '未传简历');

  // 3) 简历必传校验 + 求职信选填
  await (await page.$('#edit-upload-your-resume-upload--2')).uploadFile(TMP_RESUME);
  await new Promise(r => setTimeout(r, 400));
  console.log('[4] 简历回显:', await page.$eval('#resumeFileName', e => e.textContent.trim()));
  await (await page.$('#edit-upload-your-cover-letter-upload--2')).uploadFile(TMP_COVER);
  await new Promise(r => setTimeout(r, 400));
  console.log('[5] 求职信回显:', await page.$eval('#coverLetterFileName', e => e.textContent.trim()));

  // 4) 提交
  await page.click('#edit-submit--2');
  await page.waitForFunction(() => /已经提交/.test(document.querySelector('#submitStatus')?.textContent || ''), { timeout: 20000 }).catch(() => {});
  console.log('[6] 提交结果:', JSON.stringify(await page.$eval('#submitStatus', e => ({ text: e.textContent.trim(), cls: e.className }))));
  await page.screenshot({ path: path.join(OUT, 'job-form-fields.png'), fullPage: true });

  // 5) 后端落库校验
  const admin = jwt.sign({ userId: 1, email: 'admin@local.test', role: 'super_admin' },
    'Gattefosse_JWT_Secret_Key_2026_Change_In_Production', { expiresIn: '1h' });
  const H = { Authorization: 'Bearer ' + admin };
  const list = await fetch(BASE + '/api/careers?keyword=' + encodeURIComponent(email), { headers: H }).then(r => r.json());
  const row = list.data && list.data.list && list.data.list[0];
  console.log('[7] 入库:', row ? JSON.stringify({
    id: row.id, fullName: row.fullName, firstName: row.firstName, lastName: row.lastName,
    country: row.country, position: row.position, jobFunction: row.jobFunction,
    message: (row.message || '').slice(0, 12) + '…',
    resumePath: row.resumePath, resumeName: row.resumeName,
    coverLetterPath: row.coverLetterPath, coverLetterName: row.coverLetterName, status: row.status,
  }) : '未找到');
  if (row) {
    for (const kind of ['resume', 'cover']) {
      const dl = await fetch(`${BASE}/api/careers/${row.id}/file/${kind}`, { headers: H });
      const b = Buffer.from(await dl.arrayBuffer());
      console.log(`[8] 下载 ${kind}:`, dl.status, dl.headers.get('content-type'), b.length + 'B');
    }
    await fetch(`${BASE}/api/careers/${row.id}`, { method: 'DELETE', headers: H });
    console.log('[9] 测试数据已清理');
  }

  // 6) 必填项服务端兜底
  const bad = await fetch(BASE + '/api/careers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: '三', lastName: '张', email: 'x' + Date.now() + '@local.test', country: 'China', message: 'x', agreed: true }),
  });
  console.log('[10] 缺期望岗位的服务端返回:', bad.status, (await bad.json()).message);
  const badFn = await fetch(BASE + '/api/careers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: '三', lastName: '张', email: 'y' + Date.now() + '@local.test', position: '工程师', jobFunction: 'Hacking', country: 'China', message: 'x', agreed: true }),
  });
  console.log('[11] 非法职能领域的服务端返回:', badFn.status, (await badFn.json()).message);

  console.log('[12] 页面错误:', errs.length ? errs : '无');
  fs.unlinkSync(TMP_RESUME); fs.unlinkSync(TMP_COVER);
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
