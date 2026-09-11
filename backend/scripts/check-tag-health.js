/**
 * 标签巡检 CLI（2026-09-12 / P2）
 * ============================================================================
 * 用法：
 *   node scripts/check-tag-health.js                  巡检全部产品线（只读）
 *   node scripts/check-tag-health.js --line=pc        只巡检某条产品线
 *   node scripts/check-tag-health.js --json           输出 JSON（给自动化消费）
 *   node scripts/check-tag-health.js --strict         有「缺口」时退出码 1
 *   node scripts/check-tag-health.js --fill           把缺口全部补进字典（显式指定才写）
 *
 * 建议在导入脚本收尾接一行：
 *   node scripts/check-tag-health.js --line=pc --strict
 * 新标签一出现就暴露，而不是等「前台筛不出、后台看不到」才发现。
 *
 * ⚠️ 依赖 dist，改动 src 后先 `npx tsc`。
 * ⚠️ 本脚本只读；--fill 才会写库，且写完会打印新增清单。
 */
const { scanTagHealth, scanAllTagHealth, fillTagDictionary } = require('../dist/utils/tag-health.js');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (name) => {
  const hit = argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=').slice(1).join('=') : null;
};

const AS_JSON = has('--json');
const STRICT = has('--strict');
const FILL = has('--fill');
const LINE = val('line');

(async () => {
  const reports = LINE ? [await scanTagHealth(LINE)] : await scanAllTagHealth();

  if (AS_JSON) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    for (const r of reports) {
      const flags = [];
      if (r.summary.missing) flags.push(`缺口 ${r.summary.missing}`);
      if (r.summary.dead) flags.push(`死标签 ${r.summary.dead}`);
      if (r.summary.collisions) flags.push(`同值冲突 ${r.summary.collisions}`);
      if (r.summary.suspects) flags.push(`疑似脏值 ${r.summary.suspects}`);
      console.log(
        `\n【${r.productLineLabel} / ${r.productLine}】产品 ${r.productCount} · 字典 ${r.dictCount}` +
          (flags.length ? `  ⚠️ ${flags.join(' · ')}` : '  ✓ 健康')
      );
      console.log(
        '  ' +
          r.dimensions
            .map((d) => `${d.categoryLabel} ${d.usedCount}/${d.dictCount}${d.missing ? `(缺${d.missing})` : ''}`)
            .join('  |  ')
      );

      if (r.missing.length) {
        console.log('  ▸ 缺口（产品在用、字典没有 → 前台筛不出来）：');
        console.log('     可能是「漏登记的标签」→ 该补进字典；也可能是「产品页文案碎片」→ 该从产品字段清掉。逐条判断。');
        r.missing.forEach((m) =>
          console.log(`     [${m.categoryLabel}] ${JSON.stringify(m.value)}  ${m.count} 个产品  例: ${m.samples.join(', ')}`)
        );
      }
      if (r.collisions.length) {
        console.log('  ▸ 同值冲突（同分类下多个 label 撞同一个 value → 前台出现两个一样选项）：');
        r.collisions.forEach((c) => console.log(`     [${c.categoryLabel}] ${JSON.stringify(c.value)} ← ${c.labels.join(' / ')}  ids=${c.ids.join(',')}`));
      }
      if (r.suspects.length) {
        console.log('  ▸ 疑似脏值（结构性垃圾：实体残留 / 首尾符号 / 括号不成对）：');
        r.suspects.forEach((s) =>
          console.log(
            `     [${s.categoryLabel}] ${JSON.stringify(s.value)}  ${s.reason}` +
              (s.source === 'dict' ? `（字典 id=${s.dictId}）` : `（${s.count} 个产品）`)
          )
        );
      }
      if (r.dead.length) {
        console.log('  ▸ 死标签（字典有、零产品使用 → 前台点了空列表）：');
        r.dead.forEach((d) => console.log(`     [${d.categoryLabel}] ${JSON.stringify(d.value)}  id=${d.id} sort=${d.sortOrder}`));
      }
    }
  }

  if (FILL) {
    let total = 0;
    for (const r of reports) {
      if (!r.missing.length) continue;
      const items = r.missing.map((m) => ({ category: m.category, value: m.value }));
      const res = await fillTagDictionary(r.productLine, items);
      total += res.created.length;
      console.log(`\n[${r.productLine}] 补齐 ${res.created.length} 条` + (res.skipped.length ? `，跳过 ${res.skipped.length}` : '') + (res.rejected.length ? `，拒绝 ${res.rejected.length}` : ''));
      res.created.forEach((c) => console.log(`   + [${c.category}] ${JSON.stringify(c.value)} (sort=${c.sortOrder})`));
      res.rejected.forEach((x) => console.log(`   ✗ [${x.category}] ${JSON.stringify(x.value)} — ${x.reason}`));
    }
    console.log(`\n共新增 ${total} 条`);
  }

  const unhealthy = reports.some((r) => r.summary.missing > 0 || r.summary.collisions > 0);
  if (STRICT && unhealthy) {
    console.log('\n--strict：存在缺口或同值冲突，退出码 1');
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
