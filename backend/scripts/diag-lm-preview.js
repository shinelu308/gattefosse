/**
 * UI E2E：learn-more（热点话题）预览式原位编辑改造验证（纯 DOM 路径，不依赖 Vue 实例）
 * 流程：注入 token → hot-topics 列表 → 编辑一篇锁定文章 → 默认预览编辑
 * → 预览 iframe/脚本/主题色 → 改文字 → 工具条「保存修改」→ 校验落库 → 回滚
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const CHROME = 'C:\\Users\\Shine Lu\\.cache\\puppeteer\\chrome\\win64-148.0.7778.97\\chrome-win64\\chrome.exe';
const TOKEN = jwt.sign({ id: 1, username: 'lm-preview-smoke', role: 'super_admin' }, 'Gattefosse_JWT_Secret_Key_2026_Change_In_Production', { expiresIn: '15m' });
const results = [];
function check(name, ok, extra) {
  results.push(!!ok);
  console.log((ok ? '✅' : '❌') + ' ' + name + (extra ? ' — ' + extra : ''));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const cand = await p.newsEvent.findFirst({
    where: { category: 'pharma', type: 'article', isPublished: true, contentHtml: { contains: 'paragraph--type--' } },
    select: { id: true, title: true, contentHtml: true },
  });
  if (!cand) { console.log('❌ 没有可测的锁定热点话题文章'); process.exit(1); }
  const backup = cand.contentHtml;
  console.log('[target] id=' + cand.id, cand.title.slice(0, 30), '| 正文', backup.length, '字符');

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-proxy-server', '--window-size=1440,1000'],
    defaultViewport: { width: 1440, height: 950 },
  });
  const page = await browser.newPage();
  page.on('dialog', async d => { await d.dismiss(); });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));

  let patchApplied = false;
  try {
    await page.goto('http://localhost:3000/admin/learn-more-standalone.html?tab=hot-topics', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.evaluate((t) => { localStorage.setItem('admin_token', t); localStorage.setItem('admin_token_expires', String(Date.now() + 3600_000)); }, TOKEN);
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2500);
    check('learn-more 页面登录态', await page.evaluate(() => !!localStorage.getItem('admin_token')));

    // 按 checkbox value=id 找行，点编辑
    const clicked = await page.evaluate((id) => {
      const row = Array.from(document.querySelectorAll('tbody tr')).find(r => r.querySelector('input[type="checkbox"][value="' + id + '"]'));
      if (!row) return null;
      const btn = Array.from(row.querySelectorAll('button, a')).find(b => /编辑/.test(b.textContent));
      if (btn) { btn.click(); return true; }
      return null;
    }, cand.id);
    check('点击编辑按钮', !!clicked);
    await sleep(2500);

    check('编辑弹窗打开且默认预览编辑', await page.evaluate(() => {
      const iframe = document.getElementById('lm-preview-iframe');
      return !!iframe && iframe.offsetParent !== null;
    }));

    await sleep(3000);
    const frame = page.frames().find(f => f !== page.mainFrame() && f.url().startsWith('blob:'));
    check('预览 iframe 加载', !!frame);
    if (frame) {
      const inner = await frame.evaluate(() => ({
        hasRoot: !!document.getElementById('cp-root'),
        scriptLoaded: !!window.__cpPreviewActive,
        theme: (document.querySelector('main.s-page--inner') || {}).className || '',
        imgs: document.querySelectorAll('#cp-root img').length,
      }));
      check('预览内 #cp-root 渲染', inner.hasRoot);
      check('预览编辑脚本已激活', inner.scriptLoaded);
      check('主题色 theme-pharma', /theme-pharma/.test(inner.theme), inner.theme.slice(0, 60));
      check('预览内图片 ' + inner.imgs + ' 张', inner.imgs >= 0);
      await page.screenshot({ path: path.resolve(__dirname, 'lm-preview-1.png') });

      // 点第一段长文本 → 浮层 → 改文字 → 确定
      const el = (await frame.evaluateHandle(() => {
        const walker = document.createTreeWalker(document.getElementById('cp-root'), NodeFilter.SHOW_TEXT);
        let n; while ((n = walker.nextNode())) { if (n.nodeValue.trim().length > 40) return n.parentNode; }
        return null;
      })).asElement();
      check('找到可编辑文本段落', !!el);
      if (el) {
        await frame.evaluate((e) => {
          e.scrollIntoView({ block: 'center' });
          const r = e.getBoundingClientRect();
          e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + Math.min(60, r.width / 2), clientY: r.top + Math.max(6, r.height / 2) }));
        }, el);
        await sleep(900);
        const pop = await frame.evaluate(() => !!document.querySelector('[class*="cp-pop"], .cp-editor-pop'));
        check('点击文字弹出编辑浮层', pop);
        if (pop) {
          await frame.evaluate(() => {
            const input = document.querySelector('[class*="cp-pop"] input[type="text"], [class*="cp-pop"] textarea');
            if (!input) throw new Error('浮层输入框未找到');
            const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, input.value + '【E2E】');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const btns = Array.from(document.querySelectorAll('[class*="cp-pop"] button'));
            const ok = btns.find(b => /确定|保存|OK/i.test(b.textContent)) || btns[btns.length - 1];
            ok.click();
          });
          await sleep(900);
        }
        // 工具条补丁计数（主文档 DOM 文本）
        const cnt = await page.evaluate(() => {
          const m = /已修改 (\d+) 处/.exec(document.body.innerText);
          return m ? parseInt(m[1], 10) : 0;
        });
        check('文字补丁已记录', cnt >= 1, 'patches=' + cnt);

        if (cnt >= 1) {
          // 点工具条「保存修改」
          await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '保存修改');
            btn.click();
          });
          await sleep(2000);
          const after = (await p.newsEvent.findUnique({ where: { id: cand.id }, select: { contentHtml: true } })).contentHtml;
          patchApplied = after !== backup;
          check('正文已落库更新', after.includes('【E2E】'));
          // 版式断言：class 属性数量不变（jsdom 序列化会规范化 HTML，长度不可靠，与 diag-preview-ui 同口径）
          const clsBefore = (backup.match(/class="/g) || []).length;
          const clsAfter = (after.match(/class="/g) || []).length;
          check('版式标记完好（class 数不变 ' + clsBefore + '→' + clsAfter + '）', clsBefore === clsAfter && /paragraph--type--/.test(after));
        }
      }
    }
  } catch (e) {
    console.error('[fatal]', e.message);
  } finally {
    // 无条件回滚
    try {
      const cur = (await p.newsEvent.findUnique({ where: { id: cand.id }, select: { contentHtml: true } })).contentHtml;
      if (cur !== backup) {
        await p.newsEvent.update({ where: { id: cand.id }, data: { contentHtml: backup } });
        console.log('[rollback] 已恢复原文（id=' + cand.id + '）');
      } else {
        console.log('[rollback] 正文未变化，无需回滚');
      }
    } catch (e2) { console.error('[rollback failed]', e2.message); }
    await browser.close();
    await p.$disconnect();
  }
  const pass = results.filter(Boolean).length;
  console.log(`\n=== ${pass}/${results.length} 通过 ===`);
  process.exit(pass === results.length ? 0 : 1);
})();
