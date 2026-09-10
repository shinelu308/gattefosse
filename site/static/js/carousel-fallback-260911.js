/**
 * 轮播兜底初始化 — 2026-09-11
 * 背景：原站 Drupal 聚合 JS 的 behaviors 链中，某个 behavior 偶发抛错
 *（TypeError: Cannot read properties of null (reading 'content')，多与 header 异步加载时序有关）
 * 会中断后续 behavior 挂载，导致 key-figures / full-width-slider 的 slick 轮播间歇性不初始化，
 * 卡片被 flex 压扁成一排（CSR 页数字榜单问题）。
 * 本脚本在 window load 后延迟执行：若 slick 已初始化则跳过，否则按原站参数补一刀。
 * 命名遵循公共 JS 规则：改动后需更新文件名日期并同步引用页。
 */
(function () {
  'use strict';

  function init() {
    if (!window.jQuery || !window.jQuery.fn || !window.jQuery.fn.slick) return;
    var $ = window.jQuery;

    var $kf = $('.js-key-figure');
    if ($kf.length && !$kf.hasClass('slick-initialized')) {
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

    var $fw = $('.js-full-width-slider');
    if ($fw.length && !$fw.hasClass('slick-initialized')) {
      $fw.slick({
        accessibility: true,
        arrows: true,
        nextArrow: $fw.find('.js-slick-next'),
        prevArrow: $fw.find('.js-slick-prev'),
        appendDots: $fw.find('.js-slick-dots-wrapper'),
        dots: true,
        pauseOnHover: true,
        pauseOnDotsHover: true,
        slidesToShow: 1,
        slidesToScroll: 1,
        infinite: false,
        adaptiveHeight: true,
      });
    }
  }

  function schedule() {
    // 给 Drupal behaviors 优先执行的机会，只兜底未初始化的轮播
    setTimeout(init, 800);
    setTimeout(init, 2500);
  }

  if (document.readyState === 'complete') {
    schedule();
  } else {
    window.addEventListener('load', schedule);
  }
})();
