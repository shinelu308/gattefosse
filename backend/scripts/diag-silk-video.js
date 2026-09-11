/**
 * 快速验证：id=493 视频块补丁效果
 * ① 前台详情页 .video__container 内 iframe（youtube embed）渲染
 * ② 后台预览编辑 iframe 内视频封面覆盖层挂载
 */
const path = require('path');
const puppeteer = require('puppeteer-core');
const jwt = require('jsonwebtoken');

const CHROME = 'C:\\Users\\Shine Lu\\.cache\\puppeteer\\chrome\\win64-148.0.7778.97\\chrome-win64\\chrome.exe';
const TOKEN = jwt.sign({ id: 1, username: 'smoke', role: 'super_admin' }, 'Gattefosse_JWT_Secret_Key_2026_Change_In_Production', { expiresIn: '15m' });
const results = [];
function check(name, ok, extra) {
  results.push(ok);
  console.log((ok ? '✅' : '❌') + ' ' + name + (extra ? ' — ' + extra : ''));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-proxy-server', '--window-size=1440,1000'],
    defaultViewport: { width: 1440, height: 950 },
  });
  const page = await browser.newPage();
  page.on('dialog', async d => { await d.dismiss(); });

  // ① 前台详情页
  await page.goto('http://localhost:3000/personal-care-article-detail.html?id=493', { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(2500);
  const front = await page.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll('.video__container iframe, iframe.youtube_player'));
    return {
      count: iframes.length,
      srcs: iframes.map(f => f.getAttribute('src')),
      visible: iframes.map(f => { const r = f.getBoundingClientRect(); return r.width > 100 && r.height > 100; }),
    };
  });
  check('前台视频 iframe 渲染（' + front.count + ' 个）', front.count === 1, front.srcs.join(','));
  check('前台视频尺寸正常（16:9 可见）', front.visible.every(Boolean));
  await page.screenshot({ path: path.resolve(__dirname, 'silk-front-video.png'), fullPage: false });

  // ② 后台预览编辑
  await page.goto('http://localhost:3000/admin/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate((t) => { localStorage.setItem('admin_token', t); localStorage.setItem('admin_token_expires', String(Date.now() + 3600_000)); }, TOKEN);
  await page.goto('http://localhost:3000/admin/index.html?t=' + Date.now(), { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1500);
  // 进入文章列表 → 编辑 silk 文章
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('a, .menu-item, div, span, li'));
    const el = items.find(x => x.textContent.trim() === '文章' || x.textContent.trim() === '文章列表');
    if (el) el.click();
  });
  await sleep(1500);
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr'));
    const row = rows.find(r => /silk-inspired| Unlock the secrets/i.test(r.textContent));
    if (row) { const btn = Array.from(row.querySelectorAll('button, a')).find(b => /编辑/.test(b.textContent)); if (btn) btn.click(); }
  });
  await sleep(3000);
  const frame = page.frames().find(f => f !== page.mainFrame() && f.url().startsWith('blob:'));
  check('后台预览 iframe 加载', !!frame);
  if (frame) {
    await sleep(2000);
    const inner = await frame.evaluate(() => ({
      embeds: Array.from(document.querySelectorAll('#cp-root iframe.youtube_player')).map(f => f.getAttribute('src')),
      covers: document.querySelectorAll('.cp-video-cover').length,
    }));
    check('预览内 embed 存在', inner.embeds.length === 1, inner.embeds.join(','));
    check('预览视频封面覆盖层挂载', inner.covers >= 1, 'covers=' + inner.covers);
  }
  await page.screenshot({ path: path.resolve(__dirname, 'silk-admin-preview.png') });

  await browser.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n=== ${pass}/${results.length} 通过 ===`);
  process.exit(pass === results.length ? 0 : 1);
})();
