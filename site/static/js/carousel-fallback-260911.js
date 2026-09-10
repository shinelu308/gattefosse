/**
 * 轮播兜底初始化 v3 — 2026-09-11
 * 两个根因：
 *  1. 原站 Drupal behaviors 链偶发抛错中断，slick 轮播不被初始化（卡片压扁/无圆点）
 *  2. Vue（#app 挂在 main 上）在接口数据返回后重新渲染，会把 slick 生成的
 *     圆点/箭头等"Vue 不认识的 DOM"还原成初始副本——特征是 slick-initialized/
 *     slick-dotted 类还在，但 .slick-dots 元素消失（间歇性，取决于接口返回时机）
 * v3 策略：轮询检测「类在但 DOM 被擦」的状态，先 unslick 复原再重新初始化；
 * 单轮播失败不影响另一个；最多轮询 40 次 × 600ms。
 * 命名遵循公共 JS 规则：改动后需更新文件名日期并同步引用页。
 */
(function () {
  'use strict';

  var MAX_TRIES = 40;
  var INTERVAL = 600;
  var tries = 0;

  function kfHealthy(el) {
    return el.className.indexOf('slick-initialized') !== -1 &&
      el.querySelectorAll('.slick-slide').length > 0;
  }
  function fwHealthy(el) {
    return el.className.indexOf('slick-initialized') !== -1 &&
      el.className.indexOf('slick-dotted') !== -1 &&
      el.parentElement.querySelectorAll('.js-slick-dots-wrapper .slick-dots li').length > 0;
  }

  function kfDone() {
    var el = document.querySelector('.js-key-figure');
    return !el || kfHealthy(el);
  }
  function fwDone() {
    var el = document.querySelector('.js-full-width-slider');
    if (!el) return true;
    // slick-dotted 在但圆点被 Vue 擦掉 → 视为未完成，需要修复
    return fwHealthy(el);
  }

  function refreshIfWiped(el) {
    // 类还在但 slick 生成的 DOM 被外层框架擦除：先 unslick 复原，稍后重新初始化
    if (el.className.indexOf('slick-initialized') !== -1 && !window.jQuery) return;
    try { window.jQuery(el).slick('unslick'); } catch (e) { /* 忽略 */ }
  }

  function initKeyFigures($) {
    var $kf = $('.js-key-figure');
    if (!$kf.length || $kf.hasClass('slick-initialized')) return;
    var hasSummary = $('.node--type-page').hasClass('has-summary');
    $kf.slick({
      accessibility: true,
      dots: false,
      arrows: true,
      slidesToShow: hasSummary ? 2 : 3,
      slidesToScroll: 1,
      variableWidth: true,
      infinite: false,
      responsive: [
        { breakpoint: 1200, settings: { slidesToShow: 2 } },
        { breakpoint: 768, settings: { arrows: false, slidesToShow: 1 } },
      ],
    });
  }

  function initFullWidthSlider($) {
    var $fw = $('.js-full-width-slider');
    if (!$fw.length || $fw.hasClass('slick-initialized')) return;
    // 注意：箭头按钮与圆点容器是 .js-full-width-slider 的兄弟节点（在其外的 .slick-controls 里），
    // 必须全局查找，不能用 $fw.find()（会拿到空集合导致 slick 初始化不完整）
    $fw.slick({
      accessibility: true,
      arrows: true,
      nextArrow: $('.js-slick-next').length ? $('.js-slick-next') : undefined,
      prevArrow: $('.js-slick-prev').length ? $('.js-slick-prev') : undefined,
      appendDots: $('.js-slick-dots-wrapper').length ? $('.js-slick-dots-wrapper') : undefined,
      dots: true,
      pauseOnHover: true,
      pauseOnDotsHover: true,
      slidesToShow: 1,
      slidesToScroll: 1,
      infinite: false,
      adaptiveHeight: true,
    });
  }

  function tick() {
    tries++;
    if (kfDone() && fwDone()) return; // 全部健康，停止轮询
    if (!window.jQuery || !window.jQuery.fn || !window.jQuery.fn.slick) {
      if (tries < MAX_TRIES) setTimeout(tick, INTERVAL);
      return;
    }
    var $ = window.jQuery;
    var kfEl = document.querySelector('.js-key-figure');
    var fwEl = document.querySelector('.js-full-width-slider');
    // 被框架擦除的：先 unslick 复原，本轮末尾再重新初始化
    if (kfEl && !kfHealthy(kfEl) && kfEl.className.indexOf('slick-initialized') !== -1) refreshIfWiped(kfEl);
    if (fwEl && !fwHealthy(fwEl) && fwEl.className.indexOf('slick-initialized') !== -1) refreshIfWiped(fwEl);
    try { initKeyFigures($); } catch (e) { /* 下一轮重试 */ }
    try { initFullWidthSlider($); } catch (e) { /* 下一轮重试 */ }
    if (tries < MAX_TRIES && !(kfDone() && fwDone())) setTimeout(tick, INTERVAL);
  }

  function schedule() {
    // 给 Drupal behaviors 与 Vue 首次渲染优先执行的机会，仅兜底异常状态
    setTimeout(tick, 800);
  }

  if (document.readyState === 'complete') {
    schedule();
  } else {
    window.addEventListener('load', schedule);
  }
})();
