"""
配方自动标签匹配脚本 - 第二版
- 优化关键词规则，减少误匹配
- 添加功效宣称(claim)标签
- 清理现有标签数据
"""

import sqlite3

DB_PATH = 'E:/项目开发区/嘉法狮网站重建/backend/prisma/gattefosse.db'
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# ====== 1. 先给配方标签字典添加 claim（功效宣称）分类 ======
claim_labels = [
    ('claim', '抗衰老', '抗衰老'),
    ('claim', '抗氧化', '抗氧化'),
    ('claim', '保湿', '保湿'),
    ('claim', '舒缓', '舒缓'),
    ('claim', '紧致', '紧致'),
    ('claim', '抗皱', '抗皱'),
    ('claim', '抗痘', '抗痘'),
    ('claim', '淡化黑眼圈', '淡化黑眼圈'),
    ('claim', '抗光老化', '抗光老化'),
    ('claim', '滋养', '滋养'),
    ('claim', '哑光', '哑光'),
    ('claim', '焕肤', '焕肤'),
    ('claim', '抗下垂', '抗下垂'),
    ('claim', '净化排毒', '净化排毒'),
    ('claim', '防晒保护', '防晒保护'),
    ('claim', '美白提亮', '美白提亮'),
    ('claim', '去角质', '去角质'),
    ('claim', '修护', '修护'),
    ('claim', '清爽', '清爽'),
    ('claim', '头发护理', '头发护理'),
    ('claim', '彩妆持久', '彩妆持久'),
    ('claim', '均匀肤色', '均匀肤色'),
    ('claim', '防水', '防水'),
    ('claim', '抗污染', '抗污染'),
]

existing_claims = set()
cur.execute('SELECT label FROM tag_dictionary WHERE product_line = ? AND category = ?', ('formulation', 'claim'))
for r in cur.fetchall():
    existing_claims.add(r['label'])

added = 0
for cat, label, value in claim_labels:
    if label not in existing_claims:
        cur.execute(
            'INSERT INTO tag_dictionary (category, product_line, label, value, sort_order) VALUES (?, ?, ?, ?, ?)',
            (cat, 'formulation', label, value, 0)
        )
        added += 1
print(f'新增 {added} 个 claim 标签到配方标签字典')

# ====== 2. 读取标签字典 ======
cur.execute('SELECT category, label, value FROM tag_dictionary WHERE product_line = ?', ('formulation',))
tag_dict = {}
for t in cur.fetchall():
    cat = t['category']
    if cat not in tag_dict:
        tag_dict[cat] = {}
    tag_dict[cat][t['label']] = t['value']

# ====== 3. 读取配方 ======
cur.execute('SELECT id, name, code, description, application_tag, form_tag, claim_tag FROM formulations ORDER BY id')
formulations = cur.fetchall()

# ====== 4. 优化匹配规则 ======
# 注意：排除词优先，避免过度匹配

# 应用领域 - 按优先级从高到低
application_rules = [
    (['睫毛', '眼影', '眼线', '腮红'], '彩妆'),  # 先匹配具体彩妆品类
    (['口红', '唇膏', '唇彩', '润唇', '润色润唇'], '唇部护理'),
    (['唇'], '唇部护理'),  # 唇字匹配 - 放在彩妆后面以防口红也被唇部匹配
    (['护发', '发蜡', '发丝', '头皮', '毛躁', '卷发', '头发', '发根', '发膏', '护发乳', '护发膏',
      '发膜', '头发护理', '卷发护理'], '头发护理'),
    (['防晒', 'SPF', 'spf', '紫外线', '防晒霜', '防晒乳', '防晒棒'], '防晒护理'),
    (['眼霜', '眼周', '眼部', '眼袋', '眼影', '眼线', '睫毛'], '眼部护理'),
    (['身体', '沐浴', '手部', '脚 ', '足部', '身体乳', 'body', 'Body', '全身'], '身体护理'),
    (['粉底', '遮瑕', '高光', '底霜', '妆前', '定妆', '粉底液', '散粉', '口红', '唇彩',
      '腮红', '眼影', '眼线', '睫毛膏', '眉笔', '润色霜', '有色霜', '彩妆'], '彩妆'),
    (['唇部'], '唇部护理'),
    # 默认兜底
]

form_rules = [
    # 精确匹配优先
    (['眼霜'], '乳霜'),
    (['日霜', '晚霜'], '乳霜'),
    (['精华液', '精华露', '精华', 'serum', 'Serum'], '精华'),
    (['凝胶', 'gel', 'Gel', '啫喱', '双凝胶', '晶乳'], '凝胶'),
    (['喷雾', 'spray', 'Spray'], '喷雾'),
    (['面膜', '泥膜', 'mask', 'Mask'], '糊状'),
    (['棒', 'stick', 'Stick', '棒状', '粉棒'], '棒状'),
    (['黄油', 'butter', 'Butter'], '黄油质地'),
    (['发蜡', '膏 ', '修护膏', '润肤膏', '万用膏', '发膏', '营养膏', '护发膏',
      'balm', 'Balm', '遮瑕膏', '睫毛膏', '润唇膏', '卸妆膏', '乳膏'], '膏霜'),
    (['乳霜', 'cream', 'Cream', '修护霜', '凝霜', '按摩霜', '面霜', '柔肤霜'], '乳霜'),
    (['粉底液', '粉底'], '乳状液'),
    (['水', '乳', '乳液', 'lotion', 'Lotion', 'milk', 'Milk'], '乳液'),
    (['油', 'oil', 'Oil'], '油'),
    (['粉', 'powder', 'Powder'], '粉状'),
    (['软膏', 'ointment', 'Ointment'], '软膏'),
]

