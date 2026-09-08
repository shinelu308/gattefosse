// 渲染本地 news-detail.html?id=486 与原站同 slug 新闻，截图 + 抓取关键样式对比
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outDir = path.join(__dirname, 'shot-render-sync');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  const targets = [
    { name: 'local', url: 'http://localhost:3000/news-detail.html?id=486' },
    { name: 'origin', url: 'https://www.gattefosse.com/news/gattefosse-launches-preservative-free-version-gatuline-link-n-lift' },
  ];

  const report = {};
  for (const t of targets) {
    try {
      await page.goto(t.url, { waitUntil: 'networkidle2', timeout: 45000 });
      await new Promise(r => setTimeout(r, 2500));
      await page.screenshot({ path: path.join(outDir, t.name + '.png'), fullPage: true });
      report[t.name] = await page.evaluate(() => {
        function pick(sel, props) {
          const el = document.querySelector(sel);
          if (!el) return null;
          const cs = getComputedStyle(el);
          const o = {};
          props.forEach(p => o[p] = cs[p]);
          return o;
        }
        const linkProps = ['color', 'textDecorationLine', 'fontSize', 'fontWeight'];
        return {
          h1: pick('.s-article__title, .page-title', ['fontSize', 'fontWeight', 'color']),
          firstLink: pick('.node__content p a, .node__content .text-formatted a, .node__content li a, .node__content h5 a', linkProps),
          linkInH5: pick('.node__content h5 a', linkProps),
          strongInLink: pick('.node__content a strong, .node__content a b', ['color']),
          encadre: pick('.paragraph--type--texte-encadre', ['borderTopWidth', 'borderBottomWidth', 'borderTopColor', 'borderBottomColor', 'padding', 'margin', 'backgroundColor']),
          hrCount: document.querySelectorAll('.node__content hr').length,
          // 找出 node__content 里所有带可见上下边框的元素
          bordered: (() => {
            const out = [];
            document.querySelectorAll('.node__content, .node__content *').forEach(el => {
              const cs = getComputedStyle(el);
              const bt = parseFloat(cs.borderTopWidth), bb = parseFloat(cs.borderBottomWidth);
              if ((bt > 0 || bb > 0) && el.offsetParent !== null) {
                out.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 80), bt, bb, color: cs.borderTopColor });
              }
            });
            return out.slice(0, 12);
          })(),
        };
      });
    } catch (e) {
      report[t.name] = { error: String(e).slice(0, 200) };
    }
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})();
