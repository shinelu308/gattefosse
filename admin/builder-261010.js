/**
 * 文章块搭建器（2026-10-10）
 * ================================================
 * 方案：docs/mockups/文章块搭建器-视觉方案-261010.html（方案 B，用户已批准）
 *
 * 职责（纯函数，无框架依赖）：
 *   GFBuilder.build(blocks)   块序列 → 官网原版式 HTML（paragraph--type--*），头部带 <!--gfbuilder:v1--> 标记
 *   GFBuilder.parse(html)     官网版式 HTML / Quill 纯 HTML → 块序列（用注入的 DOMParser；识别失败 ok:false 降级）
 *
 * 铁律：
 *   - 拼装 class 逐字对齐原站黄金样例（.workbuddy/tmp/builder-dev/golden-all.html），前台零新增 CSS
 *   - 后端 / 前台零改动：contentHtml 仍是唯一真相源
 *   - 链接白名单与 preview-inline / content-patch 保持一致：/站内路径、https:// 全址、#锚点
 *
 * 块模型（builderBlocks 元素）：
 *   { type:'heading',  level:'h2'|'h3'|'h4', text }
 *   { type:'paragraph', html }                      —— 统一拼 texte-encadre（原站 84 处主流形态）
 *   { type:'image',    url, alt }                   —— 单图；多图请用 gallery
 *   { type:'gallery',  frames:[{url,title,text,ctaText,ctaHref}] }   —— full-width-slider 轮播
 *   { type:'twocol',   ratio:'66'|'50', left:[seg], right:[seg] }    —— s-zone 分栏；seg={kind:'text',html}|{kind:'image',url,alt}|{kind:'raw',html}
 *   { type:'quote',    text, author }
 *   { type:'highlight', title, html }
 *   { type:'button',   text, href }
 *   { type:'video',    url }                        —— YouTube/B站/腾讯 → 自动转 embed
 *   { type:'files',    title, items:[{name,format,url}] }
 */
