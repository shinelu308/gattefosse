/**
 * 后台「数字营销产线 · 四机位」移动端验证（本地/线上通用）
 *
 * 用法：
 *   BASE=http://127.0.0.1:3000 node scripts/verify-admin-mobile-robots.js
 *   BASE=https://gattefosse.loudaren.com TOKEN=<线上铸的 token> node scripts/verify-admin-mobile-robots.js
 *
 * 需要：NODE_PATH 指向托管 node_modules（本机只装了 puppeteer-core）
 *       CHROME_PATH 指向 chrome.exe
 * 不传 TOKEN 时用本地 .env 的 JWT_SECRET 自铸（仅对本地库有效）
 */
const fs = require('fs');
const path = require('path');

const ROOT = 'D://workbuddy//gattefosse';
const OUT = path.join(ROOT, 'admin/outputs');
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const puppeteer = require('puppeteer-core');

function localToken() {
  const jwt = require('jsonwebtoken');
  const { PrismaClient } = require('@prisma/client');
  const env = fs.readFileSync(path.join(ROOT, 'backend/.env'), 'utf8');
  const secret = env.match(/^\s*JWT_SECRET\s*=\s*(.+)$/m)[1].trim().replace(/^["']|["']$/g, '');
  const prisma = new PrismaClient();
  return prisma.user.findFirst({ where: { role: 'super_admin' } }).then((u) => {
    const t = jwt.sign({ userId: u.id, email: u.email, role: u.role }, secret, { expiresIn: '2h' });
    return prisma.$disconnect().then(() => t);
  });
}

(async () => {
  const token = process.env.TOKEN || (await localToken());
  const tag = new URL(BASE).host.replace(/[^a-z0-9]/gi, '-');

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    headless: true,
    args: ['--no-proxy-server', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
    userDataDir: path.join(process.env.TEMP || '/tmp', 'pptr-verify-robots'),
  });

  for (const dev of [
    { name: 'iphone', vp: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
    { name: 'desktop', vp: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false }, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36' },
  ]) {
    const page = await browser.newPage();
    await page.emulate({ viewport: dev.vp, userAgent: dev.ua });
    await page.goto(BASE + '/admin/', { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.evaluate((t) => localStorage.setItem('admin_token', t), token);
    await page.reload({ waitUntil: 'networkidle2', timeout: 40000 });
    await new Promise((r) => setTimeout(r, 6000));

    const info = await page.evaluate(() => {
      const card = document.querySelector('.pl-card');
      if (card) card.scrollIntoView({ block: 'center' });
      const grid = document.querySelector('.pl-cols');
      if (!grid) return { error: 'no .pl-cols' };
      return {
        gridCols: getComputedStyle(grid).gridTemplateColumns,
        cardH: Math.round(card.getBoundingClientRect().height),
        cols: [...document.querySelectorAll('.pl-col')].map((c, i) => {
          const r = c.getBoundingClientRect();
          return { i, left: Math.round(r.left), right: Math.round(r.right), inViewX: r.left >= -1 && r.right <= window.innerWidth + 1 };
        }),
        videos: [...document.querySelectorAll('.pl-cols video')].map((v) => ({
          src: (v.getAttribute('src') || '').split('/').pop(),
          mutedProp: v.muted, paused: v.paused, readyState: v.readyState,
          playsinline: v.getAttribute('webkit-playsinline') !== null,
          poster: (v.getAttribute('poster') || '').split('/').pop(),
        })),
      };
    });
    await new Promise((r) => setTimeout(r, 800));
    const cardEl = await page.$('.pl-card');
    const f = path.join(OUT, 'robot-2x2-' + tag + '-' + dev.name + '.png');
    if (cardEl) await cardEl.screenshot({ path: f });

    console.log('== ' + tag + ' / ' + dev.name + ' ==');
    if (info.error) { console.log('ERROR ' + info.error); }
    else {
      console.log('grid: ' + info.gridCols + ' | 卡片高 ' + info.cardH + 'px');
      console.log('四格横向全可见: ' + info.cols.every((c) => c.inViewX));
      console.log(JSON.stringify(info.cols));
      const ok = info.videos.every((v) => v.mutedProp && !v.paused && v.readyState === 4);
      console.log('全部 muted+播放+就绪: ' + ok);
      console.log(JSON.stringify(info.videos));
    }
    console.log('shot: ' + f);
    await page.close();
  }

  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
