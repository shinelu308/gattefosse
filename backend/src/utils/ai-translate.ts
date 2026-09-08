import { prisma } from './prisma';
import { JSDOM } from 'jsdom';

/**
 * AI 翻译引擎（OpenAI 兼容接口，支持主流大模型服务商）
 * 配置存于 Setting 表：aiTranslateProvider / aiTranslateApiKey / aiTranslateModel
 */

export interface AiConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

/** 主流服务商预设（均为 OpenAI 兼容接口） */
export const AI_PROVIDERS: Record<string, { label: string; baseUrl: string; defaultModel: string }> = {
  zhipu: { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat' },
  qwen: { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
  moonshot: { label: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
};

/** 从 Setting 表读取 AI 翻译配置 */
export async function getAiConfig(): Promise<AiConfig | null> {
  const keys = await prisma.setting.findMany({
    where: { key: { in: ['aiTranslateProvider', 'aiTranslateApiKey', 'aiTranslateModel'] } },
  });
  const map: Record<string, string> = {};
  for (const k of keys) map[k.key] = k.value || '';
  const provider = map.aiTranslateProvider || 'zhipu';
  const preset = AI_PROVIDERS[provider] || AI_PROVIDERS.zhipu;
  if (!map.aiTranslateApiKey) return null;
  return {
    provider,
    apiKey: map.aiTranslateApiKey,
    model: map.aiTranslateModel || preset.defaultModel,
    baseUrl: preset.baseUrl,
  };
}

async function chatCall(cfg: AiConfig, messages: Array<{ role: string; content: string }>, maxTokens = 4000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 300000); // 5 分钟单次调用超时
  try {
    const res = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.3, max_tokens: maxTokens }),
      signal: ctrl.signal,
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
      throw new Error(`AI 接口返回错误：${msg}`);
    }
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI 接口未返回内容');
    return String(content);
  } finally {
    clearTimeout(timer);
  }
}

/** 带重试的调用：瞬时错误（限流/5xx/网络）自动重试最多 3 次，指数退避 */
async function chatCallRetry(cfg: AiConfig, messages: Array<{ role: string; content: string }>, maxTokens = 4000): Promise<string> {
  let lastErr: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await chatCall(cfg, messages, maxTokens);
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || '');
      const nonRetriable = /HTTP 40[013]\b/.test(msg); // 鉴权/参数类错误不重试
      if (nonRetriable || attempt === 3) throw lastErr;
      await new Promise(r => setTimeout(r, attempt * 5000));
    }
  }
  throw lastErr;
}

