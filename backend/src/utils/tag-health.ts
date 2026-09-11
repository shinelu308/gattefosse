/**
 * 标签健康巡检与补齐（2026-09-12 / P2）
 * ============================================================================
 * 解决的问题：产品侧的标签完全没有自动补齐。一旦导入/编辑出一个字典里没有的标签，
 * 链路就断在这里 —— 字典不显示 → 后台管不到 → 前台筛不出 → 且没有任何提示。
 *
 * 本模块提供两件事：
 *   1. scanTagHealth(line)  只读巡检：产品实际用值与字典做 diff，
 *      产出「缺口（数据有·字典无）/ 死标签（字典有·数据零用）/ 同值冲突 / 疑似脏值」
 *   2. fillTagDictionary()  按人工确认后的清单写入字典（**绝不静默写**）
 *
 * 维度定义一律取自 `utils/tag-map.ts`，本文件不硬编码任何字段名。
 */
import { prisma } from './prisma';
import { getTagLine, splitTagValue, TAG_LINE_META } from './tag-map';

export interface TagMissingItem {
  category: string;
  categoryLabel: string;
  value: string;
  count: number;
  samples: string[];
}

export interface TagDeadItem {
  id: number;
  category: string;
  categoryLabel: string;
  label: string;
  value: string;
  sortOrder: number;
}

export interface TagCollisionItem {
  category: string;
  categoryLabel: string;
  value: string;
  labels: string[];
  ids: number[];
}

export interface TagSuspectItem {
  /** data=产品字段里的值；dict=字典本身存的脏值 */
  source: 'data' | 'dict';
  category: string;
  categoryLabel: string;
  value: string;
  count: number;
  reason: string;
  samples: string[];
  dictId?: number;
}

export interface TagDimensionStat {
  category: string;
  categoryLabel: string;
  dictCount: number;
  usedCount: number;
  missing: number;
  dead: number;
}

export interface TagHealthReport {
  productLine: string;
  productLineLabel: string;
  productCount: number;
  dictCount: number;
  dimensions: TagDimensionStat[];
  missing: TagMissingItem[];
  dead: TagDeadItem[];
  collisions: TagCollisionItem[];
  suspects: TagSuspectItem[];
  summary: { missing: number; dead: number; collisions: number; suspects: number; healthy: boolean };
  checkedAt: string;
}

/**
 * 疑似脏值的判定规则 —— **只认结构性垃圾，不猜语义**。
 *
 * 为什么不做「长度超过 N 字就是文案碎片」这类长度规则：
 * 实测字典里就有 `有趣的质感`（含「的」）、`NOI = 100 % (ISO 16128)`（23 字）、
 * `符合中国标准 (IECIC)`、`口服生物利用度增强剂`（10 个纯汉字）—— 全是合法标签。
 * 任何长度/「的」字规则都会误报，反而让巡检结果没人看。
 *
 * 真正的「整段文案」误入标签，会被下面的 **缺口** 清单捞出来（文案必然不在字典里），
 * 由人在缺口清单里逐条判断「补进字典」还是「从产品字段清掉」。
 */
const SUSPECT_RULES: { test: (v: string) => boolean; reason: string }[] = [
  { test: (v) => /&[a-zA-Z#][a-zA-Z0-9]*;?|&nbsp|&mdash|&amp/.test(v), reason: '含 HTML 实体残留（未解码）' },
  { test: (v) => /^[+＋/,、;；]|[+＋/,、;；]$/.test(v), reason: '首尾是 + / , / 、 这类分隔符号' },
  { test: (v) => /^[+\-—–/.,，、;；]+$/.test(v), reason: '纯符号，不是标签' },
];

/**
 * 括号配对检测。
 * ⚠️ 不要用「以 ( 开头或以 ) 结尾」这类正则：`乳化剂(O/W)`、`硬脂（栓剂基质）`、
 *    `NOI = 100 % (ISO 16128)` 都是配对合法的正常标签，那样判会全部误报。
 *    只报真正的「多一个或漏一个」。
 */
function bracketImbalance(v: string): string | null {
  const pairs: [string, string][] = [
    ['(', ')'],
    ['（', '）'],
    ['[', ']'],
    ['【', '】'],
  ];
  for (const [open, close] of pairs) {
    let depth = 0;
    for (const ch of v) {
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth < 0) return `括号不成对（多了一个 ${close}）`;
      }
    }
    if (depth !== 0) return `括号不成对（缺 ${close}）`;
  }
  return null;
}

