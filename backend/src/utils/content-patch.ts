/**
 * 正文内容补丁回填（2026-09-11 预览式原位编辑）
 * 背景：原站导入文章的 contentHtml 锁定为源码模式防止版式破坏，小白用户改文字/图片/视频困难。
 * 方案：后台预览编辑器只产出四类「补丁」（文本节点 / img src / 视频iframe src / a href），
 *       本模块用 jsdom 解析 contentHtml 后按路径定位原位回填——class/结构/属性一个不动，
 *       版式 100% 保真（与 ai-translate 的 translateHtml 同一 DOM 级回填技术路线）。
 *
 * 路径定位：path 是从 contentHtml 根到目标节点的 childNodes 索引链，每步带期望 nodeName
 * （元素大写如 DIV/P/IMG，文本节点为 #text）。浏览器（预览端）与 jsdom（回填端）对规整
 * HTML 的 childNodes 序列一致；回填时逐步校验 nodeName，且旧值不匹配即拒绝，防止错位写入。
 * ⚠️ jsdom 锁死 25.0.1（27+ ESM-only，服务器 Node 20.18 会崩），见 ai-translate.ts
 */
import { JSDOM } from 'jsdom';

export interface PatchPathStep {
  /** childNodes 索引 */
  i: number;
  /** 期望 nodeName（元素大写 / #text） */
  tag: string;
}

export interface ContentPatch {
  type: 'text' | 'img' | 'video' | 'link';
  path: PatchPathStep[];
  /** 旧值：text=文本节点全文；img=img 的 src 属性；video=视频 iframe / source 的 src 属性（用于防错位校验） */
  old: string;
  /** 新值：text=新文本；img=新图片地址（/uploads/...）；video=新播放地址（平台 embed 或视频文件直链）；
   *        link=新链接地址（留空串表示删除 href、取消该链接） */
  next: string;
}

/** 空白折叠对比（DOM 文本值与界面展示可能存在空白差异） */
function normText(t: string | null): string {
  return (t || '').replace(/\s+/g, ' ').trim();
}

