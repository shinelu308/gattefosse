/**
 * 嘉法狮前端认证模块
 * 替代旧的 checkLoginStatus() 硬编码逻辑
 * 使用 JWT Token 实现真实登录状态管理
 */

(function (global) {
  'use strict';

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
        localStorage.setItem('isLoggedIn', 'false');
        return false;
      }
      localStorage.setItem('isLoggedIn', 'true');
      return true;
    } catch (e) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
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
  }

  /**
   * 登出
   */
  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
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
      var badge = document.querySelector('.cart-count-badge, .header__cart-count');
      if (badge) badge.textContent = '0';
      return;
    }
    GatteAPI.Cart.count().then(function (res) {
      var count = res.data.count || 0;
      var badge = document.querySelector('.cart-count-badge, .header__cart-count');
      if (badge) badge.textContent = count;
      // 也更新全局变量
      if (typeof window.updateHeaderCartCount === 'function') {
        window.updateHeaderCartCount(count);
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