function detectSuspect(value: string): string | null {
  const bi = bracketImbalance(value);
  if (bi) return bi;
  for (const r of SUSPECT_RULES) if (r.test(value)) return r.reason;
  return null;
}

/** 按 产品线 取出「分类 → 值 → {数量, 样本产品名}」的实际使用分布 */
async function collectUsage(line: string) {
  const def = getTagLine(line);
  if (!def) throw new Error(`未知产品线: ${line}`);

  const select: Record<string, boolean> = { id: true, name: true };
  for (const d of def.dimensions) select[d.field] = true;
  const rows: Record<string, any>[] = await (prisma as any)[def.model].findMany({ select });

  const usage: Record<string, Map<string, { count: number; samples: string[] }>> = {};
  for (const d of def.dimensions) usage[d.category] = new Map();

  for (const row of rows) {
    for (const d of def.dimensions) {
      const values = d.multi ? splitTagValue(row[d.field]) : splitTagValue(row[d.field]).slice(0, 1);
      const seen = new Set<string>();
      for (const v of values) {
        if (seen.has(v)) continue; // 同一产品内重复值只计一次
        seen.add(v);
        const m = usage[d.category];
        const cur = m.get(v) || { count: 0, samples: [] };
        cur.count += 1;
        if (cur.samples.length < 5) cur.samples.push(row.name || `#${row.id}`);
        m.set(v, cur);
      }
    }
  }
  return { def, productCount: rows.length, usage };
}

/**
 * 只读巡检。不写任何数据。
 */
export async function scanTagHealth(line: string): Promise<TagHealthReport> {
  const { def, productCount, usage } = await collectUsage(line);

  const dictRows = await prisma.tagDictionary.findMany({
    where: { productLine: line },
    orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
  });

  const missing: TagMissingItem[] = [];
  const dead: TagDeadItem[] = [];
  const suspects: TagSuspectItem[] = [];
  const dimensions: TagDimensionStat[] = [];

  for (const d of def.dimensions) {
    const used = usage[d.category] || new Map();
    const dictOfCat = dictRows.filter((t) => t.category === d.category);
    const dictValues = new Set(dictOfCat.map((t) => t.value));

    for (const [value, info] of used) {
      if (!dictValues.has(value)) {
        missing.push({ category: d.category, categoryLabel: d.label, value, count: info.count, samples: info.samples });
      }
      const reason = detectSuspect(value);
      if (reason) {
        suspects.push({
          source: 'data',
          category: d.category,
          categoryLabel: d.label,
          value,
          count: info.count,
          reason,
          samples: info.samples,
        });
      }
    }
    for (const t of dictOfCat) {
      if (!used.has(t.value)) {
        dead.push({
          id: t.id,
          category: t.category,
          categoryLabel: d.label,
          label: t.label,
          value: t.value,
          sortOrder: t.sortOrder,
        });
      }
      // 字典自身也可能存着脏值（历史导入留下的实体残留等），一并报出来
      const dictReason = detectSuspect(t.value);
      if (dictReason) {
        suspects.push({
          source: 'dict',
          category: t.category,
          categoryLabel: d.label,
          value: t.value,
          count: 0,
          reason: dictReason,
          samples: [],
          dictId: t.id,
        });
      }
    }

    dimensions.push({
      category: d.category,
      categoryLabel: d.label,
      dictCount: dictOfCat.length,
      usedCount: used.size,
      missing: missing.filter((m) => m.category === d.category).length,
      dead: dead.filter((x) => x.category === d.category).length,
    });
  }

  // 同一个 (category, value) 有多行 —— 对「产品线」是真问题（前台会出现两个同值选项），
  // 对 article_theme 属正常（texture / textures 都译作「质地」），因此产品线以外的冲突不报。
  const byKey = new Map<string, { label: string; value: string; ids: number[]; category: string }[]>();
  for (const t of dictRows) {
    const key = t.category + '\u0000' + t.value;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push({ label: t.label, value: t.value, ids: [t.id], category: t.category });
  }
  const collisions: TagCollisionItem[] = [];
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const first = group[0];
    const dim = def.dimensions.find((x) => x.category === first.category);
    collisions.push({
      category: first.category,
      categoryLabel: dim?.label || first.category,
      value: first.value,
      labels: group.map((g) => g.label),
      ids: group.flatMap((g) => g.ids),
    });
  }

  const summary = {
    missing: missing.length,
    dead: dead.length,
    collisions: collisions.length,
    suspects: suspects.length,
    healthy: missing.length === 0 && collisions.length === 0,
  };

  return {
    productLine: line,
    productLineLabel: def.label,
    productCount,
    dictCount: dictRows.length,
    dimensions,
    missing,
    dead,
    collisions,
    suspects,
    summary,
    checkedAt: new Date().toISOString(),
  };
}

