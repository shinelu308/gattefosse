/**
 * 内容浏览埋点 track-260912.js — 2026-09-12
 * ============================================================================
 * 作用：把「哪个产品 / 哪份资料 / 哪篇文章被看过」上报给后端 → content_views 表。
 *
 * 为什么不能靠现有 page_views：那里只记**去掉 query 的页面路径**，
 * 产品详情页 57 个产品全压成一条；资料（PDF）走静态直链更是完全收不到。
 *
 * 页面接入只需两件事：
 *   1. 页面里引本文件（放在 api-*.js 之后、Vue app 之前）
 *   2. 数据加载完成后调用一次（对象身份只有前端知道）：
 *        GatteTrack.view('pc_product', product.id, product.name, 'personal_care')
 *      type 取值：pc_product / formulation / pharma_product / article / news / event / document
 *      section 取值：personal_care / pharma / news / learn_more（不传则按路径推断）
 *
 * 资料（PDF）点击**无需改任何模板** —— 本文件用 document 级捕获委托监听，
 * 自动从链接取文件名、从最近容器取中文标题，并带上当前页对象作为归属。
 *
 * 命名遵循公共 JS 规则：改动后需更新文件名日期并全站同步引用。
 * 后端接口见 backend/src/controllers/track.controller.ts（含白名单与字段校验）。
 */
