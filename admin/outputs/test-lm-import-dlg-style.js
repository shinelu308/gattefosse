// 热点话题导入弹框样式冒烟：打开弹框 → 截图 + 核对基准样式值
const puppeteer = require('puppeteer-core');
(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 120)));
  await p.goto('http://localhost:3000/admin/learn-more-standalone.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  // 点「从原站导入」打开弹框
  await p.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('从原站导入'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 800));
  const r = await p.evaluate(() => {
    const pick = (sel, props) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); const o = {}; props.forEach(x => o[x] = cs[x]); return o; };
    const header = document.querySelector('.modal-header');
    const hint = document.querySelector('.modal .hint');
    const infoBox = document.querySelector('.modal-body > div:nth-of-type(2)');
    const footBtns = Array.from(document.querySelectorAll('.modal-footer .btn')).map(b => ({ t: b.textContent.trim(), cls: b.className.replace('btn ', '') }));
    return {
      modal: pick('.modal', ['width', 'borderRadius', 'boxShadow']),
      headerH3: header ? header.querySelector('h3').textContent.trim() : null,
      h3Style: header ? (() => { const cs = getComputedStyle(header.querySelector('h3')); return { fontSize: cs.fontSize, fontWeight: cs.fontWeight }; })() : null,
      headerBorder: header ? getComputedStyle(header).borderBottomWidth : null,
      hint: hint ? hint.textContent.trim() : null,
      placeholder: (document.querySelector('.modal input') || {}).placeholder,
      infoBox: infoBox ? (() => { const cs = getComputedStyle(infoBox); return { bg: cs.backgroundColor, border: cs.borderColor, fontSize: cs.fontSize, text: infoBox.textContent.trim().slice(0, 40) }; })() : null,
      footBtns,
    };
  });
  console.log(JSON.stringify(r, null, 1));
  console.log('页面错误:', errors.length ? errors : '无');
  await p.screenshot({ path: 'admin/outputs/shot-lm-import-dlg.png' });
  await b.close();
})();