/** 巡检全部产品线 */
export async function scanAllTagHealth(): Promise<TagHealthReport[]> {
  const out: TagHealthReport[] = [];
  for (const line of Object.keys(TAG_LINE_META)) {
    if (!getTagLine(line)) continue; // article_theme 无产品字段承载，跳过
    out.push(await scanTagHealth(line));
  }
  return out;
}

/**
 * 只看「每个字典值实际被多少产品使用」——供字典接口按需附带命中数
 * （前台可据此把 0 命中的筛选项置灰，避免用户点出空列表）。只读。
 */
export async function getUsageCounts(line: string): Promise<Record<string, Record<string, number>>> {
  const { usage } = await collectUsage(line);
  const out: Record<string, Record<string, number>> = {};
  for (const [category, m] of Object.entries(usage)) {
    out[category] = {};
    for (const [value, info] of m) out[category][value] = info.count;
  }
  return out;
}

/**
 * 后台用的「产品线 → 分类」清单。
 *
 * ⚠️ 分类来源是 **DB 实际存在的 category ∪ tag-map 里声明的维度**，不是硬编码表：
 *    - 取 DB 并集 → 即使有人手工加了一个新分类，后台也一定能看到它
 *      （历史事故：后台 pharma 分类表列错，market/route/dosage_form 共 29 条标签完全不可见）
 *    - 并上 tag-map → 某分类当前 0 条时，后台仍能选到它去新建标签
 */
export async function getTagLineSchema(): Promise<
  {
    line: string;
    label: string;
    shortLabel: string;
    categories: { category: string; label: string; dictCount: number }[];
  }[]
> {
  const rows = await prisma.tagDictionary.groupBy({
    by: ['productLine', 'category'],
    _count: { _all: true },
  });
  const counts = new Map<string, number>();
  const catsByLine = new Map<string, string[]>();
  for (const r of rows) {
    counts.set(r.productLine + '\u0000' + r.category, r._count._all);
    const list = catsByLine.get(r.productLine) || [];
    list.push(r.category);
    catsByLine.set(r.productLine, list);
  }

  const out: {
    line: string;
    label: string;
    shortLabel: string;
    categories: { category: string; label: string; dictCount: number }[];
  }[] = [];
  for (const [line, meta] of Object.entries(TAG_LINE_META)) {
    const def = getTagLine(line);
    const seen = new Set<string>();
    const categories: { category: string; label: string; dictCount: number }[] = [];

    // 先按 tag-map 声明顺序（后台下拉的稳定顺序）
    for (const d of def?.dimensions || []) {
      seen.add(d.category);
      categories.push({ category: d.category, label: d.label, dictCount: counts.get(line + '\u0000' + d.category) || 0 });
    }
    // 再补 DB 里额外出现的分类（tag-map 未声明的）—— 保证「字典里有、后台看不到」不可能再发生
    for (const category of catsByLine.get(line) || []) {
      if (seen.has(category)) continue;
      seen.add(category);
      categories.push({
        category,
        label: category,
        dictCount: counts.get(line + '\u0000' + category) || 0,
      });
    }
    out.push({ line, label: meta.label, shortLabel: meta.short, categories });
  }
  return out;
}

export interface FillItem {
  category: string;
  value: string;
  label?: string;
  sortOrder?: number;
}

export interface FillResult {
  line: string;
  created: { id: number; category: string; value: string; label: string; sortOrder: number }[];
  skipped: { category: string; value: string; reason: string }[];
  rejected: { category: string; value: string; reason: string }[];
}

