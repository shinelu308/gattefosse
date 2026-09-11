/**
 * 标签体系「单一真相源」映射表
 * ============================================================================
 * 集中定义 产品线 → (数据表 / 标签字段 / 字典 category / 前台查询参数) 的对应关系。
 *
 * 为什么必须集中：这组对应关系原本散落在三个地方 ——
 *   1. 三条 controller 各自的 tagFilters 数组
 *   2. 后台 `admin/tag-manage-standalone.html` 的 CATEGORY_MAP
 *   3. 审计/对齐脚本里的硬编码 MAP 表
 * 改一处忘一处就出事，历史上已经踩过两次：
 *   - 后台把 `formulation` 写成 `formula` → 切到「配方」永远显示「暂无标签」
 *   - 后台 pharma 分类表写成 `[functionality, application, dosageForm, claim]`
 *     → market / route / dosage_form 共 29 条标签在后台完全不可见
 *
 * 以后新增或调整标签维度，**只改这一个文件**，其余位置一律从它派生。
 */
export type TagModelName = 'pcIngredient' | 'pharmaProduct' | 'formulation';

/**
 * 全部 productLine 的中文名。
 * - label：完整名，用于巡检报告 / CLI 输出
 * - short：后台下拉用的短名，**与改造前的后台文案保持一致**（原界面就是「成分 / 药用辅料 / 配方 / 文章主题」）
 */
export const TAG_LINE_META: Record<string, { label: string; short: string }> = {
  pc: { label: '个人护理成分', short: '成分' },
  pharma: { label: '药用辅料', short: '药用辅料' },
  formulation: { label: '个人护理配方', short: '配方' },
  article_theme: { label: '文章主题', short: '文章主题' },
};

export interface TagDimension {
  /** 字典表 tag_dictionary.category */
  category: string;
  /** Prisma 字段名（camelCase） */
  field: string;
  /** 物理列名（raw SQL / CLI 脚本用） */
  column: string;
  /** 前台筛选页的 query 参数名 */
  param: string;
  /** 中文名，后台展示用 */
  label: string;
  /** true=逗号分隔的多值标签；false=单值（如配方的天然指数） */
  multi: boolean;
}

export interface TagLine {
  /** productLine 取值 */
  line: string;
  /** 中文名 */
  label: string;
  model: TagModelName;
  /** 物理表名 */
  table: string;
  dimensions: TagDimension[];
}

/** 三条「产品线」——只有它们有产品字段承载标签，也只有它们能做健康检查 */
export const TAG_LINES: Record<string, TagLine> = {
  pc: {
    line: 'pc',
    label: '个人护理成分',
    model: 'pcIngredient',
    table: 'pc_ingredients',
    dimensions: [
      { category: 'functionality', field: 'functionalityTag', column: 'functionality_tag', param: 'functionality', label: '功能', multi: true },
      { category: 'application', field: 'applicationTag', column: 'application_tag', param: 'application', label: '应用领域', multi: true },
      { category: 'concept', field: 'conceptTag', column: 'concept_tag', param: 'concept', label: '概念', multi: true },
      { category: 'claim', field: 'claimTag', column: 'claim_tag', param: 'claim', label: '声明', multi: true },
      { category: 'characteristic', field: 'characteristicTag', column: 'characteristic_tag', param: 'characteristic', label: '特征', multi: true },
      { category: 'naturality', field: 'naturalityLabel', column: 'naturality_label', param: 'naturality', label: '自然性', multi: true },
    ],
  },
  pharma: {
    line: 'pharma',
    label: '药用辅料',
    model: 'pharmaProduct',
    table: 'pharma_products',
    dimensions: [
      { category: 'market', field: 'marketTag', column: 'market_tag', param: 'market', label: '应用市场', multi: true },
      { category: 'route', field: 'routeTag', column: 'route_tag', param: 'route', label: '给药途径', multi: true },
      { category: 'functionality', field: 'functionalityTag', column: 'functionality_tag', param: 'functionality', label: '功能', multi: true },
      { category: 'dosage_form', field: 'dosageFormTag', column: 'dosage_form_tag', param: 'dosageForm', label: '剂型', multi: true },
    ],
  },
  formulation: {
    line: 'formulation',
    label: '个人护理配方',
    model: 'formulation',
    table: 'formulations',
    dimensions: [
      { category: 'application', field: 'applicationTag', column: 'application_tag', param: 'application', label: '应用领域', multi: true },
      { category: 'form', field: 'formTag', column: 'form_tag', param: 'form', label: '性状', multi: true },
      { category: 'claim', field: 'claimTag', column: 'claim_tag', param: 'claim', label: '声明', multi: true },
      // 顺序与前台 filtration-finder 的筛选区块、以及改造前后台下拉一致：天然指数在成分/概念之前
      { category: 'naturalityIndex', field: 'naturalityIndex', column: 'naturality_index', param: 'naturalityIndex', label: '天然指数', multi: false },
      // ⚠️ 前台参数叫 ingredient，数据却存在 conceptTag 列 —— 这是原站的历史命名，
      //    容易误判成「字典分类写错」，实际是对的，别改。
      { category: 'ingredient', field: 'conceptTag', column: 'concept_tag', param: 'ingredient', label: '成分/概念', multi: true },
    ],
  },
};

/** 三条产品线的 key（顺序固定，后台下拉按此顺序） */
export const PRODUCT_LINES = ['pc', 'pharma', 'formulation'] as const;

/** 字典里全部 productLine（含无产品字段承载的 article_theme） */
export const ALL_TAG_LINES = ['pc', 'pharma', 'formulation', 'article_theme'] as const;

/** article_theme 的字典类别：label=英文原词，value=中文译文，**允许多个 label 译成同一 value** */
export const ARTICLE_THEME_LINE = 'article_theme';

export function getTagLine(line: string | undefined | null): TagLine | null {
  if (!line) return null;
  return TAG_LINES[String(line)] || null;
}

export function isProductLine(line: string | undefined | null): boolean {
  return !!getTagLine(line);
}

/** 中文名（含 article_theme，后台下拉用） */
export function tagLineLabel(line: string, short = false): string {
  const meta = TAG_LINE_META[line];
  if (!meta) return line;
  return short ? meta.short : meta.label;
}

/** 某产品线某字典分类的中文名；查不到回退 category 原文 */
export function categoryLabel(line: string, category: string): string {
  const l = getTagLine(line);
  const d = l?.dimensions.find((x) => x.category === category);
  return d?.label || category;
}

/** 逗号分隔字符串 → 去空去重的标签数组 */
export function splitTagValue(raw: unknown): string[] {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 标签数组 → 逗号分隔字符串（去重） */
export function joinTagValue(list: unknown): string {
  if (Array.isArray(list)) {
    return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))].join(',');
  }
  return splitTagValue(list).join(',');
}