(function (global) {
  'use strict';

  var ENDPOINT = '/api/track/content';
  var FLUSH_DELAY = 700;   // 合并窗口：同一批事件攒一起发，减少请求数
  var MAX_BATCH = 20;      // 与后端 MAX_EVENTS 对齐
  var MAX_QUEUE = 60;      // 队列上限，页面异常刷事件时兜底

  var queue = [];
  var timer = null;
  var sentThisLoad = {};   // 同一次页面加载内同对象同事件只报一次（防止 Vue 重渲染重复调用）
  var pageCtx = null;      // 当前页对象身份，供资料点击继承

  /** 按路径推断板块（页面没显式传时的兜底） */
  function inferSection(p) {
    p = p || location.pathname;
    if (p.indexOf('/personal-care') === 0) return 'personal_care';
    if (p.indexOf('/pharmaceuticals') === 0) return 'pharma';
    if (p.indexOf('news') >= 0 || p.indexOf('/press') === 0) return 'news';
    if (p.indexOf('/learn-more') >= 0) return 'learn_more';
    return '';
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; flush(); }, FLUSH_DELAY);
  }

  /** 真正发送：优先 sendBeacon（页面卸载/跳转也能送出），失败回退 keepalive fetch */
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length) return;
    var batch = queue.splice(0, MAX_BATCH);
    var body;
    try {
      body = JSON.stringify({ path: location.pathname, events: batch });
    } catch (e) { return; }

    var ok = false;
    try {
      if (navigator.sendBeacon) {
        // Blob 显式标 application/json，后端 express.json 直接可解析
        ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      }
    } catch (e) { ok = false; }

    if (!ok) {
      try {
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true,
          credentials: 'same-origin'
        }).catch(function () { /* 静默：埋点失败绝不影响业务 */ });
      } catch (e) { /* 静默 */ }
    }

    if (queue.length) schedule(); // 超出一批的继续发
  }

  function push(ev) {
    if (!ev || !ev.type || !ev.id) return;
    var key = ev.type + '|' + ev.id + '|' + ev.event;
    if (sentThisLoad[key]) return;
    sentThisLoad[key] = 1;
    if (queue.length >= MAX_QUEUE) queue.shift();
    queue.push(ev);
    schedule();
  }

  // ==================== 资料（PDF 等）点击委托 ====================
  // 覆盖范围：产品详情页「技术文件 / 产品手册 / 配方资料」、出版物/手册下载等
  var DOC_EXT_RE = /\.(pdf|doc|docx|xls|xlsx|zip|ppt|pptx)(\?|#|$)/i;
  var DOC_BOX_SEL = '.block-files, #product-document, .s-product-document__list, .c-link--document, [data-gt-doc]';

  function isDocLink(a) {
    if (!a || !a.getAttribute) return false;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return false;
    if (DOC_EXT_RE.test(href)) return true;
    // 静态文件直链（如 /uploads/documents/xxx）没有扩展名时，靠容器 class 兜底
    if (a.closest && a.closest(DOC_BOX_SEL)) {
      return a.getAttribute('target') === '_blank' || href.indexOf('/uploads/') === 0 || href.indexOf('/sites/default/files/') === 0;
    }
    return false;
  }

  /** 从链接里取资料标识：优先 data-gt-doc / data-file-id，其次静态文件名 */
  function docId(a) {
    var explicit = a.getAttribute('data-gt-doc') || a.getAttribute('data-file-id') || a.getAttribute('data-doc-id');
    if (explicit) return String(explicit);
    var href = (a.getAttribute('href') || '').split('?')[0].split('#')[0];
    var seg = href.split('/').pop() || '';
    try { seg = decodeURIComponent(seg); } catch (e) { /* 保持原样 */ }
    // 去掉扩展名，让「同一份资料重新上传改名」不至于分裂成两条；中文名照收
    return seg.replace(/\.[A-Za-z0-9]{1,5}$/, '') || href || 'unknown';
  }

  /** 从链接里取资料展示名：优先显式属性 / 容器里的中文标题，其次 title 属性，最后链接文本 */
  function docName(a) {
    var explicit = a.getAttribute('data-gt-doc-name');
    if (explicit) return explicit;
    var box = a.querySelector ? a.querySelector('.c-link__name') : null;
    if (box && box.textContent.trim()) return box.textContent.trim();
    var parent = a.closest ? a.closest('.c-link') : null;
    if (parent) {
      var n = parent.querySelector('.c-link__name');
      if (n && n.textContent.trim()) return n.textContent.trim();
    }
    // title 属性常是卡片标题（如文章/出版物标题），比链接文本「下载 (.pdf)」有意义
    var ttl = a.getAttribute('title');
    if (ttl && ttl.trim()) return ttl.trim().slice(0, 120);
    var t = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 120);
    return '';
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var a = t && t.closest ? t.closest('a[href]') : null;
    if (!a || !isDocLink(a)) return;
    var section = (pageCtx && pageCtx.section) || inferSection();
    push({
      type: 'document',
      id: docId(a),
      name: docName(a),
      section: section,
      event: 'download',
      parentId: (pageCtx && pageCtx.id) || '',
      parentName: (pageCtx && pageCtx.name) || ''
    });
    flush(); // 资料大概率是新开页/下载，立即发送不等合并窗口
  }, true);

  // 页面隐藏时兜底发出剩余事件（移动端切后台可能不触发 unload）
  global.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });

  // ==================== 对外 API ====================
  global.GatteTrack = {
    /**
     * 打开详情页时上报（数据加载完成后调用，此时才知道对象名称）
     * @param {string} type    pc_product | formulation | pharma_product | article | news | event
     * @param {string|number} id   对象 id 或 slug
     * @param {string} name   对象名称（后端存快照，对象改名/删除后榜单仍可读）
     * @param {string} [section] personal_care | pharma | news | learn_more
     */
    view: function (type, id, name, section) {
      if (id === null || id === undefined || id === '') return;
      var sec = section || inferSection();
      pageCtx = { type: type, id: String(id), name: name || '', section: sec };
      push({ type: type, id: String(id), name: name || '', section: sec, event: 'view' });
    },
    /** 手动上报一次资料打开（自动委托覆盖不到时用） */
    doc: function (id, name, section, parentId, parentName) {
      if (id === null || id === undefined || id === '') return;
      push({
        type: 'document',
        id: String(id),
        name: name || '',
        section: section || (pageCtx && pageCtx.section) || inferSection(),
        event: 'download',
        parentId: parentId ? String(parentId) : ((pageCtx && pageCtx.id) || ''),
        parentName: parentName || (pageCtx && pageCtx.name) || ''
      });
      flush();
    },
    /** 立即发送（需要精确时序时用） */
    flush: flush
  };
})(window);
