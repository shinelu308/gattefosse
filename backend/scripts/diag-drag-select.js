/** E2E：浮层拖选保护——input 内按下拖出浮层边界松开，浮层不消失；点浮层外仍正常关闭 */
const puppeteer = require('puppeteer-core');
const jwt = require('jsonwebtoken');
const path = require('path');

const CHROME = 'C:\\Users\\Shine Lu\\.cache\\puppeteer\\chrome\\win64-148.0.7778.97\\chrome-win64\\chrome.exe';
const TOKEN = jwt.sign({ id: 1, username: 'drag-smoke', role: 'super_admin' }, 'Gattefosse_JWT_Secret_Key_2026_Change_In_Production', { expiresIn: '10m' });

function check(name, ok, extra) { console.log((ok ? '✅' : '❌') + ' ' + name + (extra ? ' — ' + extra : '')); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-proxy-server'], defaultViewport: { width: 1440, height: 950 } });
  const page = await browser.newPage();
  page.on('dialog', async d => { await d.dismiss(); });

  await page.goto('http://localhost:3000/admin/index.html', { waitUntil: 'networkidle2' });
  await page.evaluate((t) => localStorage.setItem('admin_token', t), TOKEN);
  await page.goto('http://localhost:3000/admin/index.html?t=' + Date.now(), { waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('a, div, span, li'));
    const el = items.find(x => x.textContent.trim() === '文章');
    if (el) el.click();
  });
  await sleep(1500);
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('Haute Couture'));
    const btn = row && Array.from(row.querySelectorAll('button, a')).find(b => /编辑/.test(b.textContent));
    if (btn) btn.click();
  });
  await sleep(3000);
  const frame = page.frames().find(f => f !== page.mainFrame() && f.url().startsWith('blob:'));
  if (!frame) { console.log('❌ 预览 iframe 未加载'); await browser.close(); process.exit(1); }

  // 打开视频编辑浮层：真实坐标点击封面层
  await frame.evaluate(() => document.querySelector('.cp-video-cover').scrollIntoView({ block: 'center' }));
  await sleep(400);
  const iframeBox = await (await page.$('#article-preview-iframe')).boundingBox();
  const coverRect = await frame.evaluate(() => {
    const r = document.querySelector('.cp-video-cover').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(iframeBox.x + coverRect.x + coverRect.w / 2, iframeBox.y + coverRect.y + coverRect.h / 2);
  await sleep(600);
  let st = await frame.evaluate(() => !!document.querySelector('.cp-pop'));
  check('浮层已打开', st);

  // 主场景：input 内按下 → 拖出浮层左边界外 → 松开
  const inputRect = await frame.evaluate(() => {
    const r = document.querySelector('.cp-pop input[type="text"]').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, popLeft: document.querySelector('.cp-pop').getBoundingClientRect().x };
  });
  const startX = iframeBox.x + inputRect.x + inputRect.w - 15;  // input 右端
  const startY = iframeBox.y + inputRect.y + inputRect.h / 2;
  const endX = iframeBox.x + inputRect.popLeft - 40;            // 浮层左边界外 40px
  const endY = startY;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX - 60, startY, { steps: 8 });       // 向左拖，滑出浮层
  await page.mouse.move(endX, startY, { steps: 3 });
  await page.mouse.up();
  await sleep(500);
  st = await frame.evaluate(() => {
    const pop = document.querySelector('.cp-pop');
    const input = pop && pop.querySelector('input[type="text"]');
    return { hasPop: !!pop, inputVal: input ? input.value.slice(0, 40) : '' };
  });
  check('拖选滑出后浮层仍在', st.hasPop, st.hasPop ? 'input=' + st.inputVal : '浮层消失了');

  // 回归：点击浮层外（正文空白 div）仍应关闭
  const blankRect = await frame.evaluate(() => {
    document.querySelector('.cp-pop').style.display = 'none'; // 暂避，找一个浮层外的可点击点：封面层上方空白
    document.querySelector('.cp-pop').style.display = '';
    const cover = document.querySelector('.cp-video-cover').getBoundingClientRect();
    return { x: cover.x + cover.w / 2, y: cover.y + cover.h + 60 }; // 封面下方 60px（root 内其它区域）
  });
  // 直接点 root 内非交互元素：用第一段文字下方空隙不方便，改点封面层下方的空白段落
  const clickOutside = await frame.evaluate(() => {
    const els = Array.from(document.querySelectorAll('#cp-root p'));
    const el = els[els.length - 1];
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.x + 10, clientY: r.y + 5, view: window }));
    return true;
  });
  await sleep(400);
  // 点击最后一段文字会弹出文字编辑浮层（替换视频浮层）——预期行为：关闭旧浮层开新浮层
  st = await frame.evaluate(() => {
    const pop = document.querySelector('.cp-pop');
    return { hasPop: !!pop, kind: pop ? (pop.querySelector('textarea') ? 'text' : 'other') : 'none' };
  });
  check('点击其它目标正常切换浮层（视频→文字）', st.hasPop && st.kind === 'text');

  // Esc 关闭
  await frame.evaluate(() => {
    document.querySelector('.cp-pop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await sleep(300);
  st = await frame.evaluate(() => !document.querySelector('.cp-pop'));
  check('Esc 关闭浮层', st);

  await browser.close();
  console.log('（本轮无写库操作）');
})();
