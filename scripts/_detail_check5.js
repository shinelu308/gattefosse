// 渲染线上详情页截图（带启动重试）
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const chrome = CHROME_PATHS.find(p => fs.existsSync(p));
const PORT = 9244;
const profile = path.join(os.tmpdir(), 'cdp-prof-' + Date.now());
const child = execFile(chrome, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--no-first-run', '--no-proxy-server', '--window-size=1400,2200', 'about:blank'], (err) => {
  if (err) console.error('chrome exited:', err.message);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function send(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const onMsg = (raw) => {
      const m = JSON.parse(raw);
      if (m.id === id) { ws.off('message', onMsg); m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result); }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function waitDebugPort(maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return true;
    } catch (e) { /* not ready */ }
    await sleep(500);
  }
  return false;
}

(async () => {
  const ready = await waitDebugPort(20000);
  if (!ready) { console.error('debug port never became ready'); process.exit(1); }
  const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = pages.find(p => p.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 100 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));
  let id = 0;
  await send(ws, ++id, 'Page.enable');
  await send(ws, ++id, 'Page.navigate', { url: 'https://gattefosse.loudaren.com/news-detail.html?id=482' });
  await sleep(8000);
  const info = await send(ws, ++id, 'Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const title = document.querySelector('.page-title');
      const contentSpan = document.querySelector('span[v-html]') || document.querySelector('.node__content-wrapper span');
      const imgs = [...document.querySelectorAll('img')].map(i => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 }));
      return {
        title: title ? title.textContent.trim() : null,
        contentLength: contentSpan ? contentSpan.innerHTML.length : -1,
        contentPreview: contentSpan ? contentSpan.textContent.trim().substring(0, 120) : null,
        images: imgs.slice(0, 6),
        bodyTextSample: document.body.innerText.replace(/\\s+/g, ' ').substring(0, 300),
      };
    })()`,
  });
  console.log(JSON.stringify(info.result.value, null, 1));
  const shot = await send(ws, ++id, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_detail_render.png', Buffer.from(shot.data, 'base64'));
  console.log('DONE');
  ws.close(); child.kill(); process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
