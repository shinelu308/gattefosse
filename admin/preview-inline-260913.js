/**
 * 预览式原位编辑——iframe 内交互脚本（2026-09-11）
 * 运行在后台文章编辑页的预览 iframe 内（blob 文档，同源）。
 * 职责：高亮可编辑目标（文本节点/图片/视频）→ 弹出小编辑浮层 → 构造受限补丁 postMessage 给父页面。
 * 铁律：只允许改文本节点内容、img src、视频播放地址（iframe src / video source src）三类；
 *       class/结构/其余属性一律不可触碰。
 * 补丁路径：从 #cp-root（与后端回填的根容器一一对应）到目标节点的 childNodes 索引链，每步带 nodeName。
 * old 值：WeakMap 记录每个节点会话开始时的原始值（首次修改时登记），保证后端旧值校验始终对准库内版本。
 *
 * 2026-09-11 三次修订：补齐「本机视频块」支持（原站 paragraph--type--video）。
 * 原站视频块有两种，只有 video-remote 导入后转成 <iframe>；本机 mp4 块保留为
 * <video><source src="…mp4">，既不是 iframe 也没有 <video src> → 此前点击无反应。
 */
(function () {
  'use strict';
  if (window.__cpPreviewActive) return;
  window.__cpPreviewActive = true;

  var ROOT_ID = 'cp-root';
  var origValues = new WeakMap();   // 节点 → 原始文本/src（首次修改前登记）
  var pop = null;                   // 当前编辑浮层
  var hoverMark = null;             // 当前 hover 高亮元素
  var busy = false;                 // 图片上传中防重复提交

  function root() { return document.getElementById(ROOT_ID); }

  // ---------- 浮层样式（注入一次） ----------
  (function injectStyles() {
    var st = document.createElement('style');
    st.textContent =
      '.cp-pop{position:absolute;z-index:2147483000;width:min(480px,calc(100vw - 32px));background:#fff;border:1px solid #d5d9de;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:14px 16px;font-family:inherit;}' +
      '.cp-pop-title{font-size:14px;font-weight:700;color:#232426;margin-bottom:10px;}' +
      '.cp-input,.cp-file{width:100%;box-sizing:border-box;border:1px solid #c8cdd3;border-radius:6px;padding:8px 10px;font-size:13px;font-family:inherit;}' +
      '.cp-input:focus{outline:2px solid #8EB73C33;border-color:#8EB73C;}' +
      'textarea.cp-input{resize:vertical;line-height:1.6;}' +
      '.cp-hint{font-size:12px;color:#8a939c;margin-top:6px;}' +
      '.cp-btns{margin-top:12px;display:flex;gap:8px;justify-content:flex-end;}' +
      '.cp-btns button{border:none;border-radius:6px;padding:7px 18px;font-size:13px;cursor:pointer;font-family:inherit;}' +
      '.cp-btns .cp-ok{background:#8EB73C;color:#fff;}' +
      '.cp-btns .cp-ok:disabled{background:#c3d6a0;cursor:not-allowed;}' +
      '.cp-btns .cp-cancel{background:#eef1f4;color:#5b6570;}' +
      '#cp-root{cursor:text;}#cp-root img,#cp-root iframe,#cp-root video{cursor:pointer;}';
    document.head.appendChild(st);
  })();

  // ---------- 工具 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function send(msg) {
    msg.source = 'cp-preview';
    try { parent.postMessage(msg, '*'); } catch (e) { /* ignore */ }
  }
  function origOf(node, current) {
    if (!origValues.has(node)) origValues.set(node, current);
    return origValues.get(node);
  }
  /** 从 root 到 node 的路径（childNodes 索引链 + nodeName） */
  function buildPath(node) {
    var r = root();
    var path = [];
    var cur = node;
    while (cur && cur !== r) {
      var p = cur.parentNode;
      if (!p) return null;
      path.unshift({ i: Array.prototype.indexOf.call(p.childNodes, cur), tag: cur.nodeName });
      cur = p;
    }
    return (cur === r && path.length) ? path : null;
  }
  function nodeByPath(path) {
    var r = root();
    var node = r;
    for (var d = 0; d < path.length; d++) {
      if (!node) return null;
      var child = node.childNodes[path[d].i] || null;
      if (!child) return null;
      node = child;
    }
    return node;
  }

  // ---------- 目标识别 ----------
  /** 返回 {kind:'text', node} | {kind:'img'|'video', el} 或 null；视频封面覆盖层由其自身 handler 处理 */
  function hitTarget(el) {
    var r = root();
    if (!r || !el || el === document.body || el === document.documentElement) return null;
    if (el.closest && el.closest('.cp-video-cover')) return null; // 封面层有自己的 handler
    if (el.tagName === 'IMG' && r.contains(el)) return { kind: 'img', el: el };
    if (el.tagName === 'IFRAME' && r.contains(el)) return { kind: 'video', el: el };
    if (r.contains(el) || (el.nodeType === 3 && r.contains(el.parentNode))) return { kind: 'text', el: el };
    return null;
  }
  /** 点击点处的文本节点 */
  function textNodeAt(x, y, fallbackEl) {
    var node = null;
    try {
      var range = document.caretRangeFromPoint(x, y);
      if (range && range.startContainer.nodeType === 3) node = range.startContainer;
      else if (range && range.startContainer.nodeType === 1) node = firstTextNode(range.startContainer);
    } catch (e) { /* older engines */ }
    if (!node) node = firstTextNode(fallbackEl);
    return node;
  }
  function firstTextNode(el) {
    if (!el) return null;
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = w.nextNode())) {
      if (n.nodeValue && n.nodeValue.replace(/\s+/g, '').length) return n;
    }
    return null;
  }

  // ---------- 高亮 ----------
  var OUTLINE = { text: '2px dashed #8EB73C', img: '2px dashed #0075BB', video: '2px dashed #C4004D' };
  var OUTLINE_BG = { text: 'rgba(142,183,60,.10)', img: 'rgba(0,117,187,.10)', video: 'rgba(196,0,77,.08)' };
  function clearHover() {
    if (hoverMark) {
      hoverMark.style.outline = hoverMark.dataset.cpPrevOutline || '';
      hoverMark.style.backgroundColor = hoverMark.dataset.cpPrevBg || '';
      hoverMark.removeAttribute('data-cp-prev-outline');
      hoverMark.removeAttribute('data-cp-prev-bg');
      hoverMark = null;
    }
  }
  function markHover(el, kind) {
    if (hoverMark === el) return;
    clearHover();
    if (!el) return;
    el.dataset.cpPrevOutline = el.style.outline || '';
    el.dataset.cpPrevBg = el.style.backgroundColor || '';
    el.style.outline = OUTLINE[kind];
    el.style.backgroundColor = OUTLINE_BG[kind];
    hoverMark = el;
  }

  // ---------- 编辑浮层 ----------
  function closePop() {
    if (pop) { pop.remove(); pop = null; }
  }
  function openPop(anchor, html) {
    closePop();
    pop = document.createElement('div');
    pop.className = 'cp-pop';
    pop.innerHTML = html;
    document.body.appendChild(pop);
    var rect = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 40, bottom: 80, top: 40 };
    // .cp-pop 是 position:absolute（文档坐标），rect 是视口坐标——必须补滚动偏移，
    // 否则页面滚动后弹框整体上移 scrollY（曾表现为「点图片弹框跑到上方文字旁」）
    var scY = window.scrollY || window.pageYOffset || 0;
    var scX = window.scrollX || window.pageXOffset || 0;
    var popW = Math.min(480, window.innerWidth - 32);
    var left = Math.max(8, Math.min(rect.left + scX, scX + window.innerWidth - popW - 8));
    var top = rect.bottom + 10 + scY;
    if (top + pop.offsetHeight > scY + window.innerHeight - 16) {
      top = Math.max(scY + 16, rect.top + scY - pop.offsetHeight - 10);
    }
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    return pop;
  }
  function popActions(popEl, onOk) {
    var btnOk = popEl.querySelector('.cp-ok');
    var btnCancel = popEl.querySelector('.cp-cancel');
    function ok() { if (onOk() !== false) closePop(); }
    btnOk.addEventListener('click', ok);
    btnCancel.addEventListener('click', closePop);
    popEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePop();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ok();
    });
  }

  // ---------- 三类编辑 ----------
  function editText(textNode, anchorEl) {
    var original = origOf(textNode, textNode.nodeValue);
    openPop(anchorEl,
      '<div class="cp-pop-title">✏️ 修改文字</div>' +
      '<textarea class="cp-input" rows="4" id="cp-edit-text"></textarea>' +
      '<div class="cp-hint">仅修改这一段文字（不含其中的链接/加粗等元素）；Ctrl+Enter 确定</div>' +
      '<div class="cp-btns"><button class="cp-ok">确定</button><button class="cp-cancel">取消</button></div>');
    var ta = pop.querySelector('#cp-edit-text');
    ta.value = textNode.nodeValue;
    ta.focus();
    popActions(pop, function () {
      var next = ta.value;
      if (!next.trim()) { ta.style.borderColor = '#C4004D'; return false; }
      var path = buildPath(textNode);
      if (!path) { alert('无法定位该文本，请刷新预览重试'); return false; }
      textNode.nodeValue = next;
      send({ type: 'patch', patch: { kind: 'text', path: path, old: original, next: next } });
    });
  }

  function editImage(imgEl) {
    if (busy) return;
    var original = origOf(imgEl, imgEl.getAttribute('src'));
    openPop(imgEl,
      '<div class="cp-pop-title">🖼️ 替换图片</div>' +
      '<input type="file" accept="image/*" class="cp-file" id="cp-edit-img">' +
      '<div class="cp-hint">支持 jpg / png / webp；新图会自动等比适配原位置</div>' +
      '<div class="cp-btns"><button class="cp-ok" disabled>请先选择图片</button><button class="cp-cancel">取消</button></div>');
    var file = pop.querySelector('#cp-edit-img');
    var okBtn = pop.querySelector('.cp-ok');
    var picked = null;
    file.addEventListener('change', function () {
      picked = file.files && file.files[0];
      if (picked) { okBtn.disabled = false; okBtn.textContent = '上传并替换'; }
    });
    popActions(pop, function () {
      if (!picked || busy) return false;
      busy = true;
      okBtn.disabled = true; okBtn.textContent = '上传中…';
      var path = buildPath(imgEl);
      if (!path) { busy = false; alert('无法定位该图片，请刷新预览重试'); return false; }
      var reader = new FileReader();
      reader.onload = function () {
        send({ type: 'patch', patch: { kind: 'img', path: path, old: original, next: '', dataUrl: reader.result, name: picked.name } });
      };
      reader.readAsDataURL(picked);
      return true; // 关闭浮层，等待父页面上传后回发
    });
  }

  // ---------- 视频平台解析（2026-09-11 扩展：支持国内主流媒体） ----------
  /** 任意输入 → { platform, embed }；识别 YouTube / 哔哩哔哩 / 腾讯视频 / 优酷，
   *  其它合法 https 链接按「通用嵌入地址」兜底（适配各平台播放器通用代码里的 src） */
  function parseVideoPlatform(raw) {
    var s = (raw || '').trim();
    if (!s) return null;
    var m;
    // YouTube：裸 ID（11 位含 -/_，排除 BV/av 前缀）或 watch/shorts/youtu.be 链接
    if (!/^(BV|av)/i.test(s) && /^[A-Za-z0-9_-]{6,20}$/.test(s)) return { platform: 'youtube', embed: 'https://www.youtube.com/embed/' + s };
    if ((m = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/i.exec(s))) return { platform: 'youtube', embed: 'https://www.youtube.com/embed/' + m[1] };
    // 哔哩哔哩：BV 号 / av 号 / 视频页链接 / b23.tv 短链文本里的 BV
    if ((m = /BV[0-9A-Za-z]{8,12}/i.exec(s))) return { platform: 'bilibili', embed: 'https://player.bilibili.com/player.html?bvid=' + m[0] + '&autoplay=0' };
    if ((m = /\bav(\d{4,12})\b/i.exec(s))) return { platform: 'bilibili', embed: 'https://player.bilibili.com/player.html?aid=' + m[1] + '&autoplay=0' };
    // 腾讯视频：x/cover/…/<vid>.html、x/page/<vid>.html、iframe/player.html?vid=…
    if ((m = /v\.qq\.com\/x\/(?:cover\/[^\/\s"']+\/|page\/)([A-Za-z0-9]+)\.html/i.exec(s))) return { platform: 'qq', embed: 'https://v.qq.com/iframe/player.html?vid=' + m[1] + '&autoplay=0' };
    if ((m = /v\.qq\.com\/iframe\/player\.html\?[^"']*vid=([A-Za-z0-9]+)/i.exec(s))) return { platform: 'qq', embed: 'https://v.qq.com/iframe/player.html?vid=' + m[1] + '&autoplay=0' };
    // 优酷：v_show/id_xxx 或 player.youku.com/embed/xxx
    if ((m = /youku\.com\/v_show\/id_([A-Za-z0-9=]+)/i.exec(s)) || (m = /player\.youku\.com\/embed\/([A-Za-z0-9=]+)/i.exec(s))) return { platform: 'youku', embed: 'https://player.youku.com/embed/' + m[1] };
    return null;
  }

  var PLATFORM_LABEL = { youtube: '', bilibili: '哔哩哔哩', qq: '腾讯视频', youku: '优酷', generic: '视频' };

  function editVideo(iframeEl) {
    var original = origOf(iframeEl, iframeEl.getAttribute('src'));
    openPop(iframeEl,
      '<div class="cp-pop-title">🎬 修改视频链接</div>' +
      '<input type="text" class="cp-input" id="cp-edit-video" placeholder="粘贴视频链接或 ID，如 youtube.com/watch?v=xxx、bilibili.com/video/BVxx、v.qq.com/x/cover/…/xxx.html">' +
      '<div class="cp-hint">支持 YouTube / 哔哩哔哩 / 腾讯视频 / 优酷 的链接、视频 ID（如 BV 号）或播放器嵌入地址</div>' +
      '<div class="cp-btns"><button class="cp-ok">确定</button><button class="cp-cancel">取消</button></div>');
    var input = pop.querySelector('#cp-edit-video');
    input.value = original || '';
    input.focus();
    popActions(pop, function () {
      var parsed = parseVideoPlatform(input.value);
      if (!parsed) { input.style.borderColor = '#C4004D'; input.placeholder = '无法识别，请粘贴视频链接或视频 ID'; return false; }
      var path = buildPath(iframeEl);
      if (!path) { alert('无法定位该视频，请刷新预览重试'); return false; }
      iframeEl.setAttribute('src', parsed.embed);
      refreshVideoCover(iframeEl);
      send({ type: 'patch', patch: { kind: 'video', path: path, old: original, next: parsed.embed } });
    });
  }

  // ---------- 视频封面覆盖层（2026-09-11 二次修复） ----------
  // 两个问题一起解决：①真实鼠标点击落在 YouTube iframe 内部文档里，事件不冒泡到预览文档，
  // 编辑浮层永远弹不出；②YouTube 播放器在 blob 预览文档中报「错误 153」。
  // 方案：iframe 上面盖一层封面卡（视频缩略图 + 播放按钮 + 「点击修改视频链接」提示），
  // 点击封面弹出编辑浮层。⚠️ 只 append 兄弟节点、不改 DOM 结构，保证补丁路径与后端解析一致。
  function videoIdFromSrc(src) {
    var m = /\/embed\/([A-Za-z0-9_-]{6,20})/.exec(src || '');
    return m ? m[1] : null;
  }
  /** 按来源构造封面卡：YouTube 显示缩略图；国内平台显示平台标识 + 渐变底（无公开缩略图接口） */
  function buildCoverHtml(platform, ytId) {
    var label = PLATFORM_LABEL[platform] || '视频';
    var img = (platform === 'youtube' && ytId)
      ? '<img src="https://i.ytimg.com/vi/' + ytId + '/hqdefault.jpg" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.95;">'
      : '<div style="position:absolute;inset:0;background:linear-gradient(135deg,#23262b 0%,#3a3f46 60%,#2b2e33 100%);"></div>';
    var badge = label
      ? '<div style="position:absolute;top:10px;left:10px;background:rgba(0,0,0,.55);color:#fff;font-size:12px;padding:3px 10px;border-radius:12px;font-family:inherit;">▶ ' + label + '</div>'
      : '';
    return img + badge
      + '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:64px;height:44px;background:rgba(196,0,77,.92);border-radius:10px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.35);">'
      + '<div style="width:0;height:0;border-left:18px solid #fff;border-top:11px solid transparent;border-bottom:11px solid transparent;margin-left:5px;"></div></div>'
      + '<div style="position:absolute;left:0;right:0;bottom:0;padding:5px 10px;background:rgba(0,0,0,.62);color:#fff;font-size:12px;text-align:center;font-family:inherit;">🎬 点击修改视频链接</div>';
  }
  function buildCoverHtmlBySrc(src) {
    var yt = videoIdFromSrc(src);
    if (yt) return buildCoverHtml('youtube', yt);
    if (/player\.bilibili\.com/i.test(src || '')) return buildCoverHtml('bilibili');
    if (/v\.qq\.com\/iframe/i.test(src || '')) return buildCoverHtml('qq');
    if (/player\.youku\.com/i.test(src || '')) return buildCoverHtml('youku');
    return buildCoverHtml('generic');
  }
  function refreshVideoCover(iframeEl) {
    var cover = iframeEl.__cpCover;
    if (cover) cover.innerHTML = buildCoverHtmlBySrc(iframeEl.getAttribute('src'));
  }

  // ---------- 本机视频（2026-09-11 三次修复：覆盖 paragraph--type--video） ----------
  // 原站有两种视频块，只有 video-remote 会被导入器转成 <iframe>；本机 mp4 块原样保留为
  // <video><source src="/sites/…mp4"></video>。它既不是 iframe，也没有 <video src>，于是此前
  // ①封面层挂不上（旧 enhanceVideoCovers 只查 iframe）②点击落到「文本」分支后静默关闭浮层。
  // 方案：封面挂在 .video__container 上，补丁路径指向 <source> 元素本身，后端认 SOURCE。
  function fileBaseName(u) {
    var seg = String(u || '').split(/[?#]/)[0].split('/');
    var last = seg[seg.length - 1] || '';
    try { return decodeURIComponent(last); } catch (e) { return last; }
  }
  /** 本机视频只接受「视频文件地址」：根相对路径或 http(s) 直链，且以视频扩展名结尾 */
  function isLocalVideoSrc(v) {
    var s = (v || '').trim();
    if (!/^(?:https?:\/\/|\/)/i.test(s)) return false;
    return /\.(?:mp4|webm|ogv|ogg|mov|m4v)(?:[?#]|$)/i.test(s);
  }
  /** 可编辑的地址载体：优先 <video> 内的 <source>，退回 <video src>；都没有则不可编辑 */
  function localVideoTarget(vd) {
    var kids = vd.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].tagName === 'SOURCE' && kids[i].getAttribute('src')) return kids[i];
    }
    return vd.getAttribute('src') ? vd : null;
  }
  /** 本机视频封面：半透明遮罩（让视频首帧可辨认）+ 文件名角标 + 播放块 + 底部提示 */
  function buildLocalCoverHtml(src) {
    return '<div style="position:absolute;inset:0;background:rgba(10,12,15,.28);"></div>'
      + '<div style="position:absolute;top:10px;left:10px;max-width:72%;background:rgba(0,0,0,.60);color:#fff;font-size:12px;padding:3px 10px;border-radius:12px;font-family:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">▶ 本机视频 · ' + esc(fileBaseName(src) || '未设置') + '</div>'
      + '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:64px;height:44px;background:rgba(196,0,77,.90);border-radius:10px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.35);">'
      + '<div style="width:0;height:0;border-left:18px solid #fff;border-top:11px solid transparent;border-bottom:11px solid transparent;margin-left:5px;"></div></div>'
      + '<div style="position:absolute;left:0;right:0;bottom:0;padding:5px 10px;background:rgba(0,0,0,.62);color:#fff;font-size:12px;text-align:center;font-family:inherit;">🎬 点击修改视频地址</div>';
  }
  function refreshLocalCover(keyEl, src) {
    var cover = keyEl && keyEl.__cpCover;
    if (cover) cover.innerHTML = buildLocalCoverHtml(src);
  }
  /** 编辑本机视频：只改地址（<source src> 或 <video src>），结构与 class 一律不动 */
  function editLocalVideo(keyEl, target) {
    var original = origOf(target, target.getAttribute('src'));
    openPop(keyEl,
      '<div class="cp-pop-title">🎬 修改视频地址（本机视频）</div>' +
      '<input type="text" class="cp-input" id="cp-edit-video" placeholder="/uploads/2026/09/xxx.mp4">' +
      '<div class="cp-hint">这是随正文导入的本地视频文件。填写新的视频文件地址（/uploads/ 下的 mp4 / webm / mov，或外部 https 直链）；只替换文件地址，版式与播放器样式保持不变</div>' +
      '<div class="cp-btns"><button class="cp-ok">确定</button><button class="cp-cancel">取消</button></div>');
    var input = pop.querySelector('#cp-edit-video');
    input.value = original || '';
    input.focus();
    popActions(pop, function () {
      var next = (input.value || '').trim();
      if (!isLocalVideoSrc(next)) {
        input.style.borderColor = '#C4004D';
        input.placeholder = '请填写视频文件地址（需以 .mp4 / .webm / .mov 等结尾）';
        return false;
      }
      if (next === (original || '').trim()) return true; // 未改动，直接关闭
      var path = buildPath(target);
      if (!path) { alert('无法定位该视频，请刷新预览重试'); return false; }
      target.setAttribute('src', next);
      refreshLocalCover(keyEl, next);
      send({ type: 'patch', patch: { kind: 'video', path: path, old: original, next: next } });
    });
  }

  /** 挂视频封面层：host = 定位容器（自动补 position:relative），keyEl = 记录 __cpCover 的元素 */
  function mountVideoCover(host, keyEl, html, onOpen, solid) {
    if (!host || host.nodeType !== 1 || keyEl.__cpCover) return;
    try {
      if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative';
    } catch (e) { /* ignore */ }
    var cover = document.createElement('div');
    cover.className = 'cp-video-cover';
    cover.setAttribute('style', 'position:absolute;inset:0;z-index:10;cursor:pointer;overflow:hidden;background:' + (solid ? '#111' : 'transparent') + ';');
    cover.innerHTML = html;
    host.appendChild(cover);
    keyEl.__cpCover = cover;
    cover.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      closePop();
      onOpen();
    });
    cover.addEventListener('mouseover', function () { markHover(cover, 'video'); });
    cover.addEventListener('mouseout', clearHover);
  }

  function enhanceVideoCovers() {
    var r = root();
    if (!r) return;
    // ① 远程平台视频：封面挂 <iframe> 的父容器，补丁指向 <iframe>
    Array.prototype.forEach.call(r.querySelectorAll('iframe'), function (ifr) {
      mountVideoCover(ifr.parentNode, ifr, buildCoverHtmlBySrc(ifr.getAttribute('src')), function () {
        editVideo(ifr);
      }, true);
    });
    // ② 本机视频：封面挂 .video__container，补丁指向 <source>
    Array.prototype.forEach.call(r.querySelectorAll('video'), function (vd) {
      var target = localVideoTarget(vd);
      if (!target) return;
      var host = (vd.closest && vd.closest('.video__container')) || vd.parentNode;
      mountVideoCover(host, vd, buildLocalCoverHtml(target.getAttribute('src')), function () {
        editLocalVideo(vd, target);
      }, false);
    });
  }

  // ---------- 事件接管 ----------
  // ⚠️ 拖选保护（2026-09-11 用户反馈）：在浮层输入框里向左拖选内容滑出浮层边界时，
  // 浏览器把 click 派发到浮层外的共同祖先，会误触发「点击浮层外关闭」。
  // 记录 mousedown 起点：从浮层内开始的按下-拖动-抬起全程不触发浮层外点击逻辑。
  var mouseDownAt = null; // 'pop' | 'outside' | null
  document.addEventListener('mousedown', function (e) {
    mouseDownAt = (pop && (pop === e.target || pop.contains(e.target))) ? 'pop' : 'outside';
  }, true);
  document.addEventListener('mouseup', function () {
    // click 在 mouseup 后同步派发，延迟复位保证 click 能读到本次按下的起点
    setTimeout(function () { mouseDownAt = null; }, 0);
  }, true);

  document.addEventListener('mouseover', function (e) {
    if (mouseDownAt) { clearHover(); return; } // 拖选中不高亮，避免选文字时闪框
    var t = hitTarget(e.target);
    if (t) {
      var el = t.kind === 'text' ? (t.el.nodeType === 3 ? t.el.parentNode : t.el) : t.el;
      if (el && el !== pop) markHover(el, t.kind);
      else clearHover();
    } else clearHover();
  }, true);
  document.addEventListener('mouseout', function (e) { clearHover(); }, true);

  document.addEventListener('click', function (e) {
    // 浮层内开始的按下（含拖选滑出）：交给浮层自身，不关闭、不弹新浮层
    if (mouseDownAt === 'pop') { mouseDownAt = null; return; }
    mouseDownAt = null;
    // 浮层内点击放行
    if (pop && (pop === e.target || pop.contains(e.target))) return;
    // 阻止一切跳转/交互
    var a = e.target.closest ? e.target.closest('a') : null;
    if (a) e.preventDefault();

    var r = root();
    if (!r) return;
    if (!r.contains(e.target) && e.target.tagName !== 'IMG' && e.target.tagName !== 'IFRAME') { closePop(); return; }

    var t = hitTarget(e.target);
    if (!t) { closePop(); return; }

    if (t.kind === 'img') { e.preventDefault(); e.stopPropagation(); closePop(); editImage(t.el); return; }
    if (t.kind === 'video') { e.preventDefault(); e.stopPropagation(); closePop(); editVideo(t.el); return; }

    // 文本：定位点击处的文本节点
    e.preventDefault(); e.stopPropagation();
    var tn = textNodeAt(e.clientX, e.clientY, t.el);
    if (!tn) { closePop(); return; }
    var anchor = tn.parentNode && tn.parentNode.nodeType === 1 ? tn.parentNode : t.el;
    editText(tn, anchor);
  }, true);

  // 阻止双击选中等干扰（保留原生选择）
  document.addEventListener('submit', function (e) { e.preventDefault(); }, true);

  // ---------- 父页面回发 ----------
  // 图片流程：iframe 只发一次带原始 old 的上传意图 → 父页面上传并记录补丁 → 回发仅用于视觉更新
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.source !== 'cp-host') return;
    if (d.type === 'img-uploaded') {
      busy = false;
      var node = nodeByPath(d.path || []);
      if (node && node.nodeName === 'IMG') node.setAttribute('src', d.url);
    } else if (d.type === 'img-failed') {
      busy = false;
      alert('图片上传失败：' + (d.msg || '未知错误'));
    }
  });

  send({ type: 'ready' });
  // 视频封面覆盖层：DOM 就绪后挂载（脚本在 body 尾部，DOM 已齐）
  enhanceVideoCovers();
})();