/** 远程平台嵌入地址白名单（YouTube / 哔哩哔哩 / 腾讯视频 / 优酷 等） */
const REMOTE_EMBED_RE = /^https:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be|bilibili\.com|bdstatic\.com|qq\.com|youku\.com|alicdn\.com)(\/|$)/i;
/** 本机/直链视频文件地址：必须 http(s) 或根相对，且以视频扩展名结尾（禁 javascript:/data:） */
const VIDEO_FILE_RE = /^(?:https?:\/\/|\/)[^\s"'<>]*\.(?:mp4|webm|ogv|ogg|mov|m4v)(?:[?#][^\s"'<>]*)?$/i;
/**
 * 链接地址白名单（2026-10-10 新增 link 补丁）——「文字挂链接跳第三级页面」的入口地址。
 *   ① 站内根相对 /xxx（禁 //host 协议相对写法：那等价于外站）
 *   ② http(s) 完整地址（必须带主机部分）
 *   ③ 页内锚点 #xxx
 * javascript: / data: / vbscript: 等危险协议不以这三类开头，天然被拒；整体禁空白与 " ' < > \ 防属性逃逸。
 * ⚠️ 前端 admin/preview-inline-<日期>.js 的 LINK_HREF_RE 必须与本正则逐字一致（前端给即时反馈，后端防绕过）。
 */
const LINK_HREF_RE = /^(?:\/(?!\/)[^\s"'<>\\]*|https?:\/\/[^\s"'<>\\]+|#[^\s"'<>\\]*)$/i;

export interface ApplyPatchesResult {
  html: string;
  applied: number;
  failed: Array<{ index: number; reason: string }>;
}

export function applyContentPatches(html: string, patches: ContentPatch[]): ApplyPatchesResult {
  const dom = new JSDOM('<div id="__cp-root">' + html + '</div>');
  const doc = dom.window.document;
  const root = doc.getElementById('__cp-root');
  if (!root) return { html, applied: 0, failed: [{ index: -1, reason: '根容器解析失败' }] };

  const failed: ApplyPatchesResult['failed'] = [];
  let applied = 0;

  patches.forEach((p, index) => {
    const reject = (reason: string) => failed.push({ index, reason });
    try {
      if (!p || !Array.isArray(p.path) || !p.path.length) return reject('路径为空');
      if (typeof p.next !== 'string') return reject('新值缺失');

      // 沿 childNodes 索引链下走，逐步校验 nodeName
      let node: Node = root;
      for (let d = 0; d < p.path.length; d++) {
        const step = p.path[d];
        const child = node.childNodes[step.i] || null;
        if (!child) return reject(`路径第 ${d + 1} 步越界（index ${step.i}）`);
        if ((child.nodeName || '').toUpperCase() !== String(step.tag || '').toUpperCase()) {
          return reject(`路径第 ${d + 1} 步标签不符（期望 ${step.tag}，实际 ${child.nodeName}）`);
        }
        node = child;
      }

      if (p.type === 'text') {
        if (node.nodeType !== 3) return reject(`目标不是文本节点（nodeType ${node.nodeType}）`);
        if (normText(node.nodeValue) !== normText(p.old)) return reject('旧文本不匹配（内容可能已被其他修改变更），请刷新预览后重做');
        node.nodeValue = p.next;
        applied++;
      } else if (p.type === 'img') {
        if (node.nodeType !== 1 || (node as Element).tagName !== 'IMG') return reject('目标不是 <img> 元素');
        const el = node as Element;
        if (normText(el.getAttribute('src')) !== normText(p.old)) return reject('图片 src 已变化，请刷新预览后重做');
        el.setAttribute('src', p.next);
        // 换图后原 srcset/sizes 不再匹配新图，清掉防止浏览器选旧图
        el.removeAttribute('srcset');
        el.removeAttribute('sizes');
        applied++;
      } else if (p.type === 'video') {
        // 视频块有两种形态（2026-09-11 二次扩展）：
        //   ① 远程平台：<iframe src="https://player.../embed/...">（原站 paragraph--type--video-remote 导入后转 iframe）
        //   ② 本机视频：<video><source src="/sites/.../xxx.mp4"></video>（原站 paragraph--type--video 原样保留）
        // 两类都只改「播放地址」这一个属性，结构/class 一律不动。
        if (node.nodeType !== 1) return reject('目标不是视频元素');
        const el = node as Element;
        if (el.tagName === 'IFRAME') {
          if (normText(el.getAttribute('src')) !== normText(p.old)) return reject('视频地址已变化，请刷新预览后重做');
          if (!REMOTE_EMBED_RE.test(p.next)) {
            return reject('仅支持 YouTube / 哔哩哔哩 / 腾讯视频 / 优酷 的播放器嵌入地址');
          }
          el.setAttribute('src', p.next);
          applied++;
        } else if (el.tagName === 'SOURCE') {
          // <source> 必须挂在 <video> 里，否则视为定位错位
          const host = el.parentNode;
          if (!host || host.nodeType !== 1 || (host as Element).tagName !== 'VIDEO') {
            return reject('视频源 <source> 不在 <video> 元素内，拒绝修改');
          }
          if (normText(el.getAttribute('src')) !== normText(p.old)) return reject('视频地址已变化，请刷新预览后重做');
          if (!VIDEO_FILE_RE.test(p.next)) {
            return reject('本机视频仅支持视频文件地址（/uploads/… 或 https 直链，需以 mp4 / webm / mov 等结尾）');
          }
          el.setAttribute('src', p.next);
          // 换文件后旧的 type="video/mp4" 可能不再匹配新格式（如换成 .webm），
          // 清掉让浏览器按扩展名自行嗅探，否则会静默不播放。
          if (el.hasAttribute('type')) el.removeAttribute('type');
          applied++;
        } else {
          return reject(`目标不是视频 <iframe> 或 <source> 元素（${el.tagName}）`);
        }
      } else if (p.type === 'link') {
        // 链接（<a href>）：正文里「文字挂链接跳第三级页面」的入口地址。
        // 只改 href 一个属性，class / target / rel / 结构 / 兄弟节点一律不动；
        // next 为空串 = 删除 href（取消链接）——sitemap 里有 3 个导入时丢了 href 的 <a>，正好可用本类型补回。
        // ⚠️ 前端点击 <a> 内文字时同时可能产出 text + link 两个补丁：text 改文字、link 改地址，互不干扰。
        if (node.nodeType !== 1 || (node as Element).tagName !== 'A') return reject('目标不是 <a> 链接元素');
        const el = node as Element;
        if (normText(el.getAttribute('href')) !== normText(p.old)) return reject('链接地址已变化，请刷新预览后重做');
        const href = (p.next || '').trim();
        if (!href) {
          el.removeAttribute('href');
          applied++;
        } else {
          if (!LINK_HREF_RE.test(href)) {
            return reject('链接地址不合法（仅支持 /站内路径、https:// 完整地址、#页内锚点；禁止 javascript: 等）');
          }
          el.setAttribute('href', href);
          applied++;
        }
      } else {
        return reject(`未知补丁类型 ${p.type}`);
      }
    } catch (e: any) {
      reject(e.message || '补丁应用异常');
    }
  });

  return { html: root.innerHTML, applied, failed };
}

/** 从任意 YouTube 链接/裸 ID 提取 videoID；非法返回 null */
export function extractYoutubeId(raw: string): string | null {
  const s = (raw || '').trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{6,20}$/.test(s)) return s;
  const m = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/i.exec(s);
  return m ? m[1] : null;
}
