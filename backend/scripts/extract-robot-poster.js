/**
 * 从 4 个机器人 mp4 抽首帧 → admin/static/img/robots/<name>.png（480×480）
 * 用于 <video poster> 兜底：移动端未解码/未自动播放时仍有画面
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = 'D://workbuddy//gattefosse';
const OUT = path.join(ROOT, 'admin/static/img/robots');
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const NAMES = ['importer', 'translator', 'editor', 'publisher'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    headless: true,
    args: ['--no-proxy-server', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
    userDataDir: path.join(process.env.TEMP || '/tmp', 'pptr-poster'),
  });
  const page = await browser.newPage();
  await page.goto(BASE + '/admin/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  for (const n of NAMES) {
    const r = await page.evaluate(async (name) => {
      const v = document.createElement('video');
      v.src = '/admin/static/video/robots/' + name + '.mp4';
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.style.cssText = 'position:fixed;left:-9999px;top:0;width:480px;height:480px;';
      document.body.appendChild(v);
      await new Promise((res, rej) => {
        v.addEventListener('loadeddata', res, { once: true });
        v.addEventListener('error', () => rej(new Error('load error ' + name)), { once: true });
        setTimeout(() => rej(new Error('load timeout ' + name)), 20000);
      });
      v.pause();
      // 跳到 0.06s，避开纯黑/纯灰的第一帧
      v.currentTime = 0.06;
      await new Promise((res) => {
        v.addEventListener('seeked', res, { once: true });
        setTimeout(res, 2000);
      });
      const c = document.createElement('canvas');
      c.width = v.videoWidth || 480;
      c.height = v.videoHeight || 480;
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', 0.88);
      v.remove();
      return { w: c.width, h: c.height, data };
    }, n);
    const buf = Buffer.from(r.data.split(',')[1], 'base64');
    const f = path.join(OUT, n + '.jpg');
    fs.writeFileSync(f, buf);
    console.log(n.padEnd(11) + r.w + 'x' + r.h + '  ' + (buf.length / 1024).toFixed(1) + 'KB  -> ' + f);
  }

  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
