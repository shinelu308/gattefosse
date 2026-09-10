/**
 * 快捷链接（quick-access）开关逻辑 — 2026-09-11
 * 背景：
 *  1. 原站 Drupal 聚合 JS 的旧逻辑有缺陷：打开时延迟 500ms 给导航加 .open 类，
 *     body 任意点击会立即关闭；第二次点开按钮时残留的 .open 让菜单被瞬间关掉 → 卡死
 *  2. 部分页面（如药辅产品导览）没有加载聚合 JS，按钮完全无响应
 * 本脚本在捕获阶段统一接管快捷链接区域内的点击，屏蔽旧逻辑，实现干净的开/关/点外关闭。
 * 命名遵循公共 JS 规则：改动后需更新文件名日期并全站同步引用。
 */
(function () {
  'use strict';

  function init() {
    var nav = document.querySelector('.quick-access');
    if (!nav || nav.dataset.qaBound) return;
    nav.dataset.qaBound = '1';
    var menu = nav.querySelector('.quick-access__menu');
    if (!menu) return;

    function isOpen() { return menu.classList.contains('active'); }

    document.addEventListener('click', function (e) {
      if (nav.contains(e.target)) {
        // 拦截区域内点击：不让旧版 Drupal 逻辑（按钮直绑 + body 委托）收到事件
        e.stopPropagation();
        var target = e.target;
        if (target.closest && target.closest('.js-close')) {
          menu.classList.remove('active');
          return;
        }
        if (target.closest && target.closest('.js-open')) {
          if (isOpen()) {
            menu.classList.remove('active');
          } else {
            menu.classList.add('active');
          }
          return;
        }
        // 菜单内部其他元素（链接等）：放行默认跳转
      } else if (isOpen()) {
        // 点击页面其他区域：关闭菜单
        menu.classList.remove('active');
      }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
