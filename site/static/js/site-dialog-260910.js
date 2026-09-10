/**
 * SiteDialog — 前台统一系统弹框（替代浏览器原生 alert / confirm / prompt）
 *
 * 设计目标：前台是公开站点，弹框必须与品牌视觉一致，不能再出现浏览器原生弹窗。
 * 依赖：无（纯 DOM，不依赖 jQuery / Vue / Bootstrap）。
 *
 * 用法：
 *   SiteDialog.alert('请先登录', { type: 'warn' })                 // type: info|success|warn|error
 *   SiteDialog.alert('移除成功', { title: '提示', type: 'success' })
 *   const ok = await SiteDialog.confirm('确定清空购物车？', { danger: true, confirmText: '清空' })
 *   const v  = await SiteDialog.prompt('请输入备注：', { placeholder: '选填' })   // 取消返回 null
 *
 * 主题：默认品牌绿 #8EB73C；可用 SiteDialog.setAccent('#C4004D') 跟随页面主题色切换。
 */
(function (global) {
  'use strict';
  if (global.SiteDialog) return;

  var ACCENT = '#8EB73C';
  var ACCENT_DARK = '#7da332';

  /** 样式随 ACCENT 动态构建（setAccent 可切主题色） */
  function buildCss() {
    return [
      '.sdg-overlay{position:fixed;inset:0;background:rgba(35,36,38,.5);display:none;align-items:center;justify-content:center;',
      'z-index:10050;font-family:"Din Next Lt Pro Regular","Helvetica Neue",Helvetica,Arial,"Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased;',
      'padding:20px;box-sizing:border-box;}',
      '.sdg-overlay.is-open{display:flex;}',
      '.sdg-box{background:#fff;border-radius:6px;box-shadow:0 12px 40px rgba(0,0,0,.22);width:400px;max-width:100%;',
      'max-height:calc(100vh - 80px);overflow:auto;padding:28px 26px 22px;animation:sdgIn .18s ease;box-sizing:border-box;}',
      '@keyframes sdgIn{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:none;}}',
      '.sdg-icon{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;',
      'line-height:1;font-weight:700;color:#fff;margin:0 auto 16px;}',
      '.sdg-icon.info{background:#74797D;}.sdg-icon.success{background:' + ACCENT + ';}',
      '.sdg-icon.warn{background:#E6A23C;}.sdg-icon.error{background:#D9534F;}',
      '.sdg-title{text-align:center;font-size:17px;font-weight:700;color:#232426;margin:0 0 8px;letter-spacing:.02em;}',
      '.sdg-msg{text-align:center;font-size:14px;line-height:1.75;color:#55595D;margin:0 0 22px;white-space:pre-line;word-break:break-word;}',
      '.sdg-msg:last-child{margin-bottom:0;}',
      '.sdg-input{width:100%;box-sizing:border-box;border:1px solid #DCDFE2;border-radius:4px;padding:10px 12px;font-size:14px;',
      'margin:0 0 20px;outline:none;font-family:inherit;color:#232426;}',
      '.sdg-input:focus{border-color:' + ACCENT + ';box-shadow:0 0 0 2px rgba(142,183,60,.18);}',
      '.sdg-btns{display:flex;gap:12px;justify-content:center;}',
      '.sdg-btn{flex:1;min-width:0;padding:11px 18px;border-radius:3px;border:1px solid transparent;font-size:14px;cursor:pointer;',
      'transition:background-color .15s,border-color .15s,color .15s;font-family:inherit;letter-spacing:.02em;}',
      '.sdg-btn:focus-visible{outline:2px solid ' + ACCENT + ';outline-offset:2px;}',
      '.sdg-btn-outline{background:#fff;border-color:#C9CDD1;color:#55595D;}',
      '.sdg-btn-outline:hover{background:#F5F6F7;border-color:#A9AFB4;}',
      '.sdg-btn-primary{background:' + ACCENT + ';color:#fff;}',
      '.sdg-btn-primary:hover{background:' + ACCENT_DARK + ';}',
      '.sdg-btn-danger{background:#D9534F;color:#fff;}',
      '.sdg-btn-danger:hover{background:#c9433f;}',
      '.sdg-spinner{width:38px;height:38px;border:4px solid #E8EFDA;border-top-color:' + ACCENT + ';border-radius:50%;',
      'margin:0 auto 16px;animation:sdgSpin .8s linear infinite;}@keyframes sdgSpin{to{transform:rotate(360deg);}}'
    ].join('');
  }

  var overlay, iconEl, titleEl, msgEl, inputEl, btnsEl, primaryBtn, styleEl;
  var current = null;       // { resolve, kind }
  var downOnOverlay = false;

  function ensure() {
    if (overlay) return;
    styleEl = document.createElement('style');
    styleEl.setAttribute('data-site-dialog', '1');
    styleEl.textContent = buildCss();
    document.head.appendChild(styleEl);

    overlay = document.createElement('div');
    overlay.className = 'sdg-overlay';
    overlay.innerHTML =
      '<div class="sdg-box" role="dialog" aria-modal="true">' +
        '<div class="sdg-icon"></div>' +
        '<h3 class="sdg-title"></h3>' +
        '<p class="sdg-msg"></p>' +
        '<input class="sdg-input" style="display:none">' +
        '<div class="sdg-btns"></div>' +
      '</div>';
    document.body.appendChild(overlay);

    iconEl = overlay.querySelector('.sdg-icon');
    titleEl = overlay.querySelector('.sdg-title');
    msgEl = overlay.querySelector('.sdg-msg');
    inputEl = overlay.querySelector('.sdg-input');
    btnsEl = overlay.querySelector('.sdg-btns');

    // 拖选文字时鼠标松开落在遮罩上不关窗
    overlay.addEventListener('mousedown', function (e) {
      downOnOverlay = e.target === overlay;
    });
    overlay.addEventListener('click', function (e) {
      if (downOnOverlay && e.target === overlay) cancelByOverlay();
    });
    document.addEventListener('keydown', function (e) {
      if (!overlay.classList.contains('is-open') || !current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelByOverlay();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (primaryBtn) primaryBtn.click();
      }
    });
  }

  function cancelByOverlay() {
    if (!current) return;
    if (current.kind === 'prompt') close(null);
    else if (current.kind === 'confirm') close(false);
    else close(true);
  }

  function open(opts) {
    ensure();
    return new Promise(function (resolve) {
      current = { resolve: resolve, kind: opts.kind || 'alert' };
      iconEl.className = 'sdg-icon ' + (opts.type || 'info');
      iconEl.textContent = opts.iconText || '';
      titleEl.textContent = opts.title || '';
      titleEl.style.display = opts.title ? '' : 'none';
      msgEl.textContent = opts.message || '';
      msgEl.style.display = opts.message ? '' : 'none';
      inputEl.style.display = opts.input ? 'block' : 'none';
      if (opts.input) {
        inputEl.value = opts.defaultValue || '';
        inputEl.placeholder = opts.placeholder || '';
      }

      btnsEl.innerHTML = '';
      var btns = [];
      if (opts.cancelText !== null) {
        btns.push({ text: opts.cancelText || '取消', cls: 'sdg-btn-outline', value: false });
      }
      btns.push({
        text: opts.confirmText || '确定',
        cls: opts.danger ? 'sdg-btn-danger' : 'sdg-btn-primary',
        value: true
      });

      primaryBtn = null;
      btns.forEach(function (b) {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'sdg-btn ' + b.cls;
        el.textContent = b.text;
        el.addEventListener('click', function () { close(b.value); });
        btnsEl.appendChild(el);
        if (b.value === true) primaryBtn = el;
      });

      overlay.classList.add('is-open');
      downOnOverlay = false;
      setTimeout(function () {
        var focusEl = opts.input ? inputEl : primaryBtn;
        if (focusEl && focusEl.focus) focusEl.focus();
      }, 30);
    });
  }

  function close(value) {
    if (!current) return;
    var kind = current.kind;
    var resolve = current.resolve;
    current = null;
    overlay.classList.remove('is-open');
    var out = value;
    if (kind === 'prompt') out = value === true ? inputEl.value : null;
    if (resolve) resolve(out);
  }

  var ICON_TEXT = { success: '✓', error: '✕', warn: '!', info: 'i' };

  global.SiteDialog = {
    /** 提示框：SiteDialog.alert(msg, { title, type }) — type: info|success|warn|error */
    alert: function (msg, o) {
      o = o || {};
      var type = o.type || 'info';
      return open({
        kind: 'alert',
        message: msg == null ? '' : String(msg),
        title: o.title || '提示',
        type: type,
        iconText: ICON_TEXT[type] || ICON_TEXT.info,
        cancelText: null,
        confirmText: o.confirmText || '确定'
      });
    },
    /** 确认框：const ok = await SiteDialog.confirm(msg, { title, danger, confirmText }) */
    confirm: function (msg, o) {
      o = o || {};
      return open({
        kind: 'confirm',
        message: msg == null ? '' : String(msg),
        title: o.title || '确认操作',
        type: o.danger ? 'error' : 'warn',
        iconText: o.danger ? '✕' : '?',
        cancelText: o.cancelText === undefined ? '取消' : o.cancelText,
        confirmText: o.confirmText || '确定',
        danger: !!o.danger
      });
    },
    /** 输入框：const v = await SiteDialog.prompt(msg, { placeholder, defaultValue }) — 取消返回 null */
    prompt: function (msg, o) {
      o = o || {};
      return open({
        kind: 'prompt',
        message: msg == null ? '' : String(msg),
        title: o.title || '请输入',
        type: 'info',
        iconText: 'i',
        input: true,
        defaultValue: o.defaultValue || '',
        placeholder: o.placeholder || '',
        cancelText: '取消',
        confirmText: o.confirmText || '确定'
      });
    },
    /** 跟随页面主题色（如个人护理页红色 #C4004D、药用页蓝色 #0075BB） */
    setAccent: function (color) {
      if (!color) return;
      ACCENT = color;
      ACCENT_DARK = color;
      if (styleEl) styleEl.textContent = buildCss();
    }
  };

  // 兜底快捷方法：把漏网的浏览器原生弹窗接到系统弹框上
  global.siteAlert = function (msg) { return global.SiteDialog.alert(msg); };
  global.siteConfirm = function (msg) { return global.SiteDialog.confirm(msg); };
})(window);
