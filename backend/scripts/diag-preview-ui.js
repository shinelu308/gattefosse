/**
 * UI E2E：后台预览式原位编辑（puppeteer-core + 本机缓存 Chromium）
 * 流程：注入 admin_token → 进入文章编辑（id=9013）→ 验证预览模式 → 改文字/改视频 → 保存 → 校验落库 → 回滚
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('puppeteer-core' === 'x' ? {} : '@prisma/client');
const p = new PrismaClient();

const CHROME = 'C:\\Users\\Shine Lu\\.cache\\puppeteer\\chrome\\win64-148.0.7778.97\\chrome-win64\\chrome.exe';
const TOKEN = jwt.sign({ id: 1, username: 'preview-smoke', role: 'super_admin' }, 'Gattefosse_JWT_Secret_Key_2026_Change_In_Production', { expiresIn: '15m' });
const URL_BASE = 'http://localhost:3000/admin/index.html?t=' + Date.now();
const SHOT = (n) => path.resolve(__dirname, `preview-ui-${n}.png`);

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra: extra || '' });
  console.log((ok ? '✅' : '❌') + ' ' + name + (extra ? ' — ' + extra : ''));
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const original = (await p.newsEvent.findUnique({ where: { id: 9013 }, select: { contentHtml: true } })).contentHtml;
  fs.writeFileSync(path.resolve(__dirname, 'tmp-9013-backup.html'), original);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-proxy-server', '--window-size=1440,1000'],
    defaultViewport: { width: 1440, height: 950 },
  });
  const page = await browser.newPage();
  page.on('dialog', async d => { await d.dismiss(); }); // 自动关弹窗
  page.on('console', m => { const t = m.text(); if (!/prisma|DevTools/.test(t)) console.log('[console:' + m.type() + ']', t.slice(0, 220)); });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
  page.on('requestfailed', r => console.log('[requestfailed]', r.url().slice(0, 110), r.failure() && r.failure().errorText));

  try {
    // 1. 注入 token 并登录
    await page.goto('http://localhost:3000/admin/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.evaluate((t) => { localStorage.setItem('admin_token', t); localStorage.setItem('admin_token_expires', String(Date.now() + 3600_000)); }, TOKEN);
    await page.goto(URL_BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(1500);
    check('后台登录态注入', await page.evaluate(() => !!localStorage.getItem('admin_token')));

    // 2. 菜单：新闻与活动 → 文章
    const clickedMenu = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('a, .menu-item, [class*="nav"], div, span, li'));
      const el = items.find(x => x.textContent.trim() === '文章' || x.textContent.trim() === '文章列表');
      if (el) { el.click(); return el.textContent.trim(); }
      return null;
    });
    check('进入文章列表', !!clickedMenu, clickedMenu || '未找到菜单项');
    await sleep(1500);

    // 3. 找到 Haute Couture 行并点编辑
    const clickedEdit = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const row = rows.find(r => r.textContent.includes('Haute Couture'));
      if (!row) return null;
      const btn = Array.from(row.querySelectorAll('button, a')).find(b => /编辑/.test(b.textContent));
      if (btn) { btn.click(); return true; }
      return null;
    });
    if (!clickedEdit) {
      // 列表可能分页，直接用 Vue 方法兜底（一页式布局暴露不到 window 就失败）
      const viaVue = await page.evaluate(async () => {
        const app = document.querySelector('#app').__vue_app__;
        // Vue3：从组件树找 methods（后备方案，直接 fetch 数据后调 editArticle 不可达，改为跳过）
        return null;
      });
    }
    check('点击编辑按钮', !!clickedEdit);
    await sleep(2000);

    // 4. 验证预览编辑模式激活
    const modeInfo = await page.evaluate(() => {
      const iframe = document.getElementById('article-preview-iframe');
      return {
        previewVisible: !!iframe && iframe.offsetParent !== null,
        locked: !!document.querySelector('.card-body') && document.body.innerHTML.includes('预览编辑'),
      };
    });
    check('预览编辑模式已激活（锁定文章默认进入）', modeInfo.previewVisible);

    // 5. 等 iframe 加载完成，检查内部结构
    await sleep(3000);
    const frame = page.frames().find(f => f !== page.mainFrame() && f.url().startsWith('blob:'));
    check('预览 iframe 加载', !!frame, frame ? frame.url().slice(0, 40) : '未找到 blob frame');
    if (!frame) throw new Error('预览 iframe 未加载');

    const inner = await frame.evaluate(() => ({
      hasRoot: !!document.getElementById('cp-root'),
      hasVideo: !!document.querySelector('#cp-root iframe.youtube_player'),
      imgCount: document.querySelectorAll('#cp-root img').length,
      scriptLoaded: !!window.__cpPreviewActive,
      scripts: Array.from(document.scripts).map(s => s.src),
    }));
    console.log('[debug] iframe scripts =', JSON.stringify(inner.scripts));
    check('预览内 #cp-root 渲染', inner.hasRoot);
    check('预览内 YouTube 视频块', inner.hasVideo);
    check('预览内图片 ' + inner.imgCount + ' 张', inner.imgCount > 0);
    check('预览编辑脚本已激活', inner.scriptLoaded);
    await page.screenshot({ path: SHOT('1-preview-loaded') });

    // 6. 点击正文文字 → 浮层出现 → 修改 → 确定
    const textHandle = await frame.evaluateHandle(() => {
      const walker = document.createTreeWalker(document.getElementById('cp-root'), NodeFilter.SHOW_TEXT);
      let n; while ((n = walker.nextNode())) { if (n.nodeValue.trim().length > 40) return n.parentNode; }
      return null;
    });
    const textEl = textHandle.asElement();
    check('找到可编辑文本段落', !!textEl);
    if (textEl) {
      // frame 内合成点击（真实坐标事件，含 clientX/Y 供 caretRangeFromPoint 定位）
      await frame.evaluate(() => {
        const walker = document.createTreeWalker(document.getElementById('cp-root'), NodeFilter.SHOW_TEXT);
        let n; while ((n = walker.nextNode())) { if (n.nodeValue.trim().length > 40) break; }
        const el = n.parentNode;
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.x + Math.min(r.width / 2, 200), clientY: r.y + Math.min(r.height / 2, 20), view: window }));
      });
      await sleep(600);
      let popInfo = await frame.evaluate(() => ({ hasPop: !!document.querySelector('.cp-pop'), hasTextarea: !!document.querySelector('.cp-pop textarea') }));
      check('点击文字弹出编辑浮层', popInfo.hasPop && popInfo.hasTextarea);
      await page.screenshot({ path: SHOT('2-text-pop') });
      if (popInfo.hasTextarea) {
        await frame.evaluate(() => {
          const ta = document.querySelector('.cp-pop textarea');
          ta.value = '【UI冒烟】' + ta.value;
        });
        await frame.click('.cp-pop .cp-ok');
        await sleep(800);
        // 父页面 patch 数
        const patchCount = await page.evaluate(() => {
          // 从按钮状态读：保存按钮 disabled 已解除 + 「已修改 N 处」文案
          const m = document.body.innerHTML.match(/已修改 (\d+) 处/);
          return m ? parseInt(m[1], 10) : 0;
        });
        check('文字补丁已记录（已修改 ' + patchCount + ' 处）', patchCount >= 1);
      }
    }

    // 7. 点击视频封面层（真实点击不再被 YouTube iframe 吞事件）→ 浮层 → 改链接
    const coverInfo = await frame.evaluate(() => {
      const cover = document.querySelector('.cp-video-cover');
      return { exists: !!cover, hasImg: !!(cover && cover.querySelector('img')) };
    });
    check('视频封面覆盖层已挂载', coverInfo.exists && coverInfo.hasImg);
    const videoEl2 = await frame.evaluateHandle(() => document.querySelector('#cp-root iframe.youtube_player'));
    const videoEl = videoEl2.asElement();
    check('找到视频块', !!videoEl);
    if (videoEl) {
      // 模拟真实用户点击封面层（blob frame 内合成事件，含坐标）
      await frame.evaluate(() => {
        const el = document.querySelector('.cp-video-cover');
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window }));
      });
      await sleep(600);
      const hasVideoPop = await frame.evaluate(() => !!document.querySelector('.cp-pop input[type="text"]'));
      check('点击视频弹出链接浮层', hasVideoPop);
      await page.screenshot({ path: SHOT('3-video-pop') });
      if (hasVideoPop) {
        await frame.evaluate(() => { document.querySelector('.cp-pop input[type="text"]').value = 'https://www.youtube.com/watch?v=UIsmoke99999'; });
        await frame.click('.cp-pop .cp-ok');
        await sleep(800);
        const patchCount2 = await page.evaluate(() => {
          const m = document.body.innerHTML.match(/已修改 (\d+) 处/);
          return m ? parseInt(m[1], 10) : 0;
        });
        check('视频补丁已记录（共 ' + patchCount2 + ' 处）', patchCount2 >= 2);
      }
    }

    // 8. 保存修改 → 落库
    const saveClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(x => x.textContent.trim() === '保存修改');
      if (b && !b.disabled) { b.click(); return true; }
      return false;
    });
    check('点击保存修改', saveClicked);
    await sleep(3000);
    const saved = await p.newsEvent.findUnique({ where: { id: 9013 }, select: { contentHtml: true } });
    check('文本修改已落库', saved.contentHtml.includes('【UI冒烟】'));
    check('视频修改已落库', saved.contentHtml.includes('UIsmoke99999'));
    check('版式标记完好（class 数不变）', (saved.contentHtml.match(/class="/g) || []).length === (original.match(/class="/g) || []).length);
    await page.screenshot({ path: SHOT('4-saved') });

    // 9. 回滚
    await p.newsEvent.update({ where: { id: 9013 }, data: { contentHtml: original } });
    const rolled = await p.newsEvent.findUnique({ where: { id: 9013 }, select: { contentHtml: true } });
    check('回滚完成', rolled.contentHtml === original);
  } catch (e) {
    check('流程异常', false, e.message);
    try { await page.screenshot({ path: SHOT('0-error') }); } catch (e2) {}
  } finally {
    await browser.close();
    const failCount = results.filter(r => !r.ok).length;
    console.log('\n=== 结果汇总: ' + (results.length - failCount) + '/' + results.length + ' 通过 ===');
    if (failCount === 0) {
      fs.rmSync(path.resolve(__dirname, 'tmp-9013-backup.html'), { force: true });
    }
    process.exit(failCount ? 1 : 0);
  }
})();
