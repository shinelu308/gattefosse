/**
 * 预览式原位编辑——iframe 内交互脚本（2026-09-11）
 * 运行在后台文章编辑页的预览 iframe 内（blob 文档，同源）。
 * 职责：高亮可编辑目标（文本节点/图片/视频）→ 弹出小编辑浮层 → 构造受限补丁 postMessage 给父页面。
 * 铁律：只允许改文本节点内容、img src、视频 iframe src 三类；class/结构/其余属性一律不可触碰。
 * 补丁路径：从 #cp-root（与后端回填的根容器一一对应）到目标节点的 childNodes 索引链，每步带 nodeName。
 * old 值：WeakMap 记录每个节点会话开始时的原始值（首次修改时登记），保证后端旧值校验始终对准库内版本。
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
      '#cp-root{cursor:text;}#cp-root img,#cp-root iframe{cursor:pointer;}';
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
  /** 返回 {kind:'text', node} | {kind:'img'|'video', el} 或 null */
  function hitTarget(el) {
    var r = root();
    if (!r || !el || el === document.body || el === document.documentElement) return null;
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
    var popW = Math.min(480, window.innerWidth - 32);
    var left = Math.max(16, Math.min(rect.left, window.innerWidth - popW - 16));
    var top = rect.bottom + 10;
    if (top + pop.offsetHeight > window.scrollY + window.innerHeight - 16) {
      top = Math.max(window.scrollY + 16, rect.top - pop.offsetHeight - 10);
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

  function editVideo(iframeEl) {
    var original = origOf(iframeEl, iframeEl.getAttribute('src'));
    openPop(iframeEl,
      '<div class="cp-pop-title">🎬 修改视频链接</div>' +
      '<input type="text" class="cp-input" id="cp-edit-video" placeholder="粘贴 YouTube 链接或视频 ID，如 https://www.youtube.com/watch?v=xxxx">' +
      '<div class="cp-hint">支持 watch / youtu.be / shorts 链接或直接粘贴 11 位视频 ID</div>' +
      '<div class="cp-btns"><button class="cp-ok">确定</button><button class="cp-cancel">取消</button></div>');
    var input = pop.querySelector('#cp-edit-video');
    input.value = original || '';
    input.focus();
    popActions(pop, function () {
      var raw = input.value.trim();
      var id = extractYoutubeId(raw);
      if (!id) { input.style.borderColor = '#C4004D'; input.placeholder = '无法识别，请粘贴完整的 YouTube 链接'; return false; }
      var embed = 'https://www.youtube.com/embed/' + id;
      var path = buildPath(iframeEl);
      if (!path) { alert('无法定位该视频，请刷新预览重试'); return false; }
      iframeEl.setAttribute('src', embed);
      send({ type: 'patch', patch: { kind: 'video', path: path, old: original, next: embed } });
    });
  }

  function extractYoutubeId(raw) {
    var s = (raw || '').trim();
    if (!s) return null;
    if (/^[A-Za-z0-9_-]{6,20}$/.test(s)) return s;
    var m = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/i.exec(s);
    return m ? m[1] : null;
  }

  // ---------- 事件接管 ----------
  document.addEventListener('mouseover', function (e) {
    var t = hitTarget(e.target);
    if (t) {
      var el = t.kind === 'text' ? (t.el.nodeType === 3 ? t.el.parentNode : t.el) : t.el;
      if (el && el !== pop) markHover(el, t.kind);
      else clearHover();
    } else clearHover();
  }, true);
  document.addEventListener('mouseout', function (e) { clearHover(); }, true);

  document.addEventListener('click', function (e) {
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
})();
