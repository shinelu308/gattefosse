// 完整模拟用户行为测试：新闻列表 → 详情页 → 返回列表
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
const PORT = 9260;
const profile = path.join(os.tmpdir(), 'cdp-prof-' + Date.now());
const child = execFile(chrome, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--no-first-run', '--window-size=1400,1600', 'about:blank']);
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
async function waitPort(maxMs) {
  const s = Date.now();
  while (Date.now() - s < maxMs) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) return true; } catch (e) {} await sleep(400); }
  return false;
}

(async () => {
  if (!(await waitPort(20000))) { console.error('port not ready'); process.exit(1); }
  const pages = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  const page = pages.find(p => p.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 100 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));
  let id = 0;
  const apiLog = [];
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response;
      if (r.url.includes('/api/news')) apiLog.push(r.status + ' ' + r.url.substring(0, 120));
    }
  });
  await send(ws, ++id, 'Runtime.enable');
  await send(ws, ++id, 'Network.enable');
  await send(ws, ++id, 'Page.enable');

  const snap = async (label) => {
    const r = await send(ws, ++id, 'Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const cards = [...document.querySelectorAll('.c-card__title-link')];
        return {
          baseUrl: (typeof GatteAPI !== 'undefined') ? GatteAPI.BASE_URL : 'undef',
          cardCount: cards.length,
          titles: cards.map(c => c.textContent.trim().substring(0, 30)),
          vCloakStill: !!document.querySelector('#app[v-cloak]'),
        };
      })()`,
    });
    console.log('[' + label + ']', JSON.stringify(r.result.value));
  };

  // 1. 新闻列表页
  await send(ws, ++id, 'Page.navigate', { url: 'https://gattefosse.loudaren.com/news.html' });
  await sleep(8000);
  await snap('列表页首次');

  // 2. 进入详情页
  await send(ws, ++id, 'Page.navigate', { url: 'https://gattefosse.loudaren.com/news-detail.html?id=482' });
  await sleep(8000);
  const detail = await send(ws, ++id, 'Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => ({
      baseUrl: (typeof GatteAPI !== 'undefined') ? GatteAPI.BASE_URL : 'undef',
      title: (document.querySelector('.page-title') || {}).textContent || '(无标题)',
      bodyHasZh: /[一-龥]/.test(document.body.innerText),
      vCloakStill: !!document.querySelector('#app[v-cloak]'),
    }))()`,
  });
  console.log('[详情页]', JSON.stringify(detail.result.value));

  // 3. 返回列表页（模拟点菜单）
  await send(ws, ++id, 'Page.navigate', { url: 'https://gattefosse.loudaren.com/news.html' });
  await sleep(8000);
  await snap('返回列表页');

  console.log('API 请求日志:', JSON.stringify(apiLog, null, 1));
  const shot = await send(ws, ++id, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_nav_test.png', Buffer.from(shot.data, 'base64'));
  ws.close(); child.kill(); process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