(function (global) {
  'use strict';

  var BUILD_MARK = '<!--gfbuilder:v1-->';
  // 与 backend/src/utils/content-patch.ts / preview-inline-*.js 逐字一致
  var LINK_HREF_RE = /^(?:\/(?!\/)[^\s"'<>\\]*|https?:\/\/[^\s"'<>\\]+|#[^\s"'<>\\]*)$/i;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function rid() { return 'gfb' + Math.random().toString(36).slice(2, 8); }
  function normText(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  function isValidHref(v) { var s = normText(v); return !!s && LINK_HREF_RE.test(s); }

  // ---- 视频地址 → embed 地址（仅放行 https 全址）----
  function toEmbedUrl(raw) {
    var s = normText(raw);
    if (!/^https:\/\//i.test(s)) return '';
    var m;
    if ((m = s.match(/^https:\/\/(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([\w-]{6,})/i))) return 'https://www.youtube.com/embed/' + m[1];
    if ((m = s.match(/^https:\/\/youtu\.be\/([\w-]{6,})/i))) return 'https://www.youtube.com/embed/' + m[1];
    if ((m = s.match(/^https:\/\/(?:www\.)?youtube\.com\/embed\/([\w-]{6,})/i))) return 'https://www.youtube.com/embed/' + m[1];
    if ((m = s.match(/^https:\/\/(?:www\.)?bilibili\.com\/video\/(BV[\w]{6,})/i))) return 'https://player.bilibili.com/player.html?bvid=' + m[1] + '&autoplay=0';
    return s; // 腾讯视频等已提供 iframe 地址的，原样放行
  }

  // ================= 拼 HTML（build） =================

  function buildHeading(b) {
    var lv = ['h2', 'h3', 'h4'].indexOf(b.level) >= 0 ? b.level : 'h2';
    var id = rid();
    return '<div class="paragraph paragraph--type--titre-' + lv + ' paragraph--view-mode--default" id="' + id + '">'
      + '<' + lv + ' id="' + id + 'h">' + esc(b.text) + '</' + lv + '></div>';
  }

  function buildParagraph(b) {
    return '<div class="paragraph paragraph--type--texte-encadre paragraph--view-mode--default" id="' + rid() + '">'
      + '<div class="clearfix text-formatted field field--name-field-texte-encadre field--type-text-long field--label-hidden field__item">' + (b.html || '') + '</div></div>';
  }

  function buildImage(b) {
    return '<div class="c-image c-image--landscape c-image--100 paragraph paragraph--type--image paragraph--view-mode--default" id="' + rid() + '">'
      + '<figure class="c-image__container image-container" role="group" aria-label="' + esc(b.alt || '') + '">'
      + '<img src="' + esc(b.url) + '" alt="' + esc(b.alt || '') + '" loading="lazy" class="img-100 img-fluid">'
      + '</figure></div>';
  }

  function buildSliderFrame(f, i) {
    var cta = '';
    if (f.ctaText && f.ctaHref && isValidHref(f.ctaHref)) {
      cta = '<div class="field field--name-field-link-cta field--type-link field--label-hidden"><a class="btn btn-primary" href="' + esc(f.ctaHref) + '" target="_self"><span>' + esc(f.ctaText) + '</span></a></div>';
    }
    return '<div class="field__item"><div class="paragraph paragraph--type--slider-content paragraph--view-mode--default" id="' + rid() + '">'
      + '<div class="paragraph--type--slider-content__image" style="background-image: url(' + esc(f.url) + ')"></div>'
      + '<div class="paragraph--type--slider-content__cont">'
      + '<h2 class="field--name-field-title">' + esc(f.title) + '</h2>'
      + '<div class="clearfix text-formatted field field--name-field-texte-encadre field--type-text-long field--label-hidden field__item">' + (f.text || '') + '</div>'
      + cta
      + '</div></div></div>';
  }

  function buildGallery(b) {
    var frames = (b.frames || []).filter(function (f) { return f && f.url; });
    if (!frames.length) return '';
    return '<div class="paragraph paragraph--type--full-width-slider paragraph--view-mode--default" id="' + rid() + '">'
      + '<div class="js-full-width-slider">' + frames.map(buildSliderFrame).join('') + '</div>'
      + '<div class="slick-controls">'
      + '<button type="button" aria-label="Previous" class="slick-prev js-slick-prev"></button>'
      + '<div class="slick-dots-wrapper js-slick-dots-wrapper"></div>'
      + '<button type="button" aria-label="Next" class="slick-next js-slick-next"></button>'
      + '</div></div>';
  }

  function buildSeg(seg) {
    if (!seg) return '';
    if (seg.kind === 'text') return buildParagraph({ html: seg.html });
    if (seg.kind === 'image') return buildImage({ url: seg.url, alt: seg.alt });
    return seg.html || ''; // raw：原站反解析出来的其他子块，原样往返
  }

  function buildTwocol(b) {
    var ratio = b.ratio === '50' ? '50' : (b.ratio === '33' ? '33' : '66');
    var lCls = 's-zone paragraph paragraph--zone-left paragraph--zone-' + ratio + ' paragraph--view-mode--default';
    var rNum = ratio === '50' ? '50' : (ratio === '33' ? '66' : '33');
    var rCls = 's-zone paragraph paragraph--zone-right paragraph--zone-' + rNum + ' paragraph--view-mode--default';
    var l = (b.left || []).map(buildSeg).join('');
    var r = (b.right || []).map(buildSeg).join('');
    if (!l && !r) return '';
    return '<div class="' + lCls + '" id="' + rid() + '">' + l + '</div>'
      + '<div class="' + rCls + '" id="' + rid() + '">' + r + '</div>';
  }

  function buildQuote(b) {
    var author = normText(b.author);
    return '<div class="paragraph paragraph--type--citation paragraph--view-mode--default" id="' + rid() + '">'
      + '<blockquote class="c-blockquote c-blockquote--full">'
      + '<div class="c-blockquote__body"><div class="c-blockquote__body-text"><p>' + (b.text || '') + '</p></div></div>'
      + '<footer class="c-blockquote__footer">' + (author ? '<span class="c-blockquote__author">' + esc(author) + '</span>' : '') + '</footer>'
      + '</blockquote></div>';
  }

  function buildHighlight(b) {
    return '<div class="paragraph paragraph--type--highlighted-block paragraph--view-mode--default" id="' + rid() + '">'
      + '<div class="c-highlighted-text c-highlighted-text--light">'
      + '<h2 class="c-highlighted-text__title">' + esc(b.title) + '</h2>'
      + '<div class="clearfix text-formatted field field--name-field-texte-encadre field--type-text-long field--label-hidden field__item">' + (b.html || '') + '</div>'
      + '</div></div>';
  }

  function buildButton(b) {
    if (!isValidHref(b.href)) return '';
    var al = (b.align === 'center' || b.align === 'right') ? ' style="text-align:' + b.align + '"' : '';
    return '<div class="paragraph paragraph--type--bouton-cta paragraph--view-mode--default" id="' + rid() + '"' + al + '>'
      + '<a href="' + esc(b.href) + '" target="_self" class="btn btn-primary"><span>' + esc(b.text) + '</span></a></div>';
  }

  function buildVideo(b) {
    var src = toEmbedUrl(b.url);
    if (!src) return '';
    return '<div class="c-video c-video--remote paragraph paragraph--type--video-remote paragraph--view-mode--default" id="' + rid() + '">'
      + '<div class="field field--name-field-media field--type-entity-reference field--label-hidden field__items"><div class="field__item">'
      + '<div class="o-video media media--type-remote-video media--view-mode-default"><div class="video__container">'
      + '<iframe class="youtube_player" src="' + esc(src) + '" title="Video player" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen=""></iframe>'
      + '</div><div class="video__footer"></div></div></div></div></div>';
  }

  function buildFiles(b) {
    var items = (b.items || []).filter(function (it) { return it && normText(it.name) && isValidHref(it.url); });
    if (!items.length) return '';
    var lis = items.map(function (it) {
      var fmt = normText(it.format) || (function () { var m = normText(it.url).split('?')[0].match(/\.([a-z0-9]{2,5})$/i); return m ? m[1].toLowerCase() : 'link'; })();
      return '<li class="c-link c-link--document"><a href="' + esc(it.url) + '" class="c-link__link" target="_blank">'
        + '<div class="c-link__params"><span class="c-link__name">' + esc(it.name) + '</span>'
        + '<span class="c-link__format">' + esc(fmt) + '</span></div></a></li>';
    }).join('');
    var h3 = normText(b.title) ? '<h3 class="c-links__title">' + esc(b.title) + '</h3>' : '<h3 class="c-links__title"></h3>';
    return '<div class="c-liste-document paragraph paragraph--type--liste-documents paragraph--view-mode--default" id="' + rid() + '">'
      + h3 + '<ul class="c-liste-document__list">' + lis + '</ul></div>';
  }

  var BUILDERS = {
    heading: buildHeading, paragraph: buildParagraph, image: buildImage, gallery: buildGallery,
    twocol: buildTwocol, quote: buildQuote, highlight: buildHighlight, button: buildButton,
    video: buildVideo, files: buildFiles
  };

  function build(blocks) {
    var list = (blocks || []).filter(function (b) { return b && BUILDERS[b.type]; });
    if (!list.length) return '';
    return BUILD_MARK + list.map(function (b) { return BUILDERS[b.type](b); }).filter(Boolean).join('\n');
  }

  // ================= 反解析（parse，需注入 DOMParser） =================

  function parseWith(DOMParserCtor, html) {
    var out = { ok: false, blocks: [], reason: '' };
    if (!html || html.indexOf(BUILD_MARK) === -1) {
      // 非 builder 文章（原站导入 / Quill 纯文本）也尝试解析
    }
    try {
      var doc = new DOMParserCtor().parseFromString(html || '', 'text/html');
      var root = doc.body;
      var nodes = [];
      for (var i = 0; i < root.childNodes.length; i++) {
        var n = root.childNodes[i];
        if (n.nodeType === 8) continue; // 注释
        if (n.nodeType === 3 && !normText(n.textContent)) continue; // 空白
        nodes.push(n);
      }
      var blocks = [];
      var notices = [];
      for (var k = 0; k < nodes.length; k++) {
        var r = parseNode(nodes[k], nodes[k + 1] || null, blocks);
        if (!r.ok) { out.reason = r.reason; return out; }
        if (r.notice) notices.push(r.notice);
        if (r.consumed) k += r.consumed;
      }
      out.ok = true; out.blocks = blocks; out.notices = notices;
      return out;
    } catch (e) {
      out.reason = '解析异常：' + e.message;
      return out;
    }
  }

  function clsOf(el) { return el && el.classList ? Array.prototype.slice.call(el.classList) : []; }
  function hasCls(el, c) { return el.classList && el.classList.contains(c); }
  function paraType(el) {
    var cls = clsOf(el).join(' ');
    var m = cls.match(/paragraph--type--([a-z-]+)/);
    return m ? m[1] : '';
  }
  function fieldItemHtml(el, fieldName) {
    // 原站结构：field--name-field-xxx 与 field__item 在同一个 div 上（无后代关系）
    var sel = fieldName ? '.field--name-field-' + fieldName + '.field__item' : '.field__item';
    var f = el.querySelector(sel);
    return f ? f.innerHTML.trim() : '';
  }

  // 单节点 → 块（push 进 blocks）；pair 允许看下一个兄弟（s-zone 配对）
  function parseNode(el, next, blocks) {
    if (el.nodeType === 3) { // 顶层散文本（Quill 可能留 <p> 已处理；裸文本罕见）
      if (!normText(el.textContent)) return { ok: true };
      blocks.push({ type: 'paragraph', html: '<p>' + esc(el.textContent) + '</p>' });
      return { ok: true };
    }
    if (el.nodeType !== 1) return { ok: true };

    // ---- s-zone 分栏（left+right 成对 → twocol；单边栏 → 子块提升顶层，布局降级但不丢内容）----
    if (hasCls(el, 's-zone')) {
      var lm2 = clsOf(el).join(' ').match(/paragraph--zone-(\d+)/);
      var zWidth = lm2 ? lm2[1] : '66';
      if (hasCls(el, 'paragraph--zone-left') && next && hasCls(next, 's-zone') && hasCls(next, 'paragraph--zone-right')) {
        var ratio = zWidth === '50' ? '50' : (zWidth === '33' ? '33' : '66');
        var left = parseZoneSegs(el), right = parseZoneSegs(next);
        if (!left.ok) return left; if (!right.ok) return right;
        blocks.push({ type: 'twocol', ratio: ratio, left: left.segs, right: right.segs });
        return { ok: true, consumed: 1 }; // 连同 next 一起消费
      }
      // 单边栏：提升为顶层块
      var solo = parseZoneSegs(el);
      if (!solo.ok) return solo;
      for (var si = 0; si < solo.segs.length; si++) {
        var sg = solo.segs[si];
        if (sg.kind === 'text') blocks.push({ type: 'paragraph', html: sg.html });
        else if (sg.kind === 'image') blocks.push({ type: 'image', url: sg.url, alt: sg.alt });
        else blocks.push({ type: 'paragraph', html: sg.html });
      }
      return { ok: true, notice: '1 个分栏区块已展开为普通内容（原为窄栏布局，可在块搭建里重新添加图文两列）' };
    }

    var t = paraType(el);
    switch (t) {
      case 'titre-h2': case 'titre-h3': case 'titre-h4': case 'titre-h': {
        var hh = el.querySelector('h2,h3,h4,h5');
        if (!hh) return { ok: false, reason: '标题区块缺内容' };
        var lv = hh.tagName.toLowerCase();
        if (lv === 'h1' || lv === 'h5' || lv === 'h6') lv = lv === 'h1' ? 'h2' : 'h4';
        blocks.push({ type: 'heading', level: lv, text: normText(hh.textContent) });
        return { ok: true };
      }
      case 'texte-encadre': case 'texte': {
        var ph = fieldItemHtml(el, 'texte-encadre');
        if (!ph) return { ok: false, reason: '段落区块缺内容（请用预览编辑修改）' };
        blocks.push({ type: 'paragraph', html: ph });
        return { ok: true };
      }
      case 'image': {
        var img = el.querySelector('img');
        if (!img) return { ok: false, reason: '图片区块缺图片' };
        blocks.push({ type: 'image', url: img.getAttribute('src') || '', alt: img.getAttribute('alt') || '' });
        return { ok: true };
      }
      case 'full-width-slider': {
        var wrap = el.querySelector('.js-full-width-slider');
        if (!wrap) return { ok: false, reason: '轮播区块结构不规则' };
        var frames = [];
        // 只取 wrap 的直接子级（帧容器），避免把帧内 slider-content 的文本 field__item 误当帧
        for (var fi = 0; fi < wrap.children.length; fi++) {
          var fc = wrap.children[fi];
          if (!hasCls(fc, 'field__item')) continue;
          var sc = fc.querySelector('.paragraph--type--slider-content');
          if (!sc) return { ok: false, reason: '轮播帧结构不规则' };
          var bgEl = sc.querySelector('.paragraph--type--slider-content__image');
          var bg = bgEl ? (bgEl.getAttribute('style') || '') : '';
          var bm = bg.match(/url\(([^)]+)\)/);
          var titleEl = sc.querySelector('.field--name-field-title');
          var ctaA = sc.querySelector('.field--name-field-link-cta a');
          frames.push({
            url: bm ? bm[1].replace(/['"]/g, '').trim() : '',
            title: titleEl ? normText(titleEl.textContent) : '',
            text: fieldItemHtml(sc, 'texte-encadre'),
            ctaText: ctaA ? normText(ctaA.textContent) : '',
            ctaHref: ctaA ? (ctaA.getAttribute('href') || '') : ''
          });
        }
        blocks.push({ type: 'gallery', frames: frames });
        return { ok: true };
      }
      case 'citation': {
        var bqText = el.querySelector('.c-blockquote__body-text');
        var bqAuthor = el.querySelector('.c-blockquote__footer .c-blockquote__author');
        blocks.push({ type: 'quote', text: bqText ? bqText.innerHTML.trim() : '', author: bqAuthor ? normText(bqAuthor.textContent) : '' });
        return { ok: true };
      }
      case 'highlighted-block': {
        if (el.querySelector('.field--name-field-cta .paragraph')) return { ok: false, reason: '重点块含内嵌 CTA（请用预览编辑修改该块）' };
        var hTitle = el.querySelector('.c-highlighted-text__title');
        blocks.push({ type: 'highlight', title: hTitle ? normText(hTitle.textContent) : '', html: fieldItemHtml(el, 'texte-encadre') });
        return { ok: true };
      }
      case 'bouton-cta': {
        var a = el.querySelector('a.btn');
        if (!a) return { ok: false, reason: '按钮区块缺链接' };
        var st = el.getAttribute('style') || '';
        var am = st.match(/text-align:\s*(center|right)/i);
        blocks.push({ type: 'button', text: normText(a.textContent), href: a.getAttribute('href') || '', align: am ? am[1].toLowerCase() : '' });
        return { ok: true };
      }
      case 'video-remote': {
        var ifr = el.querySelector('iframe');
        if (!ifr) return { ok: false, reason: '视频区块缺 iframe' };
        blocks.push({ type: 'video', url: ifr.getAttribute('src') || '' });
        return { ok: true };
      }
      case 'liste-documents': {
        var items2 = el.querySelectorAll('li.c-link');
        var arr = [];
        for (var li = 0; li < items2.length; li++) {
          var liA = items2[li].querySelector('a');
          if (!liA) continue;
          var nameEl = items2[li].querySelector('.c-link__name');
          var fmtEl = items2[li].querySelector('.c-link__format');
          arr.push({ name: nameEl ? normText(nameEl.textContent) : '', format: fmtEl ? normText(fmtEl.textContent) : '', url: liA.getAttribute('href') || '' });
        }
        var ttl = el.querySelector('.c-links__title');
        blocks.push({ type: 'files', title: ttl ? normText(ttl.textContent) : '', items: arr });
        return { ok: true };
      }
      default:
        return parsePlainNode(el, blocks);
    }
  }

  // s-zone 内的子段落
  function parseZoneSegs(zone) {
    var segs = [];
    for (var i = 0; i < zone.children.length; i++) {
      var c = zone.children[i];
      var t = paraType(c);
      if (t === 'texte-encadre' || t === 'texte') { segs.push({ kind: 'text', html: fieldItemHtml(c, 'texte-encadre') || c.innerHTML.trim() }); continue; }
      if (t === 'image') {
        var im = c.querySelector('img');
        if (!im) return { ok: false, reason: '分栏内图片区块缺图片' };
        segs.push({ kind: 'image', url: im.getAttribute('src') || '', alt: im.getAttribute('alt') || '' });
        continue;
      }
      if (t === 'bouton-cta') {
        var a = c.querySelector('a.btn');
        if (!a) return { ok: false, reason: '分栏内按钮区块缺链接' };
        segs.push({ kind: 'raw', html: '<div class="paragraph paragraph--type--bouton-cta paragraph--view-mode--default" id="' + rid() + '"><a href="' + esc(a.getAttribute('href') || '') + '" target="_self" class="btn btn-primary"><span>' + esc(normText(a.textContent)) + '</span></a></div>' });
        continue;
      }
      if (t.indexOf('titre-') === 0) {
        var hh = c.querySelector('h2,h3,h4');
        segs.push({ kind: 'raw', html: buildHeading({ level: hh ? hh.tagName.toLowerCase() : 'h3', text: hh ? normText(hh.textContent) : '' }) });
        continue;
      }
      if (t) {
        // 其他段落类型（video / highlighted 等）：raw 原样保留（保真，不可编辑），build 原样输出
        segs.push({ kind: 'raw', html: c.outerHTML });
        continue;
      }
      return { ok: false, reason: '分栏内含无法识别的内容（' + c.tagName.toLowerCase() + '）' };
    }
    return { ok: true, segs: segs };
  }

  // 非 paragraph 结构（Quill 手写文章的顶层纯标签）
  function parsePlainNode(el, blocks) {
    var tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      var lv = tag === 'h1' ? 'h2' : (tag === 'h5' || tag === 'h6') ? 'h4' : tag;
      blocks.push({ type: 'heading', level: lv, text: normText(el.textContent) });
      return { ok: true };
    }
    if (tag === 'p' || tag === 'ul' || tag === 'ol') {
      // 合并连续的 p/ul 为一个段落块（在调用侧难做，这里单独成块；build 后结构等价）
      blocks.push({ type: 'paragraph', html: el.outerHTML });
      return { ok: true };
    }
    if (tag === 'blockquote') {
      blocks.push({ type: 'quote', text: el.innerHTML.trim(), author: '' });
      return { ok: true };
    }
    if (tag === 'img') {
      blocks.push({ type: 'image', url: el.getAttribute('src') || '', alt: el.getAttribute('alt') || '' });
      return { ok: true };
    }
    if (tag === 'figure') {
      var im2 = el.querySelector('img');
      if (im2) { blocks.push({ type: 'image', url: im2.getAttribute('src') || '', alt: im2.getAttribute('alt') || '' }); return { ok: true }; }
    }
    if (tag === 'div') {
      // 没有任何 paragraph 标记的 div：若只含 p/ul/h 等简单内容则拆开，否则拒绝
      var simple = true;
      for (var i = 0; i < el.children.length; i++) {
        var ct = el.children[i].tagName.toLowerCase();
        if (!/^(p|ul|ol|h[1-6]|blockquote|figure)$/.test(ct) && !paraType(el.children[i])) { simple = false; break; }
      }
      if (simple && el.children.length) {
        for (var j = 0; j < el.children.length; j++) {
          var r = parsePlainNode(el.children[j], blocks);
          if (!r.ok) return r;
        }
        return { ok: true };
      }
    }
    return { ok: false, reason: '含无法识别的区块（' + (paraType(el) || tag) + '），请用「预览编辑」修改' };
  }

  // ---- 模板（新建起步条） ----
  function templateBlocks(key) {
    var P = function (h) { return { type: 'paragraph', html: h }; };
    var H = function (t, l) { return { type: 'heading', level: l || 'h2', text: t }; };
    switch (key) {
      case 'product': return [
        H('产品故事标题', 'h2'),
        { type: 'twocol', ratio: '66', left: [{ kind: 'text', html: '<p>在这里介绍这款产品的来历与核心功效……</p>' }], right: [{ kind: 'image', url: '', alt: '' }] },
        P('<p>详细描述产品的成分理念、应用场景与配方建议……</p>'),
        { type: 'quote', text: '一句来自客户或研发的推荐语。', author: '' },
        { type: 'button', text: '了解更多', href: '/personal-care/product-finder.html', align: '' }
      ];
      case 'news': return [
        H('新闻标题', 'h2'),
        P('<p>新闻导语：一句话说清发生了什么……</p>'),
        { type: 'image', url: '', alt: '' },
        P('<p>新闻正文细节……</p>')
      ];
      case 'event': return [
        H('活动回顾', 'h2'),
        { type: 'gallery', frames: [{ url: '', title: '现场一瞥', text: '<p>一句话介绍这张照片……</p>' }] },
        P('<p>活动亮点与数据回顾……</p>'),
        { type: 'highlight', title: '下一站预告', html: '<p>时间和地点……</p>' }
      ];
      case 'tech': return [
        H('技术主题', 'h2'),
        P('<p>背景与问题……</p>'),
        { type: 'twocol', ratio: '50', left: [{ kind: 'text', html: '<p>左栏要点……</p>' }], right: [{ kind: 'text', html: '<p>右栏要点……</p>' }] },
        P('<p>结论与建议……</p>'),
        { type: 'button', text: '联系我们', href: '/contact.html', align: '' }
      ];
      default: return [];
    }
  }

  global.GFBuilder = {
    BUILD_MARK: BUILD_MARK,
    isValidHref: isValidHref,
    toEmbedUrl: toEmbedUrl,
    build: build,
    parse: function (html) { return parseWith(global.DOMParser, html); },
    parseWith: parseWith,
    templateBlocks: templateBlocks
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.GFBuilder;
})(typeof window !== 'undefined' ? window : globalThis);
