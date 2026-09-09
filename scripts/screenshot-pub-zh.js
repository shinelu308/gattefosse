const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1440,2400'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 2200 });

  const shots = [
    { url: 'http://localhost:3000/personal-care/get-inspired/publications.html', name: 'pub-pc-zh' },
    { url: 'http://localhost:3000/pharmaceuticals/learn-more/publications.html', name: 'pub-pharma-zh' },
  ];

  for (const s of shots) {
    await page.goto(s.url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));
    // 找中文验证条目卡片
    const found = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.c-card')];
      const zh = cards.find(c => /蜡酯|Gelucire/.test(c.textContent));
      if (!zh) return null;
      const title = zh.querySelector('.c-card__title')?.textContent.trim();
      const btn = zh.querySelector('.c-card__cta a')?.textContent.trim().replace(/\s+/g, ' ');
      return { title, btn };
    });
    console.log(s.name, JSON.stringify(found, null, 2));
    // 截整页
    await page.screenshot({ path: `.workbuddy/${s.name}.png`, fullPage: false });
    // 单独截中文卡片
    const cardEl = await page.$('.c-card');
    const zhHandle = await page.evaluateHandle(() => {
      const cards = [...document.querySelectorAll('.c-card')];
      return cards.find(c => /蜡酯|Gelucire/.test(c.textContent)) || null;
    });
    if (zhHandle && zhHandle.asElement()) {
      await zhHandle.asElement().screenshot({ path: `.workbuddy/${s.name}-card.png` });
    }
  }

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error(e); process.exit(1); });
