import sqlite3

conn = sqlite3.connect('gattefosse.db')
cur = conn.cursor()

# 1. 删除旧的 formulation 标签
cur.execute("DELETE FROM tag_dictionary WHERE product_line='formulation'")
print(f'删除旧标签: {cur.rowcount} 条')

# 2. 插入所有新标签
all_tags = [
    # === 应用领域 (8项) ===
    ('application', '婴儿/儿童护理', '婴儿/儿童护理', 0),
    ('application', '身体护理', '身体护理', 1),
    ('application', '眼部护理', '眼部护理', 2),
    ('application', '脸部护理', '脸部护理', 3),
    ('application', '脸部和头皮护理', '脸部和头皮护理', 4),
    ('application', '彩妆', '彩妆', 5),
    ('application', '防晒', '防晒', 6),
    ('application', '男士护理', '男士护理', 7),
    # === 性状 (14项) ===
    ('form', '香脂', '香脂', 0),
    ('form', '润肤膏', '润肤膏', 1),
    ('form', '乳霜', '乳霜', 2),
    ('form', '乳霜啫喱', '乳霜啫喱', 3),
    ('form', '凝胶', '凝胶', 4),
    ('form', '洗剂', '洗剂', 5),
    ('form', '面膜', '面膜', 6),
    ('form', '油', '油', 7),
    ('form', '擦洗', '擦洗', 8),
    ('form', '血清', '血清', 9),
    ('form', '固态', '固态', 10),
    ('form', '喷雾', '喷雾', 11),
    ('form', '膏', '膏', 12),
    ('form', '爽肤水', '爽肤水', 13),
    # === 声明 (32项) ===
    ('claim', '抗痘', '抗痘', 0),
    ('claim', '抗衰老', '抗衰老', 1),
    ('claim', '抗黑眼圈及眼袋', '抗黑眼圈及眼袋', 2),
    ('claim', '抗氧化', '抗氧化', 3),
    ('claim', '抗下垂', '抗下垂', 4),
    ('claim', '抗斑', '抗斑', 5),
    ('claim', '抗皱', '抗皱', 6),
    ('claim', '细胞更新', '细胞更新', 7),
    ('claim', '洁面', '洁面', 8),
    ('claim', '冷却', '冷却', 9),
    ('claim', '排毒', '排毒', 10),
    ('claim', '充满活力', '充满活力', 11),
    ('claim', 'Hair discipline', 'Hair discipline', 12),
    ('claim', '紧致', '紧致', 13),
    ('claim', 'Hair protection', 'Hair protection', 14),
    ('claim', '哑光', '哑光', 15),
    ('claim', '保湿', '保湿', 16),
    ('claim', '滋补', '滋补', 17),
    ('claim', '去皮', '去皮', 18),
    ('claim', '光老化', '光老化', 19),
    ('claim', 'Photo-protection', 'Photo-protection', 20),
    ('claim', '净化', '净化', 21),
    ('claim', '放松', '放松', 22),
    ('claim', '修复', '修复', 23),
    ('claim', '焕发活力', '焕发活力', 24),
    ('claim', '擦洗', '擦洗', 25),
    ('claim', '皮脂控制', '皮脂控制', 26),
    ('claim', '皮肤问题', '皮肤问题', 27),
    ('claim', '皮肤光泽', '皮肤光泽', 28),
    ('claim', '平滑', '平滑', 29),
    ('claim', '舒缓', '舒缓', 30),
    ('claim', '紫外线防护', '紫外线防护', 31),
    # === 天然指数 (4项) ===
    ('naturalityIndex', '> 99%', '> 99%', 0),
    ('naturalityIndex', '> 98%', '> 98%', 1),
    ('naturalityIndex', '> 95%', '> 95%', 2),
    ('naturalityIndex', '> 90%', '> 90%', 3),
    # === 成分/概念 (39项) ===
    ('ingredient', 'Solastemis', 'Solastemis', 0),
    ('ingredient', 'Acticire MB', 'Acticire MB', 1),
    ('ingredient', 'Compritol 888 CG MB', 'Compritol 888 CG MB', 2),
    ('ingredient', 'Cytobiol Iris A2', 'Cytobiol Iris A2', 3),
    ('ingredient', 'Definicire', 'Definicire', 4),
    ('ingredient', 'DPPG CG', 'DPPG CG', 5),
    ('ingredient', 'EleVastin', 'EleVastin', 6),
    ('ingredient', 'Emulfree CBG MB', 'Emulfree CBG MB', 7),
    ('ingredient', 'Emulium 22 MB', 'Emulium 22 MB', 8),
    ('ingredient', 'Emulium Delta MB', 'Emulium Delta MB', 9),
    ('ingredient', 'Emulium Dermolea MB', 'Emulium Dermolea MB', 10),
    ('ingredient', 'Emulium Dolcea MB', 'Emulium Dolcea MB', 11),
    ('ingredient', 'Emulium Illustro', 'Emulium Illustro', 12),
    ('ingredient', 'Emulium Kappa MB', 'Emulium Kappa MB', 13),
    ('ingredient', 'Emulium Mellifera MB', 'Emulium Mellifera MB', 14),
    ('ingredient', 'EnergiNius', 'EnergiNius', 15),
    ('ingredient', 'Gatuline Age Defense NP', 'Gatuline Age Defense NP', 16),
    ('ingredient', 'Gatuline Expression AF', 'Gatuline Expression AF', 17),
    ('ingredient', 'Gatuline In-Tense MB', 'Gatuline In-Tense MB', 18),
    ('ingredient', 'Gatuline Link n Lift', 'Gatuline Link n Lift', 19),
    ('ingredient', 'Gatuline Radiance', 'Gatuline Radiance', 20),
    ('ingredient', 'Gatuline RC Bio', 'Gatuline RC Bio', 21),
    ('ingredient', 'Gatuline Renew', 'Gatuline Renew', 22),
    ('ingredient', 'Gatuline Skin-Repair AF', 'Gatuline Skin-Repair AF', 23),
    ('ingredient', 'Hema Tite', 'Hema Tite', 24),
    ('ingredient', 'Labrafac CC MB', 'Labrafac CC MB', 25),
    ('ingredient', 'Lemon Secrets', 'Lemon Secrets', 26),
    ('ingredient', 'Lipocire A SG', 'Lipocire A SG', 27),
    ('ingredient', 'Mala Kite', 'Mala Kite', 28),
    ('ingredient', 'MOD MB', 'MOD MB', 29),
    ('ingredient', 'Oli Vine ST', 'Oli Vine ST', 30),
    ('ingredient', 'Original extract Ginger', 'Original extract Ginger', 31),
    ('ingredient', 'Original extract Grape Bio', 'Original extract Grape Bio', 32),
    ('ingredient', 'Original extract Grapefruit', 'Original extract Grapefruit', 33),
    ('ingredient', 'Original extract Kiwi', 'Original extract Kiwi', 34),
    ('ingredient', 'Original extract Lemon Bio', 'Original extract Lemon Bio', 35),
    ('ingredient', 'Original extract Lotus', 'Original extract Lotus', 36),
    ('ingredient', 'Original extract Orange Bio', 'Original extract Orange Bio', 37),
    ('ingredient', 'Plurol Stearique MB', 'Plurol Stearique MB', 38),
    ('ingredient', 'Exsensence', 'Exsensence', 39),
    ('ingredient', 'Acticire MB2', 'Acticire MB2', 40),
    ('ingredient', 'Emulgreen ECO 10-06 MB', 'Emulgreen ECO 10-06 MB', 41),
    ('ingredient', 'Coviopol', 'Coviopol', 42),
    ('ingredient', 'Deltinol A P', 'Deltinol A P', 43),
    ('ingredient', 'Gelucire 48/16', 'Gelucire 48/16', 44),
    ('ingredient', 'Precirol ATO 5', 'Precirol ATO 5', 45),
    ('ingredient', 'Transcutol CG', 'Transcutol CG', 46),
    ('ingredient', 'Labrasol', 'Labrasol', 47),
    ('ingredient', 'Acconon C-50', 'Acconon C-50', 48),
    ('ingredient', 'Montanov L', 'Montanov L', 49),
    ('ingredient', 'Sepinov EMT 10', 'Sepinov EMT 10', 50),
    ('ingredient', 'Simulsol 165', 'Simulsol 165', 51),
    ('ingredient', 'Lanette O', 'Lanette O', 52),
    ('ingredient', 'Apifil', 'Apifil', 53),
]

for cat, label, value, order in all_tags:
    cur.execute(
        "INSERT INTO tag_dictionary (category, product_line, label, value, sort_order) VALUES (?, 'formulation', ?, ?, ?)",
        (cat, label, value, order)
    )

conn.commit()

# 统计
cur.execute("SELECT category, COUNT(*) FROM tag_dictionary WHERE product_line='formulation' GROUP BY category ORDER BY category")
print('=== 新标签统计 ===')
for r in cur.fetchall():
    print(f'  {r[0]}: {r[1]} 项')
cur.execute("SELECT COUNT(*) FROM tag_dictionary WHERE product_line='formulation'")
print(f'  总计: {cur.fetchone()[0]} 条')

# 添加 concept_tag 字段
cur.execute("SELECT name FROM pragma_table_info('formulations') WHERE name='concept_tag'")
if not cur.fetchone():
    cur.execute("ALTER TABLE formulations ADD COLUMN concept_tag TEXT NOT NULL DEFAULT ''")
    conn.commit()
    print('\n已添加 concept_tag 字段到 formulations 表')
else:
    print('\nconcept_tag 字段已存在，跳过')

conn.close()
print('完成!')