/**
 * 把人工确认过的标签补进字典。
 * - 已存在的（同 category 下 value 或 label 命中）直接跳过，不做重复插入
 * - category 必须属于该产品线的维度，否则拒绝（防止补齐时写错分类）
 * - sortOrder 缺省 = 该 category 现有最大值 + 1
 */
export async function fillTagDictionary(line: string, items: FillItem[]): Promise<FillResult> {
  const def = getTagLine(line);
  if (!def) throw new Error(`未知产品线: ${line}`);

  const result: FillResult = { line, created: [], skipped: [], rejected: [] };
  if (!Array.isArray(items) || !items.length) return result;

  const existing = await prisma.tagDictionary.findMany({ where: { productLine: line } });
  const existingKeys = new Set(existing.map((t) => t.category + '\u0000' + t.value));
  const existingLabels = new Set(existing.map((t) => t.category + '\u0000' + t.label));
  const maxSort = new Map<string, number>();
  for (const t of existing) {
    maxSort.set(t.category, Math.max(maxSort.get(t.category) ?? 0, t.sortOrder));
  }

  for (const raw of items) {
    const category = String(raw.category || '').trim();
    const value = String(raw.value || '').trim();
    const label = String(raw.label || value).trim();
    const catKey = category + '\u0000' + value;
    const labKey = category + '\u0000' + label;

    if (!category || !value) {
      result.rejected.push({ category, value, reason: 'category / value 不能为空' });
      continue;
    }
    if (!def.dimensions.some((d) => d.category === category)) {
      result.rejected.push({
        category,
        value,
        reason: `「${category}」不属于${def.label}的标签维度`,
      });
      continue;
    }
    if (existingKeys.has(catKey) || existingLabels.has(labKey)) {
      result.skipped.push({ category, value, reason: '字典中已存在同值或同名条目' });
      continue;
    }

    const nextSort = raw.sortOrder !== undefined ? Number(raw.sortOrder) : (maxSort.get(category) ?? 0) + 1;
    const created = await prisma.tagDictionary.create({
      data: { productLine: line, category, label, value, sortOrder: nextSort },
    });
    existingKeys.add(catKey);
    existingLabels.add(labKey);
    maxSort.set(category, Math.max(maxSort.get(category) ?? 0, nextSort));
    result.created.push({ id: created.id, category, value, label, sortOrder: nextSort });
  }

  return result;
}

/**
 * 保存产品时用：只查「本次提交的标签里有哪些不在字典」，返回给调用方做提示，不写库。
 * 一次查询搞定，成本可忽略。
 */
export async function findUnknownTags(
  line: string,
  valuesByField: Record<string, unknown>
): Promise<{ category: string; categoryLabel: string; value: string }[]> {
  const def = getTagLine(line);
  if (!def) return [];

  const wanted: { category: string; categoryLabel: string; value: string }[] = [];
  for (const d of def.dimensions) {
    const raw = valuesByField[d.field];
    if (raw === undefined || raw === null) continue;
    for (const v of splitTagValue(raw)) {
      wanted.push({ category: d.category, categoryLabel: d.label, value: v });
    }
  }
  if (!wanted.length) return [];

  const dict = await prisma.tagDictionary.findMany({
    where: { productLine: line },
    select: { category: true, value: true, label: true },
  });
  const known = new Set<string>();
  for (const t of dict) {
    known.add(t.category + '\u0000' + t.value);
    known.add(t.category + '\u0000' + t.label);
  }

  const seen = new Set<string>();
  return wanted.filter((w) => {
    const key = w.category + '\u0000' + w.value;
    if (known.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 给产品保存的响应挂上「本次提交的标签里有哪些字典没有」（不写库）。
 * 这样导入/新建/编辑产品时，一旦带出新标签，调用方立刻能看到清单，
 * 而不是等前台筛不出、后台看不到才发现。
 *
 * ⚠️ 内部吞掉异常：巡检失败绝不能连累产品保存本身。
 */
export async function attachTagWarnings<T extends Record<string, unknown>>(
  line: string,
  payload: T,
  source: Record<string, unknown>
): Promise<T & { tagWarnings: { category: string; categoryLabel: string; value: string }[] }> {
  try {
    return { ...payload, tagWarnings: await findUnknownTags(line, source) };
  } catch (e) {
    console.error('标签巡检（保存提示）失败，已忽略:', e);
    return { ...payload, tagWarnings: [] };
  }
}