def match_tags(text, rules, max_matches=2):
    if not text:
        return []
    matched = []
    for keywords, tag_label in rules:
        for kw in keywords:
            if kw.lower() in text.lower():
                if tag_label not in matched:
                    matched.append(tag_label)
                break
        if len(matched) >= max_matches:
            break
    return matched

def get_tag_value(category, label):
    if category in tag_dict and label in tag_dict[category]:
        return tag_dict[category][label]
    return label

# ====== 5. 执行匹配 ======
updates_app = []
updates_form = []
updates_claim = []

for f in formulations:
    text = f'{f["name"] or ""} {f["description"] or ""}'
    
    # 应用领域
    matched_apps = match_tags(text, application_rules, max_matches=1)
    if not matched_apps:
        matched_apps = ['脸部护理']
    new_app = get_tag_value('application', matched_apps[0])
    if new_app != (f['application_tag'] or ''):
        updates_app.append((new_app, f['id']))
    
    # 剂型
    matched_forms = match_tags(text, form_rules, max_matches=2)
    new_form = ','.join([get_tag_value('form', fv) for fv in matched_forms]) if matched_forms else '乳霜'
    if new_form != (f['form_tag'] or ''):
        updates_form.append((new_form, f['id']))
    
    # 功效宣称 - 从现有claimTag提取关键词匹配
    old_claim = f['claim_tag'] or ''
    claim_keywords = {
        '抗衰老': ['抗衰老', '抗老', '抗皱', 'anti-aging', 'aging'],
        '保湿': ['保湿', '滋润', '补水', '水润', 'moisture', 'hydrat'],
        '舒缓': ['舒缓', '镇静', 'sooth', 'calm', '敏感', 'comfort'],
        '紧致': ['紧致', '提升', 'lifting', 'firm', 'tighten', '抗松弛'],
        '抗痘': ['抗痘', '祛痘', '痘痘', '粉刺', '净化', 'acne'],
        '抗氧化': ['抗氧化', 'antioxidant', '自由基', '保护'],
        '滋养': ['滋养', '营养', 'nourish', 'rich'],
        '焕肤': ['焕肤', '焕新', 'renew', 'regener'],
        '抗光老化': ['光老化', '紫外线', 'photo-aging', 'DNA修复', 'solastemis'],
        '哑光': ['哑光', 'matte', '哑光', '粉感', 'oil control'],
        '抗下垂': ['抗下垂', '下垂', 'sagging', '重力'],
        '净化排毒': ['排毒', 'detox', '净化', 'purify'],
        '防晒保护': ['防晒', '防护', 'SPF', 'protection', '紫外', 'sun', 'uv'],
        '美白提亮': ['美白', '提亮', '亮肤', '光泽', 'brighten', 'radiance', 'glow'],
        '去角质': ['去角质', 'exfoliat', '磨砂', 'scrub'],
        '修护': ['修复', '修护', 'repair', 'recover', '屏障'],
        '清爽': ['清爽', '轻盈', 'light', 'fresh', '不粘', '不油腻'],
        '头发护理': ['头发', '护发', 'hair', '发丝', '头皮', '毛躁'],
        '彩妆持久': ['持久', 'long-last', 'wear', '不脱妆', '防水'],
        '均匀肤色': ['均匀', '肤色', 'even', 'tone', '遮瑕'],
        '淡化黑眼圈': ['黑眼圈', '眼袋', '眼周', 'dark circle', 'eye bag'],
        '抗污染': ['抗污染', 'anti-pollution', '污染'],
        '防水': ['防水', 'waterproof', 'water resist'],
    }
    
    claim_matches = []
    for claim_label, kws in claim_keywords.items():
        for kw in kws:
            if kw.lower() in text.lower() or kw.lower() in old_claim.lower():
                cv = get_tag_value('claim', claim_label)
                if cv and cv not in claim_matches:
                    claim_matches.append(cv)
                break
    new_claim = ','.join(claim_matches[:3]) if claim_matches else old_claim  # 保留已有claim如果没匹配到
    if new_claim != old_claim and new_claim:
        updates_claim.append((new_claim, f['id']))

# ====== 6. 批量更新 ======
if updates_app:
    cur.executemany('UPDATE formulations SET application_tag = ? WHERE id = ?', updates_app)
    print(f'更新应用领域: {len(updates_app)} 条')
if updates_form:
    cur.executemany('UPDATE formulations SET form_tag = ? WHERE id = ?', updates_form)
    print(f'更新剂型: {len(updates_form)} 条')
if updates_claim:
    cur.executemany('UPDATE formulations SET claim_tag = ? WHERE id = ?', updates_claim)
    print(f'更新功效宣称: {len(updates_claim)} 条')

conn.commit()

# ====== 7. 显示结果 ======
print('\n===== 最终结果 =====')
cur.execute('SELECT id, name, code, application_tag, form_tag, claim_tag FROM formulations ORDER BY id')
for r in cur.fetchall():
    print(f'ID:{r["id"]:3d} | {r["name"]:18s} | 应用:{str(r["application_tag"] or ""):10s} | 剂型:{str(r["form_tag"] or ""):16s} | 功效:{str(r["claim_tag"] or "")[:30]}')

conn.close()
print('\n✅ 完成')
