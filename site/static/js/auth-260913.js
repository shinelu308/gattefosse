/**
 * 嘉法狮前端认证模块
 * 替代旧的 checkLoginStatus() 硬编码逻辑
 * 使用 JWT Token 实现真实登录状态管理
 * 260913：登录态真相源改为 session cookie site_token —— 关闭浏览器后自动登出（用户安全要求）。
 *         localStorage 仅作同会话内的读写缓存：浏览器新会话（cookie 已消失）时清除全部本地登录残留。
 */

(function (global) {
  'use strict';

  // ---------- session cookie 工具（260913） ----------
  // 不设 expires/max-age = 会话级 cookie：浏览器关闭即清除；同域所有标签页共享
  function readSessionCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function writeSessionCookie(name, value) {
    document.cookie = name + '=' + encodeURIComponent(value) + '; path=/; SameSite=Lax';
  }
  function clearSessionCookie(name) {
    document.cookie = name + '=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
  }

  // 浏览器新会话（site_token 已随浏览器关闭消失）但 localStorage 还留着上次登录 → 全部清除，强制重新登录
  (function enforceSessionScope() {
    if (readSessionCookie('site_token')) return;
    var hadToken = localStorage.getItem('token') || localStorage.getItem('_token');
    var hadFlag = localStorage.getItem('isLoggedIn') === 'true';
    if (hadToken || hadFlag) {
      var KEYS = ['token', '_token', 'user', 'userId', 'userid', 'username', 'nickname', 'userEnabled'];
      for (var i = 0; i < KEYS.length; i++) localStorage.removeItem(KEYS[i]);
      localStorage.setItem('isLoggedIn', 'false');
    }
  })();

  /**
   * 检查登录状态 — 从 localStorage 读取 token 并验证
   * 返回: true (已登录) / false (未登录)
   */
  function checkLoginStatus() {
    var token = localStorage.getItem('token');
    if (!token) {
      localStorage.setItem('isLoggedIn', 'false');
      return false;
    }
    // 简单检查 token 存在且未过期（JWT payload 中有 exp）
    try {
      var payload = JSON.parse(atob(token.split('.')[1]));
      var now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        // Token 已过期
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        clearSessionCookie('site_token');
        localStorage.setItem('isLoggedIn', 'false');
        return false;
      }
      localStorage.setItem('isLoggedIn', 'true');
      return true;
    } catch (e) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      clearSessionCookie('site_token');
      localStorage.setItem('isLoggedIn', 'false');
      return false;
    }
  }

  /**
   * 获取当前登录用户信息
   */
  function getCurrentUser() {
    var userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  /**
   * 保存登录信息
   */
  function saveLogin(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('userEnabled', user.status === 'active' ? '1' : '0');
    // 会话真相源：session cookie，关浏览器即登出（260913）
    writeSessionCookie('site_token', token);
  }

  /**
   * 登出
   */
  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    clearSessionCookie('site_token');
    localStorage.setItem('isLoggedIn', 'false');
    localStorage.setItem('userEnabled', '0');
    window.location.href = '/';
  }

  /**
   * 处理登录表单提交
   */
  function handleLogin(email, password) {
    return GatteAPI.Auth.login(email, password).then(function (res) {
      saveLogin(res.data.token, res.data.user);
      return res.data;
    });
  }

  /**
   * 处理注册表单提交
   */
  function handleRegister(formData) {
    return GatteAPI.Auth.register(formData).then(function (res) {
      return res.data;
    });
  }

  /**
   * 刷新用户信息
   */
  function refreshUserInfo() {
    if (!checkLoginStatus()) return Promise.reject(new Error('未登录'));
    return GatteAPI.Auth.me().then(function (res) {
      localStorage.setItem('user', JSON.stringify(res.data));
      localStorage.setItem('userEnabled', res.data.status === 'active' ? '1' : '0');
      return res.data;
    });
  }

  /**
   * 获取购物车数量并更新 header
   */
  function updateCartCount() {
    if (!checkLoginStatus()) {
      var badge = document.querySelector('.cart-count-badge, .header__cart-count, #cartNum');
      if (badge) { badge.textContent = ''; badge.style.visibility = 'hidden'; }
      return;
    }
    GatteAPI.Cart.count().then(function (res) {
      // 拦截器解包后业务数据在 res.data = {count}
      var count = (res.data && res.data.count) || 0;
      var badge = document.querySelector('.cart-count-badge, .header__cart-count, #cartNum');
      if (badge) {
        badge.textContent = count > 0 ? count : '';
        badge.style.visibility = count > 0 ? 'visible' : 'hidden';
      }
      // 同步 header 里的 jQuery 注入版本
      if (typeof window.jQuery !== 'undefined') {
        window.jQuery('#cartNum').html(count > 0 ? count : '').css('visibility', count > 0 ? 'visible' : 'hidden');
      }
    }).catch(function () {
      // 静默失败
    });
  }

  // 导出到全局
  global.checkLoginStatus = checkLoginStatus;
  global.getCurrentUser = getCurrentUser;
  global.saveLogin = saveLogin;
  global.logout = logout;
  global.handleLogin = handleLogin;
  global.handleRegister = handleRegister;
  global.refreshUserInfo = refreshUserInfo;
  global.updateCartCount = updateCartCount;

})(window);
