const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 2400 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  // ===== PC 出版物页 =====
  await page.goto('http://localhost:3000/personal-care/get-inspired/publications.html?_t=' + Date.now(), { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  const pc = await page.evaluate(() => {
    const cards = document.querySelectorAll('.c-card--pub');
    const btn = document.querySelector('.c-card__cta a');
    const facetBtns = [...document.querySelectorAll('.facets-widget-links .btn')].map(a => a.textContent.trim());
    const accTitles = [...document.querySelectorAll('.facet-inactive .accordion-button')].map(b => b.textContent.trim());
    return { cards: cards.length, btnText: btn ? btn.textContent.trim() : null, facetBtns, accTitles };
  });
  console.log('PC页:', JSON.stringify(pc, null, 1));
  await page.screenshot({ path: 'E:/项目开发区/嘉法狮网站重建/.workbuddy/tmp-pc-pub.png', clip: { x: 0, y: 0, width: 1440, height: 1600 } });

  // PC 类型过滤链接跳转
  await page.goto('http://localhost:3000/personal-care/get-inspired/publications.html?publicationType=' + encodeURIComponent('海报') + '&_t=' + Date.now(), { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  const pcF = await page.evaluate(() => ({
    cards: document.querySelectorAll('.c-card--pub').length,
    active: document.querySelector('.facets-widget-links .is-active') ? document.querySelector('.facets-widget-links .is-active').textContent.trim() : null,
  }));
  console.log('PC类型过滤(海报):', JSON.stringify(pcF));

  // ===== 药用出版物页 =====
  await page.goto('http://localhost:3000/pharmaceuticals/learn-more/publications.html?_t=' + Date.now(), { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  const ph = await page.evaluate(() => {
    const cards = document.querySelectorAll('.c-card--pub');
    const btn = document.querySelector('.c-card__cta a');
    const facetBtns = [...document.querySelectorAll('.facets-widget-links .btn')].map(a => a.textContent.trim());
    const accTitles = [...document.querySelectorAll('.facet-inactive .accordion-button')].map(b => b.textContent.trim());
    return { cards: cards.length, btnText: btn ? btn.textContent.trim() : null, facetBtns, accTitles };
  });
  console.log('药用页:', JSON.stringify(ph, null, 1));
  await page.screenshot({ path: 'E:/项目开发区/嘉法狮网站重建/.workbuddy/tmp-ph-pub.png', clip: { x: 0, y: 0, width: 1440, height: 1600 } });

  // ===== 空态验证（过滤无结果） =====
  await page.goto('http://localhost:3000/personal-care/get-inspired/publications.html?tagId=' + encodeURIComponent('不存在的标签') + '&_t=' + Date.now(), { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  const empty = await page.evaluate(() => {
    const el = document.querySelector('.view-empty');
    return { emptyShown: !!el, text: el ? el.textContent.trim() : null, cards: document.querySelectorAll('.c-card--pub').length };
  });
  console.log('空态:', JSON.stringify(empty));

  console.log('JS错误:', errors.length ? errors.join('\n') : '无');
  await browser.close();
})();
