/**
 * 第 3 层：渲染级视觉回归对比工具
 * 用法：
 *   node scripts/compare-article.js <本站URL> <原站URL> [输出目录]
 * 示例：
 *   node scripts/compare-article.js "http://localhost:3000/personal-care-article-detail.html?id=503" "https://www.gattefosse.com/personal-care/get-inspired/xxx" admin/outputs
 * 输出：
 *   compare-<时间戳>/ours.png / origin.png 双页截图 + 对比报告（控制台 + report.json）
 * 对比维度：标题/h2/h3/正文段落/导语/链接/按钮 的字体族、字号、行高、字重、颜色、下划线、背景；
 * 段落数量与结构级差异。
 * ⚠️ 2026-09-09 修复：选择器改为「本站/原站」双套——.adp-content 是本站独有类名，原站采不到样，
 *    旧版对 h2/h3/段落/链接的对比实际是空的（只比到 h1/导语），药用文章主题色差未被发现。
 * ⚠️ 主题色系：个护 theme-cosm 品红系 / 药用 theme-pharma 蓝系，对比取双方实测值，天然支持主题分档。
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
].filter(Boolean);
const CHROME = CHROME_PATHS.find(p => fs.existsSync(p));

const OURS_URL = process.argv[2];
const ORIGIN_URL = process.argv[3];
const OUT_DIR = process.argv[4] || path.join(__dirname, '..', 'admin', 'outputs', 'compare-' + Date.now());

if (!OURS_URL || !ORIGIN_URL) {
  console.error('用法: node scripts/compare-article.js <本站URL> <原站URL> [输出目录]');
  process.exit(1);
}
if (!CHROME) {
  console.error('未找到 Chrome，请确认已安装 Google Chrome');
  process.exit(1);
}

/** 提取指定选择器元素的计算样式（页面内执行） */
const COLLECT_FN = (selectors) => {
  const result = {};
  for (const sel of selectors) {
    const els = [...document.querySelectorAll(sel)].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.textContent.trim();
    });
    result[sel] = els.slice(0, 6).map(el => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        text: el.textContent.trim().slice(0, 40),
        fontFamily: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        color: cs.color,
        textDecorationLine: cs.textDecorationLine,
        backgroundColor: cs.backgroundColor,
        width: Math.round(r.width),
      };
    });
  }
  return result;
};

/** 对比项：本站与原站选择器成对（原站无 .adp-content，用 .node__content 等价物） */
const SELECTOR_PAIRS = [
  { name: 'h1', ours: '.s-article__title', origin: '.s-article__title' },
  { name: 'h2', ours: '.s-article .adp-content h2', origin: '.node__content h2' },
  { name: 'h3', ours: '.s-article .adp-content h3', origin: '.node__content h3' },
  { name: 'lead', ours: '.block-accroche', origin: '.block-accroche' },
  { name: 'para', ours: '.s-article .adp-content p', origin: '.node__content p' },
  { name: 'link', ours: '.s-article .adp-content p a', origin: '.node__content p a' },
  { name: 'cta', ours: '.s-article .adp-content .paragraph--type--bouton-cta a', origin: '.node__content .paragraph--type--bouton-cta a' },
];

function fmtColor(c) {
  // rgb(a, b, c[, d]) → 归一化便于比对
  const m = /rgba?\(([^)]+)\)/.exec(c || '');
  if (!m) return c;
  return m[1].split(',').map(s => parseFloat(s.trim())).slice(0, 3).join(',');
}

function compareStyles(ours, origin) {
  const diffs = [];
  for (const pair of SELECTOR_PAIRS) {
    const sel = pair.name;
    const a = ours[sel] || [];
    const b = origin[sel] || [];
    if (a.length !== b.length && (sel === 'h1' || sel === 'h2' || sel === 'h3')) {
      diffs.push({ sel, kind: '数量不一致', detail: `本站 ${a.length} 个 / 原站 ${b.length} 个` });
    }
    const n = Math.min(a.length, b.length);
    if (!n && (sel === 'h1' || sel === 'h2')) {
      diffs.push({ sel, kind: '采样为空', detail: `本站 ${a.length} 个 / 原站 ${b.length} 个（选择器未命中，需检查）` });
    }
    for (let i = 0; i < n; i++) {
      const keys = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'textDecorationLine', 'backgroundColor'];
      for (const k of keys) {
        let va = a[i][k], vb = b[i][k];
        if (k === 'color' || k === 'backgroundColor') { va = fmtColor(va); vb = fmtColor(vb); }
        if (k === 'lineHeight') {
          const na = parseFloat(va), nb = parseFloat(vb);
          if (!isNaN(na) && !isNaN(nb)) { va = na.toFixed(1); vb = nb.toFixed(1); }
        }
        if (k === 'fontFamily') {
          // 字体族归一：中文回退字体差异忽略，只比主族
          va = (va || '').toLowerCase().split(' ').slice(0, 2).join(' ');
          vb = (vb || '').toLowerCase().split(' ').slice(0, 2).join(' ');
        }
        if (va !== vb) {
          diffs.push({ sel, kind: k, detail: `第${i + 1}个「${a[i].text}…」本站 ${va} vs 原站 ${vb}` });
        }
      }
    }
  }
  return diffs;
}

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,1000', '--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  const shoot = async (url, file, side) => {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: false });
    const sels = SELECTOR_PAIRS.map(p => p[side]);
    const raw = await page.evaluate(COLLECT_FN, sels);
    // 按 pair.name 归并
    const out = {};
    for (const p of SELECTOR_PAIRS) out[p.name] = raw[p[side]] || [];
    return out;
  };

  console.log('📸 截图并采集本站样式:', OURS_URL);
  const ours = await shoot(OURS_URL, 'ours.png', 'ours');
  console.log('📸 截图并采集原站样式:', ORIGIN_URL);
  const origin = await shoot(ORIGIN_URL, 'origin.png', 'origin');
  await browser.close();

  const diffs = compareStyles(ours, origin);
  const report = { oursUrl: OURS_URL, originUrl: ORIGIN_URL, time: new Date().toISOString(), diffs, ours, origin };
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

  if (!diffs.length) {
    console.log('✅ 渲染级对比通过：无样式差异');
  } else {
    console.log(`❌ 发现 ${diffs.length} 处渲染差异：`);
    for (const d of diffs) console.log(`  · [${d.sel}] ${d.kind}: ${d.detail}`);
  }
  console.log('报告与截图目录:', OUT_DIR);
  process.exit(diffs.length ? 2 : 0);
})().catch(e => { console.error('对比失败:', e.message); process.exit(1); });
