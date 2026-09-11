/** 精简验证：真实 page.mouse 点击视频封面层是否弹浮层（修复后点击不再被 YouTube iframe 吞） */
const puppeteer = require('puppeteer-core');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const CHROME = 'C:\\Users\\Shine Lu\\.cache\\puppeteer\\chrome\\win64-148.0.7778.97\\chrome-win64\\chrome.exe';
const TOKEN = jwt.sign({ id: 1, username: 'click-smoke', role: 'super_admin' }, 'Gattefosse_JWT_Secret_Key_2026_Change_In_Production', { expiresIn: '10m' });

(async () => {
  const original = (await p.newsEvent.findUnique({ where: { id: 9013 }, select: { contentHtml: true } })).contentHtml;
  fs.writeFileSync(path.resolve(__dirname, 'tmp-9013-bak2.html'), original);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-proxy-server'], defaultViewport: { width: 1440, height: 950 } });
  const page = await browser.newPage();
  page.on('dialog', async d => { await d.dismiss(); });

  await page.goto('http://localhost:3000/admin/index.html', { waitUntil: 'networkidle2' });
  await page.evaluate((t) => { localStorage.setItem('admin_token', t); }, TOKEN);
  await page.goto('http://localhost:3000/admin/index.html?t=' + Date.now(), { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('a, .menu-item, div, span, li'));
    const el = items.find(x => x.textContent.trim() === '文章');
    if (el) el.click();
  });
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('Haute Couture'));
    const btn = row && Array.from(row.querySelectorAll('button, a')).find(b => /编辑/.test(b.textContent));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 3000));

  const frame = page.frames().find(f => f !== page.mainFrame() && f.url().startsWith('blob:'));
  if (!frame) { console.log('❌ 预览 iframe 未加载'); await browser.close(); process.exit(1); }

  // 真实坐标点击封面层：先滚动到视频可见（真实用户行为），再换算主视口坐标点击
  await frame.evaluate(() => document.querySelector('.cp-video-cover').scrollIntoView({ block: 'center' }));
  await new Promise(r => setTimeout(r, 500));
  const iframeBox = await (await page.$('#article-preview-iframe')).boundingBox();
  const coverRect = await frame.evaluate(() => {
    const r = document.querySelector('.cp-video-cover').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  console.log('iframe 在主视口:', JSON.stringify(iframeBox), '| 封面层在 iframe 视口:', JSON.stringify(coverRect));
  if (!iframeBox || !coverRect) { console.log('❌ 拿不到坐标'); await browser.close(); process.exit(1); }
  const clickX = iframeBox.x + coverRect.x + coverRect.w / 2;
  const clickY = iframeBox.y + coverRect.y + coverRect.h / 2;
  console.log('真实点击主视口坐标:', Math.round(clickX), Math.round(clickY));
  await page.mouse.click(clickX, clickY);
  await new Promise(r => setTimeout(r, 800));

  const pop = await frame.evaluate(() => {
    const el = document.querySelector('.cp-pop input[type="text"]');
    return el ? { hasPop: true, value: el.value.slice(0, 60) } : { hasPop: false };
  });
  console.log(pop.hasPop ? '✅ 真实点击封面层弹出视频编辑浮层 | 当前链接: ' + pop.value : '❌ 真实点击未弹出浮层');
  await page.screenshot({ path: path.resolve(__dirname, 'real-click-video.png') });

  await browser.close();
  // 回滚（本轮无写库操作，仅保险确认）
  const after = await p.newsEvent.findUnique({ where: { id: 9013 }, select: { contentHtml: true } });
  console.log('库未被写:', after.contentHtml === original ? '✅' : '⚠️ 有变化');
  fs.rmSync(path.resolve(__dirname, 'tmp-9013-bak2.html'), { force: true });
  process.exit(pop.hasPop ? 0 : 1);
})();