/** 简单并发池：按 n 个并发对数组逐项执行异步任务 */
export async function mapPool<T, R>(arr: T[], n: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(arr.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(n, arr.length) }, async () => {
    while (cursor < arr.length) {
      const i = cursor++;
      results[i] = await fn(arr[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const SYSTEM_PROMPT = `你是一个专业的英译中翻译引擎，服务对象是特殊化学品公司（皮肤美容、个人护理、制药辅料领域）的官网内容。

规则：
1. 只翻译人类可读的文本内容，将英文翻译为简体中文。
2. 如果输入是 HTML：严禁修改、增加或删除任何 HTML 标签、属性、class、style、id；严禁修改链接 URL、图片 src、锚点。
3. 品牌名与注册商标保留英文原文（如 Gattefossé、Silsilares®、Gatiflore®、Acticire® 等，含 ® 符号）。
4. INCI 原料英文名保留原文（如 Cocos Nucifera Oil），可括号加中文。
5. 行业术语使用专业译法：emollient=润肤剂、excipient=药用辅料、lipid excipient=脂质辅料、formulation=配方、active ingredient=活性成分。
6. 保持原文的段落结构、换行与空行数量一致。
7. 只输出翻译结果，不要任何解释、前言或后记。`;

/** 将长 HTML 按块级标签切分为不超过 maxLen 的片段（已废弃：新方案为 DOM 级文本节点翻译，无需分块） */
export function chunkHtml(html: string, maxLen = 3500): string[] {
  if (html.length <= maxLen) return [html];
  const parts = html.split(/(?=<(?:p|div|h[1-6]|li|tr|table|ul|ol|blockquote|section|figure)[\s>])/i);
  const chunks: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && cur.length + p.length > maxLen) {
      chunks.push(cur);
      cur = p;
    } else {
      cur += p;
    }
    // 单段超长时按 <br> 或段落再细分
    while (cur.length > maxLen * 2) {
      const cut = cur.lastIndexOf('<br', maxLen) ;
      const pos = cut > maxLen / 2 ? cut : cur.indexOf('>', maxLen / 2) + 1;
      if (pos < maxLen / 2) break;
      chunks.push(cur.slice(0, pos));
      cur = cur.slice(pos);
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [html];
}

/** 翻译纯文本（标题/摘要） */
export async function translateText(text: string, cfg?: AiConfig): Promise<string> {
  const c = cfg || (await getAiConfig());
  if (!c) throw new Error('AI_NOT_CONFIGURED');
  const out = await chatCallRetry(c, [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `翻译为简体中文：\n\n${text}` },
  ], 2000);
  return out.trim();
}

// ===== DOM 级 HTML 翻译：只把文本节点抽出送翻，标签/属性/嵌套结构原样保留 =====
// 背景：整段 HTML 交给大模型翻译时，LLM 会丢失闭合标签、合并/重排 div、篡改链接 URL，
// 导致译文样式与原站不一致。此方案保证除文本内容外 HTML 结构 100% 不变。

const TEXT_BATCH_MAX_NODES = 20;   // 单批最多文本节点数
const TEXT_BATCH_MAX_CHARS = 2500; // 单批最大字符数
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'CODE', 'PRE', 'TEXTAREA']);

/** 批量翻译编号文本行：输入 [i|||text]，输出按编号回填；解析失败重试一次，仍失败回退原文 */
async function translateNumberedTexts(texts: string[], cfg: AiConfig): Promise<string[]> {
  const numbered = texts.map((t, i) => `${i + 1}|||${t.replace(/\s+/g, ' ').trim()}`).join('\n');
  const userPrompt = `将下列编号文本逐条翻译为简体中文（官网内容）。
规则：品牌名与注册商标保留英文原文（Gattefossé、Silkaress®、EnergiNius® 等，含 ® ™ 符号）；INCI 原料英文名保留原文；术语用专业译法（emollient=润肤剂、excipient=药用辅料、active ingredient=活性成分）。
输入格式为「编号|||文本」。输出必须严格保持相同的行数与编号，格式「编号|||译文」，除编号行外不要输出任何其他内容：

${numbered}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await chatCallRetry(cfg, [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ], 4000);
    const out = new Map<number, string>();
    for (const line of res.split('\n')) {
      const m = /^\s*(\d+)\s*\|\|\|\s*(.+)$/.exec(line);
      if (m) out.set(parseInt(m[1], 10), m[2].trim());
    }
    if (texts.every((_, i) => out.has(i + 1))) {
      return texts.map((_, i) => out.get(i + 1) as string);
    }
    if (attempt === 2) {
      console.warn(`[ai-translate] 批量翻译解析不完整（${out.size}/${texts.length}），缺失项回退原文`);
    }
  }
  return texts; // 两次都失败 → 全部回退原文，绝不破坏内容
}

/**
 * 翻译 HTML：DOM 解析后仅翻译文本节点并原位回填，标签/属性/结构零改动。
 * onProgress(done, total) 按批次回报进度。
 */
export async function translateHtml(html: string, cfg?: AiConfig, onProgress?: (done: number, total: number) => void): Promise<string> {
  const c = cfg || (await getAiConfig());
  if (!c) throw new Error('AI_NOT_CONFIGURED');

  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const { NodeFilter } = dom.window;

  // 1. 收集全部可翻译文本节点
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node: any) {
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: any[] = [];
  let n: any;
  while ((n = walker.nextNode())) nodes.push(n);
  if (!nodes.length) return html;

  // 2. 按节点数/字符数上限分组
  const batches: any[][] = [];
  let cur: any[] = [];
  let curLen = 0;
  for (const node of nodes) {
    const len = node.nodeValue!.length;
    if (cur.length && (cur.length >= TEXT_BATCH_MAX_NODES || curLen + len > TEXT_BATCH_MAX_CHARS)) {
      batches.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(node);
    curLen += len;
  }
  if (cur.length) batches.push(cur);

  // 3. 并发 2 路逐批翻译（进度按批回报）
  let done = 0;
  await mapPool(batches, 2, async (batch) => {
    const originals = batch.map(nd => nd.nodeValue!);
    let translated: string[];
    try {
      translated = await translateNumberedTexts(originals, c);
    } catch (e) {
      console.warn('[ai-translate] 批次翻译失败，本批回退原文：', (e as Error).message);
      translated = originals;
    }
    batch.forEach((nd, i) => {
      const raw = originals[i];
      const lead = /^\s*/.exec(raw)![0];
      const trail = /\s*$/.exec(raw)![0];
      nd.nodeValue = lead + translated[i] + trail; // 保留首尾空白，原位回填
    });
    done++;
    if (onProgress) onProgress(done, batches.length);
  });

  return doc.body.innerHTML;
}

/** 测试连通性 */
export async function testAiConnection(cfg?: AiConfig): Promise<{ ok: boolean; message: string; model?: string }> {
  const c = cfg || (await getAiConfig());
  if (!c) return { ok: false, message: '尚未配置 API Key' };
  try {
    const res = await chatCall(c, [
      { role: 'user', content: '请把 "Skin care" 翻译为简体中文，只输出译文。' },
    ], 100);
    return { ok: true, message: `连接成功，模型回复：${res.trim()}`, model: c.model };
  } catch (e: any) {
    return { ok: false, message: e.message || '连接失败' };
  }
}
