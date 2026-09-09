const puppeteer = require('puppeteer-core');
const jwt = require('E:/项目开发区/嘉法狮网站重建/backend/node_modules/jsonwebtoken');

async function clickByText(page, text, scopeSel) {
  return page.evaluate((text, scopeSel) => {
    const scope = scopeSel ? document.querySelector(scopeSel) : document;
    const els = [...(scope || document).querySelectorAll('a, button')];
    const el = els.find((x) => x.textContent.trim() === text || x.textContent.trim().startsWith(text));
    if (el) { el.click(); return true; }
    return false;
  }, text, scopeSel || null);
}

(async () => {
  const token = jwt.sign({ userId: 1, email: 'admin@gattefosse.local', role: 'super_admin' }, 'Gattefosse_JWT_Secret_Key_2026_Change_In_Production', { expiresIn: '1h' });
  const browser = await puppeteer.launch({ headless: 'new', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });

  // ===== admin/index.html =====
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('E:' + e.message.slice(0, 120)));
  await page.evaluateOnNewDocument((t) => localStorage.setItem('admin_token', t), token);
  await page.goto('http://localhost:3000/admin/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));

  // 侧栏：展开「获取灵感」→ 点「出版物」（第一个为获取灵感组）
  await page.evaluate(() => {
    const links = [...document.querySelectorAll('a.nav-item')];
    const gi = links.find((a) => a.textContent.trim() === '获取灵感' || a.textContent.trim().startsWith('获取灵感'));
    if (gi) gi.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  const clicked = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a.nav-item')];
    const pub = links.filter((a) => a.textContent.trim() === '出版物')[0];
    if (pub) { pub.click(); return true; }
    return false;
  });
  await new Promise((r) => setTimeout(r, 1200));
  console.log('进入出版物列表:', clicked);

  const r1 = await page.evaluate(async () => {
    const btns = [...document.querySelectorAll('button')].map((b) => b.textContent.trim());
    const editBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '编辑');
    if (editBtn) editBtn.click();
    await new Promise((r) => setTimeout(r, 800));
    return {
      importBtn: btns.filter((t) => t.includes('从原站导入')),
      docSel: [...document.querySelectorAll('select')].some((s) => s.textContent.includes('从文档资源选择')),
      upload: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('上传新 PDF')),
      ai: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('AI 翻译')),
    };
  });
  console.log('admin编辑页:', JSON.stringify(r1));

  const r2 = await page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent.includes('科技出版物')));
    return sel ? [...sel.options].map((o) => o.textContent.trim()) : null;
  });
  console.log('类型选项:', JSON.stringify(r2));

  const r3 = await page.evaluate(async () => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('从原站导入'));
    if (!b) return { open: false, err: 'no btn' };
    b.click();
    await new Promise((r) => setTimeout(r, 500));
    const m = document.querySelector('.modal');
    return { open: !!m, hasPages: m ? !!m.querySelector('input[type=number]') : false, hint: m ? m.textContent.includes('入文档资源') : false };
  });
  console.log('导入对话框:', JSON.stringify(r3));
  await page.close();

  // ===== learn-more publications =====
  const page2 = await browser.newPage();
  const errs2 = [];
  page2.on('pageerror', (e) => errs2.push(e.message.slice(0, 120)));
  await page2.evaluateOnNewDocument((t) => localStorage.setItem('admin_token', t), token);
  await page2.goto('http://localhost:3000/admin/learn-more-standalone.html?tab=publications', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2000));

  const r4 = await page2.evaluate(async () => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('从原站导入'));
    if (!b) return { importBtn: false };
    b.click();
    await new Promise((r) => setTimeout(r, 500));
    const m = document.querySelector('.modal');
    const mt = m ? m.textContent : '';
    // 关闭（点 ✕）
    const close = [...document.querySelectorAll('.modal button')].find((x) => x.textContent.trim() === '✕');
    if (close) close.click();
    await new Promise((r) => setTimeout(r, 300));
    const eb = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '编辑');
    if (eb) eb.click();
    await new Promise((r) => setTimeout(r, 800));
    return {
      importBtn: true,
      hasPages: mt.includes('抓取页数'),
      hint: mt.includes('入文档资源'),
      pdfSel: [...document.querySelectorAll('select')].some((s) => s.textContent.includes('从文档资源选择')),
      pdfUpload: [...document.querySelectorAll('button')].some((x) => x.textContent.includes('上传新 PDF')),
    };
  });
  console.log('learn-more publications:', JSON.stringify(r4));

  const allErrs = errs.concat(errs2).filter((e) => e.indexOf('favicon') < 0);
  console.log('JS错误:', allErrs.length ? allErrs.join(' | ') : '无');
  await browser.close();
})();
