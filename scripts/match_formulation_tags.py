"""
配方自动标签匹配脚本
根据配方的名称和描述，自动匹配应用领域、剂型标签
"""

import sqlite3
import re

DB_PATH = 'E:/项目开发区/嘉法狮网站重建/backend/prisma/gattefosse.db'

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# ====== 1. 读取所有配方 ======
cur.execute('SELECT id, name, code, description, application_tag, form_tag, claim_tag, naturality_index FROM formulations ORDER BY id')
formulations = cur.fetchall()
print(f'共 {len(formulations)} 个配方')

# ====== 2. 读取配方标签字典 ======
cur.execute('SELECT category, label, value FROM tag_dictionary WHERE product_line = ? ORDER BY category, sort_order', ('formulation',))
tag_rows = cur.fetchall()

tag_dict = {}  # { category: { label: value } }
for t in tag_rows:
    cat = t['category']
    if cat not in tag_dict:
        tag_dict[cat] = {}
    tag_dict[cat][t['label']] = t['value']

print(f'标签分类: {list(tag_dict.keys())}')
for cat, items in tag_dict.items():
    print(f'  {cat}: {list(items.keys())}')

# ====== 3. 定义关键词匹配规则 ======
# 应用领域匹配规则
application_rules = [
    # (匹配词列表, 标签值)
    (['唇', 'lip', 'Lip', '口红', '唇膏', '唇彩', '润唇', '保湿润色'], '唇部护理'),
    (['眼', 'eye', 'Eye', '眼部', '睫毛', '眼线', '眼影', '黑眼圈', '眼袋', '眼周'], '眼部护理'),
    (['头发', '发 ', '发蜡', '护发', '发丝', '头皮', '毛躁', '卷发', '头发', '发根', '洗发', '发膏'], '头发护理'),
    (['防晒', 'SPF', 'spf', '紫外线', 'sun', 'Sun', '防晒霜', '防晒乳', '防晒棒'], '防晒护理'),
    (['彩妆', '口红', '唇膏', '唇彩', '眼影', '睫毛', '腮红', '粉底', '遮瑕', '眼线', '高光',
      '眉笔', '定妆', '妆前', '底霜', '润色', '液体口红', '粉底液', '散粉', '气垫'], '彩妆'),
    (['身体', 'body', 'Body', '沐浴', '手部', '脚', '足部', '身体乳', '身体霜', '身体喷雾', '身体黄油',
      '全身', 'body butter', '润肤露', '润肤霜'], '身体护理'),
    # 默认: 面部护理 (面霜、精华、面膜等)
]

form_rules = [
    (['乳霜', 'cream', 'Cream', '面霜', '日霜', '晚霜', '眼霜', '修护霜', '凝霜', '按摩霜',
      '屏障霜', '护理霜', '柔肤霜', '面霜', '焕肤霜'], '乳霜'),
    (['精华', 'serum', 'Serum', '精华液', '精华露', '安瓶', '原液'], '精华'),
    (['凝胶', 'gel', 'Gel', '凝露', '果冻', '啫喱', '双凝胶', '晶乳'], '凝胶'),
    (['乳液', 'lotion', '乳', 'Milk', 'milk', '护发乳', '身体乳'], '乳液'),
    (['膏', 'balm', 'Balm', '修护膏', '护理油膏', '润肤膏', '万用膏', '发膏', '营养膏',
      '护发膏', '修护膏'], '膏霜'),
    (['棒', 'stick', 'Stick', '棒状', '粉棒', '笔'], '棒状'),
    (['喷雾', 'spray', 'Spray', '喷雾型'], '喷雾'),
    (['油', 'oil', 'Oil', '护理油'], '油'),
    (['黄油', 'butter', 'Butter', '身体黄油'], '黄油质地'),
    (['粉', 'powder', 'Powder', '散粉', '蜜粉', '压制宝石', '粉底粉'], '粉状'),
    (['面膜', 'mask', 'Mask', '泥膜', '膜'], '糊状'),
    (['软膏', 'ointment', 'Ointment'], '软膏'),
    (['湿巾', 'wipe', 'Wipe'], '湿巾'),
    (['乳状液', 'emulsion', 'Emulsion'], '乳状液'),
]


def match_tags(text, rules):
    """根据文本匹配标签，返回匹配到的标签值列表"""
    if not text:
        return []
    matched = []
    for keywords, tag_label in rules:
        for kw in keywords:
            if kw.lower() in text.lower():
                if tag_label not in matched:
                    matched.append(tag_label)
                break
    return matched


def get_tag_value(category, label):
    """获取标签字典中的value值"""
    if category in tag_dict and label in tag_dict[category]:
        return tag_dict[category][label]
    return label  # 如果没有找到，直接使用label作为value


# ====== 4. 为每个配方匹配标签 ======
updates = []
for f in formulations:
    text = f'{f["name"] or ""} {f["description"] or ""} {f["code"] or ""}'
    
    # 匹配应用领域
    matched_apps = match_tags(text, application_rules)
    # 默认面部护理
    if not matched_apps:
        matched_apps = ['脸部护理']
    # 用value值
    app_values = [get_tag_value('application', a) for a in matched_apps]
    
    # 匹配剂型
    matched_forms = match_tags(text, form_rules)
    form_values = [get_tag_value('form', fv) for fv in matched_forms]
    
    old_app = f['application_tag'] or ''
    old_form = f['form_tag'] or ''
    new_app = ','.join(app_values) if app_values else ''
    new_form = ','.join(form_values) if form_values else ''
    
    if new_app != old_app or new_form != old_form:
        updates.append((new_app, new_form, f['id']))

print(f'\n需要更新 {len(updates)} 个配方')
if updates:
    cur.executemany(
        'UPDATE formulations SET application_tag = ?, form_tag = ? WHERE id = ?',
        updates
    )
    conn.commit()
    print('✅ 更新完成')

# 显示更新详情
print('\n===== 更新详情 =====')
for f in formulations:
    text = f'{f["name"] or ""} {f["description"] or ""}'
    matched_apps = match_tags(text, application_rules)
    if not matched_apps:
        matched_apps = ['脸部护理']
    app_values = [get_tag_value('application', a) for a in matched_apps]
    matched_forms = match_tags(text, form_rules)
    form_values = [get_tag_value('form', fv) for fv in matched_forms]
    
    app_str = ','.join(app_values) if app_values else '-'
    form_str = ','.join(form_values) if form_values else '-'
    print(f'ID:{f["id"]:3d} | {f["name"]:16s} | app:{app_str:20s} | form:{form_str:16s}')

conn.close()
