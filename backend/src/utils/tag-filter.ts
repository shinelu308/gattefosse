/**
 * 逗号分隔标签字段的精确筛选（2026-09-12）
 *
 * 背景：PC / 配方 / 药用辅料的标签都以 "a,b,c" 形式存在单列里。
 *   - 直接 `contains: '软膏'` 会命中「软膏剂」、「凝胶」会命中「凝胶剂/双凝胶」——
 *     全库实测 22 处此类子串误命中，甚至「字典里 0 个产品使用的死标签」也能筛出结果。
 *   - 同分类多选语义应为**并集**（OR 任选其一），只有跨分类之间才是交集（AND）。
 *     早前 PC / 药用辅料把同分类的每个值都 push 进 where.AND → 多选变交集；
 *     配方更直接只取 `vals[0]`，其余选中项被静默丢弃。
 */

export type TagWhere = Record<string, unknown>;

/** 单个标签值的「整项」匹配：等于 a ｜ 以 a, 开头 ｜ 以 ,a 结尾 ｜ 含 ,a, */
export function tagEquals(field: string, value: string): TagWhere {
  return {
    OR: [
      { [field]: value },
      { [field]: { startsWith: value + ',' } },
      { [field]: { endsWith: ',' + value } },
      { [field]: { contains: ',' + value + ',' } },
    ],
  };
}

/** 同一分类的多个选中值 → OR（并集） */
export function tagGroup(field: string, raw: string | undefined): TagWhere | null {
  if (!raw) return null;
  const values = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!values.length) return null;
  const conds = values.map((v) => tagEquals(field, v));
  return conds.length === 1 ? conds[0] : { OR: conds };
}

/**
 * 合并「关键词搜索」与「各分类标签组」到 where。
 *
 * ⚠️ 必须统一走 AND 数组。早前 `Object.assign(where, cond)` 在只有一个标签条件时
 *    会把关键词搜索写下的 `where.OR` 直接覆盖掉，导致「关键词 + 单个标签」组合下
 *    关键词被静默忽略。
 */
export function mergeWhere(where: TagWhere, parts: (TagWhere | null | undefined)[]): TagWhere {
  const list = parts.filter(Boolean) as TagWhere[];
  if (list.length === 1) Object.assign(where, list[0]);
  else if (list.length > 1) where.AND = list;
  return where;
}
