// 详情页诊断：BASE_URL + 渲染结果 + 控制台错误
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
const PORT = 9250;
const profile = path.join(os.tmpdir(), 'cdp-prof-' + Date.now());
const child = execFile(chrome, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--no-first-run', '--no-proxy-server', '--window-size=1400,2200', 'about:blank']);
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
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) return true; } catch (e) {}
    await sleep(500);
  }
  return false;
}

(async () => {
  if (!(await waitDebugPort(20000))) { console.error('debug port not ready'); process.exit(1); }
  const pages = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  const page = pages.find(p => p.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 100 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));
  let id = 0;
  const errors = [];
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      errors.push(m.params.args.map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ').substring(0, 200));
    }
  });
  await send(ws, ++id, 'Runtime.enable');
  await send(ws, ++id, 'Page.enable');
  await send(ws, ++id, 'Page.navigate', { url: 'https://gattefosse.loudaren.com/news-detail.html?id=482' });
  await sleep(9000);
  const dbg = await send(ws, ++id, 'Runtime.evaluate', {
    awaitPromise: true, returnByValue: true,
    expression: `(async () => {
      const out = {};
      out.baseUrl = (typeof GatteAPI !== 'undefined') ? GatteAPI.BASE_URL : 'GatteAPI undefined';
      // 手动加载 api.js 源码看内容
      const r = await fetch('/static/js/api.js?nocache=' + Math.random());
      out.apiJsLive = (await r.text()).match(/BASE_URL = ([^;]+);/)[1];
      // 再调一次 detail
      try {
        const r2 = await fetch('/api/news/482');
        const j2 = await r2.json();
        out.apiTitle = j2.data && j2.data.title ? j2.data.title.substring(0, 30) : 'no title';
      } catch (e) { out.apiTitle = 'ERR ' + e.message; }
      out.title = document.querySelector('.page-title') ? document.querySelector('.page-title').textContent.trim().substring(0, 40) : null;
      const span = document.querySelector('span[v-html]');
      out.contentLen = span ? span.innerHTML.length : -1;
      out.contentPreview = span ? span.textContent.trim().substring(0, 100) : null;
      return out;
    })()`,
  });
  console.log(JSON.stringify(dbg.result.value, null, 1));
  console.log('console errors:', JSON.stringify(errors.slice(0, 5)));
  const shot = await send(ws, ++id, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_detail_final.png', Buffer.from(shot.data, 'base64'));
  ws.close(); child.kill(); process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
