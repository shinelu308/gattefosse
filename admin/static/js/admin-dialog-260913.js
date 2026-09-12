/**
 * AdminDialog — 后台统一系统弹框（替代浏览器原生 alert/confirm/prompt）
 * 260913：同源 iframe 子页内自动 teleport 到父窗口 —— 遮罩盖满整个后台窗口、弹框全屏居中；
 *         父页面（index.html）或直接打开子页时行为不变。
 * 用法：
 *   await AdminDialog.alert('保存成功', { type: 'success' })            // type: info|success|warn|error
 *   const ok = await AdminDialog.confirm('确定删除？', { danger: true, confirmText: '删除' })
 *   const pwd = await AdminDialog.prompt('请输入新密码：', { placeholder: '至少 6 位' })  // 取消返回 null
 */
(function () {
  if (window.AdminDialog) return;
  // 机器人动效素材（2026-09-11）：/admin/static/video/robots/{importer,translator,editor,publisher}.mp4
  var BOT_DIR = '/admin/static/video/robots/';
  var BOT_KEYS = { importer: 1, translator: 1, editor: 1, publisher: 1 };

  // 宿主文档（260913）：本页经同源 iframe 嵌入后台时挂到父窗口，
  // position:fixed 相对父窗口生效 → 遮罩盖满全屏、弹框真正全屏居中
  var HOST = (function () {
    try {
      if (window.parent !== window && window.parent.document && window.parent.document.body) {
        return window.parent.document;
      }
    } catch (e) { /* 跨域时退回自身文档 */ }
    return document;
  })();
  var TELEPORTED = HOST !== document;

  var CSS = [
    '.adlg-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:10000;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,"Microsoft YaHei",sans-serif;}',
    '.adlg-overlay.is-open{display:flex;}',
    '.adlg-box{background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18);width:400px;max-width:calc(100vw - 40px);',
    'max-height:calc(100vh - 60px);overflow:auto;padding:24px;animation:adlgIn .18s ease;box-sizing:border-box;}',
    '@keyframes adlgIn{from{opacity:0;transform:translateY(10px) scale(.97);}to{opacity:1;transform:none;}}',
    '.adlg-icon{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;',
    'font-weight:700;color:#fff;margin:0 auto 14px;}',
    '.adlg-icon.info{background:#5B9BD5;}.adlg-icon.success{background:#8EB73C;}.adlg-icon.warn{background:#E6A23C;}.adlg-icon.error{background:#D9534F;}',
    '.adlg-title{text-align:center;font-size:16px;font-weight:600;color:#232426;margin:0 0 8px;}',
    '.adlg-msg{text-align:center;font-size:13.5px;line-height:1.65;color:#555;margin:0 0 20px;white-space:pre-line;word-break:break-word;}',
    '.adlg-msg:empty{display:none;margin:0 0 18px;}',
    '.adlg-input{width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:8px;padding:9px 12px;font-size:14px;',
    'margin:0 0 18px;outline:none;font-family:inherit;}',
    '.adlg-input:focus{border-color:#8EB73C;box-shadow:0 0 0 2px rgba(142,183,60,.15);}',
    '.adlg-btns{display:flex;gap:10px;justify-content:center;}',
    '.adlg-btn{flex:1;padding:9px 16px;border-radius:8px;border:1px solid transparent;font-size:14px;cursor:pointer;',
    'transition:all .15s;font-family:inherit;}',
    '.adlg-btn-outline{background:#fff;border-color:#ddd;color:#555;}',
    '.adlg-btn-outline:hover{background:#f5f6f7;}',
    '.adlg-btn-primary{background:#8EB73C;color:#fff;}',
    '.adlg-btn-primary:hover{background:#7da332;}',
    '.adlg-btn-danger{background:#D9534F;color:#fff;}',
    '.adlg-btn-danger:hover{background:#c9433f;}'
  ].join('');

  var overlay, iconEl, titleEl, msgEl, inputEl, btnsEl, primaryBtn;
  var current = null;      // { resolve, kind }
  var downOnOverlay = false;

  function ensure() {
    if (overlay) return;
    var st = HOST.createElement('style');
    st.textContent = CSS;
    HOST.head.appendChild(st);
    overlay = HOST.createElement('div');
    overlay.className = 'adlg-overlay';
    if (TELEPORTED) overlay.setAttribute('data-adlg-host', '1');
    overlay.innerHTML =
      '<div class="adlg-box" role="dialog" aria-modal="true">' +
        '<div class="adlg-icon"></div>' +
        '<h3 class="adlg-title"></h3>' +
        '<p class="adlg-msg"></p>' +
        '<input class="adlg-input" style="display:none">' +
        '<div class="adlg-btns"></div>' +
      '</div>';
    HOST.body.appendChild(overlay);
    iconEl = overlay.querySelector('.adlg-icon');
    titleEl = overlay.querySelector('.adlg-title');
    msgEl = overlay.querySelector('.adlg-msg');
    inputEl = overlay.querySelector('.adlg-input');
    btnsEl = overlay.querySelector('.adlg-btns');
    // 拖选文字时 mouseup 落在遮罩上不关窗（与后台其它弹窗同规则）
    overlay.addEventListener('mousedown', function (e) {
      downOnOverlay = e.target === overlay;
    });
    overlay.addEventListener('click', function (e) {
      if (downOnOverlay && e.target === overlay) cancelByOverlay();
    });
    // 键盘事件两个文档都挂：teleport 后焦点可能留在 iframe 内元素或落在父文档弹框上；
    // close/cancelByOverlay 内部有 current 判空，重复触发幂等
    function onKey(e) {
      if (!overlay || !overlay.classList.contains('is-open') || !current) return;
      if (e.key === 'Escape') { e.preventDefault(); cancelByOverlay(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (primaryBtn) primaryBtn.click(); }
    }
    document.addEventListener('keydown', onKey);
    if (TELEPORTED) HOST.addEventListener('keydown', onKey);
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
      iconEl.className = 'adlg-icon ' + (opts.iconClass || 'info');
      iconEl.textContent = opts.iconText || 'i';
      titleEl.textContent = opts.title || '';
      titleEl.style.display = opts.title ? '' : 'none';
      msgEl.textContent = opts.message || '';
      inputEl.style.display = opts.input ? 'block' : 'none';
      if (opts.input) {
        inputEl.value = opts.defaultValue || '';
        inputEl.placeholder = opts.placeholder || '';
      }
      btnsEl.innerHTML = '';
      var btns = [];
      if (opts.cancelText !== null) {
        btns.push({ text: opts.cancelText || '取消', cls: 'adlg-btn-outline', value: null });
      }
      btns.push({ text: opts.confirmText || '确认', cls: opts.danger ? 'adlg-btn-danger' : 'adlg-btn-primary', value: true });
      primaryBtn = null;
      btns.forEach(function (b) {
        var el = HOST.createElement('button');
        el.className = 'adlg-btn ' + b.cls;
        el.type = 'button';
        el.textContent = b.text;
        el.addEventListener('click', function () { close(b.value); });
        btnsEl.appendChild(el);
        if (b.value === true) primaryBtn = el;
      });
      overlay.classList.add('is-open');
      downOnOverlay = false;
      setTimeout(function () { (opts.input ? inputEl : primaryBtn).focus(); }, 30);
    });
  }

  function close(value) {
    if (!current) return;
    overlay.classList.remove('is-open');
    var r = current.resolve;
    current = null;
    if (r) r(value);
  }

  var ICONS = { success: '✓', error: '✕', warn: '!', info: 'i' };

  window.AdminDialog = {
    /** 提示框：AdminDialog.alert(msg, { title, type }) — type: info|success|warn|error */
    alert: function (msg, o) {
      o = o || {};
      var type = o.type || 'info';
      return open({
        kind: 'alert',
        message: msg == null ? '' : String(msg),
        title: o.title || '提示',
        iconClass: type,
        iconText: ICONS[type],
        cancelText: null,
        confirmText: '确认'
      });
    },
    /** 确认框：const ok = await AdminDialog.confirm(msg, { title, danger, confirmText }) */
    confirm: function (msg, o) {
      o = o || {};
      return open({
        kind: 'confirm',
        message: msg == null ? '' : String(msg),
        title: o.title || '确认操作',
        iconClass: o.danger ? 'error' : 'warn',
        iconText: o.danger ? '✕' : '?',
        cancelText: '取消',
        confirmText: o.confirmText || '确认',
        danger: !!o.danger
      });
    },
    /** 输入框：const v = await AdminDialog.prompt(msg, { title, placeholder, defaultValue }) — 取消返回 null */
    prompt: function (msg, o) {
      o = o || {};
      return open({
        kind: 'prompt',
        message: msg == null ? '' : String(msg),
        title: o.title || '请输入',
        iconClass: 'info',
        iconText: 'i',
        input: true,
        defaultValue: o.defaultValue || '',
        placeholder: o.placeholder || '',
        cancelText: '取消',
        confirmText: o.confirmText || '确认'
      });
    },
    /** 进度面板（长任务轮询用）：const p = AdminDialog.progress('标题', 'translator'); p.update('文字'); p.close();
     *  bot 可选：importer / translator / editor / publisher（2026-09-11）
     *  传入则用对应机器人循环动效替代转圈，让「谁在干活」一眼可见 */
    progress: function (title, bot) {
      ensure();
      if (bot && !BOT_KEYS[bot]) bot = null;
      var el = HOST.createElement('div');
      el.className = 'adlg-overlay is-open';
      if (TELEPORTED) el.setAttribute('data-adlg-host', '1');
      var head = bot
        ? '<span class="adlg-bot ' + bot + '"><video src="' + BOT_DIR + bot + '.mp4"' +
          ' autoplay muted loop playsinline preload="auto"></video></span>'
        : '<div class="adlg-spinner"></div>';
      el.innerHTML =
        '<div class="adlg-box" style="width:360px;text-align:center;">' +
          head +
          '<h3 class="adlg-title" style="margin-bottom:6px;"></h3>' +
          '<p class="adlg-msg" style="margin:0;" ></p>' +
        '</div>';
      el.querySelector('.adlg-title').textContent = title || '处理中…';
      var msgEl = el.querySelector('.adlg-msg');
      HOST.body.appendChild(el);
      return {
        update: function (msg) { if (msgEl) msgEl.textContent = msg || ''; },
        close: function () { if (el && el.parentNode) el.parentNode.removeChild(el); el = null; msgEl = null; }
      };
    }
  };

  // 进度圈 / 机器人动效样式（与弹框同套注入，6 个后台页面共用）
  var progStyle = HOST.createElement('style');
  progStyle.textContent =
    '.adlg-spinner{width:36px;height:36px;border:4px solid #e8efda;border-top-color:#8EB73C;border-radius:50%;' +
    'margin:0 auto 14px;animation:adlgSpin .8s linear infinite;}@keyframes adlgSpin{to{transform:rotate(360deg);}}' +
    /* 机器人动效（2026-09-11）：素材 480×480 / 无 alpha，背景 #F2F3EE。
       圆形裁切 + 各机位不同放大值，与后台 .bot-v 组件同规则 */
    '.adlg-bot{position:relative;display:block;width:64px;height:64px;margin:0 auto 14px;border-radius:50%;' +
    'overflow:hidden;background:#F2F3EE;box-shadow:0 0 0 3px #E3EED0;}' +
    '.adlg-bot>video{position:absolute;left:50%;top:50%;width:100%;height:100%;' +
    'transform:translate(-50%,-50%) scale(1.34);object-fit:cover;}' +
    '.adlg-bot.importer>video{transform:translate(-50%,-50%) scale(1.30);}' +
    '.adlg-bot.translator>video{transform:translate(-50%,-50%) scale(1.42);}' +
    '.adlg-bot.editor>video{transform:translate(-50%,-50%) scale(1.30);}' +
    '.adlg-bot.publisher>video{transform:translate(-50%,-50%) scale(1.36);}';
  HOST.head.appendChild(progStyle);

  // 卸载兜底（260913）：iframe 子页内弹框开着时切菜单，宿主（父窗口）不能残留死弹框
  if (TELEPORTED) {
    window.addEventListener('pagehide', function () {
      try {
        var orphan = HOST.querySelectorAll('[data-adlg-host]');
        for (var i = 0; i < orphan.length; i++) orphan[i].parentNode.removeChild(orphan[i]);
      } catch (e) {}
    });
  }
})();
