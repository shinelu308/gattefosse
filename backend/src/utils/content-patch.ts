/**
 * 正文内容补丁回填（2026-09-11 预览式原位编辑）
 * 背景：原站导入文章的 contentHtml 锁定为源码模式防止版式破坏，小白用户改文字/图片/视频困难。
 * 方案：后台预览编辑器只产出三类「补丁」（文本节点 / img src / 视频iframe src），
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
  type: 'text' | 'img' | 'video';
  path: PatchPathStep[];
  /** 旧值：text=文本节点全文；img=img 的 src 属性；video=iframe 的 src 属性（用于防错位校验） */
  old: string;
  /** 新值：text=新文本；img=新图片地址（/uploads/...）；video=新 embed 地址 */
  next: string;
}

/** 空白折叠对比（DOM 文本值与界面展示可能存在空白差异） */
function normText(t: string | null): string {
  return (t || '').replace(/\s+/g, ' ').trim();
}

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
        if (node.nodeType !== 1 || (node as Element).tagName !== 'IFRAME') return reject('目标不是视频 <iframe> 元素');
        const el = node as Element;
        if (normText(el.getAttribute('src')) !== normText(p.old)) return reject('视频地址已变化，请刷新预览后重做');
        el.setAttribute('src', p.next);
        applied++;
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
