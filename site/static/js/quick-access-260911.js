/**
 * 快捷链接（quick-access）开关逻辑 v2 — 2026-09-11
 * 背景：
 *  1. 原站 Drupal 聚合 JS 的旧逻辑有缺陷：打开时延迟 500ms 给导航加 .open 类，
 *     body 任意点击会立即关闭；第二次点开按钮时残留的 .open 让菜单被瞬间关掉 → 卡死
 *  2. 部分页面（如药辅产品导览）没有加载聚合 JS，按钮完全无响应
 *  3. v2：按钮在 Vue 挂载点（#app）内，接口数据返回触发重渲染会把菜单 DOM 换成
 *     初始副本——v1 缓存的元素引用会变成游离节点导致"点击没反应"。
 *     改为每次点击实时查找当前节点；若菜单链接被重渲染清空则自动补加载。
 * 命名遵循公共 JS 规则：改动后需更新文件名日期并全站同步引用。
 */
(function () {
  'use strict';

  function reloadLinks(nav) {
    var box = nav.querySelector('#quickLinks');
    if (!box || box.children.length > 0) return; // 有内容就不用管
    if (window.jQuery) {
      window.jQuery(box).load('/quickLinks.html');
    } else {
      fetch('/quickLinks.html').then(function (r) { return r.text(); }).then(function (html) {
        box.innerHTML = html;
      }).catch(function () { /* 静默 */ });
    }
  }

  function init() {
    if (document.documentElement.dataset.qaBound) return;
    document.documentElement.dataset.qaBound = '1';

    document.addEventListener('click', function (e) {
      // 每次点击实时查找（Vue 重渲染可能已替换 DOM，禁止缓存引用）
      var nav = document.querySelector('.quick-access');
      if (!nav) return;

      if (nav.contains(e.target)) {
        // 拦截区域内点击：不让旧版 Drupal 逻辑（按钮直绑 + body 委托）收到事件
        e.stopPropagation();
        var menu = nav.querySelector('.quick-access__menu');
        if (!menu) return;
        var target = e.target;
        if (target.closest && target.closest('.js-close')) {
          menu.classList.remove('active');
          return;
        }
        if (target.closest && target.closest('.js-open')) {
          if (menu.classList.contains('active')) {
            menu.classList.remove('active');
          } else {
            menu.classList.add('active');
            reloadLinks(nav);
          }
          return;
        }
        // 菜单内部其他元素（链接等）：放行默认跳转
      } else {
        var openMenu = document.querySelector('.quick-access__menu.active');
        if (openMenu) openMenu.classList.remove('active');
      }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
