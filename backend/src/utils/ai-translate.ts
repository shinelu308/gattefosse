import { prisma } from './prisma';

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

/** 将长 HTML 按块级标签切分为不超过 maxLen 的片段 */
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
  const out = await chatCall(c, [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `翻译为简体中文：\n\n${text}` },
  ], 2000);
  return out.trim();
}

/** 翻译 HTML（保留全部标签结构，长文自动分块，支持进度回调） */
export async function translateHtml(html: string, cfg?: AiConfig, onProgress?: (done: number, total: number) => void): Promise<string> {
  const c = cfg || (await getAiConfig());
  if (!c) throw new Error('AI_NOT_CONFIGURED');
  const chunks = chunkHtml(html);
  let done = 0;
  // 并发 3 路翻译分块（过大易触发限流，3 为稳妥值）
  const out = await mapPool(chunks, 3, async (chunk) => {
    const res = await chatCall(c, [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `以下是需要翻译的 HTML 片段，保留所有标签结构，只翻译文本：\n\n${chunk}` },
    ]);
    done++;
    if (onProgress) onProgress(done, chunks.length);
    // 去掉模型偶尔包裹的 ```html 代码块围栏
    return res.trim().replace(/^```(?:html)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  });
  return out.join('');
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
