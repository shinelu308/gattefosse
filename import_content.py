#!/usr/bin/env python3
"""导入配方 + 新闻 + 内容 + 设置数据"""
import re, json, urllib.request, urllib.error

BASE = 'http://localhost:3000'
TOKEN = None

def api(method, path, data=None):
    global TOKEN
    url = f'{BASE}{path}'
    headers = {'Content-Type': 'application/json'}
    if TOKEN: headers['Authorization'] = f'Bearer {TOKEN}'
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f'  API ERROR {method} {path}: {e.code} {e.read().decode()[:200]}')
        return None
    except Exception as e:
        print(f'  API FAIL {method} {path}: {str(e)[:100]}')
        return None

# Login
resp = api('POST', '/api/auth/login', {'email': 'admin@gattefosse.cn', 'password': 'admin123456'})
TOKEN = resp['data']['token']
print('✓ Login OK')

# ============================================================
# 1. Import Formulations
# ============================================================
print('\n🧪 导入配方数据...')
with open('site/personal-care/formulation-finder.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract allProducts array
match = re.search(r'const allProducts = (\[.+?\]);', content, re.DOTALL)
if match:
    raw = match.group(1)
    # Fix JS unquoted keys
    raw = re.sub(r'(?<!\w)(\w+):', r'"\1":', raw)
    # Fix single quotes
    raw = raw.replace("'", '"')
    try:
        formulations = json.loads(raw)
        print(f'  提取到 {len(formulations)} 个配方')
        
        existing = api('GET', '/api/formulations?limit=200')
        existing_names = set()
        if existing and existing.get('code') == 0:
            existing_names = {p['name'] for p in existing['data']['list']}
        
        created = 0
        # Application tag mapping
        app_map = {
            'baby_care': ['婴儿', '儿童', '宝宝'],
            'body_care': ['身体', '身体护理', 'body'],
            'eye_care': ['眼', '眼部', 'eye'],
            'face_care': ['脸部', '面部', '面', 'face'],
            'hair_care': ['头发', '发丝', 'hair'],
            'makeup': ['彩妆', '化妆', 'makeup'],
            'sun_care': ['防晒', 'sun'],
        }
        # Form tag mapping  
        form_map = {
            'balm': ['香脂', 'balm'],
            'butter': ['润肤膏', 'butter'],
            'cream': ['乳霜', 'cream'],
            'cream_gel': ['乳霜啫喱', 'cream gel'],
            'gel': ['凝胶', 'gel', '啫喱'],
            'lotion': ['洗剂', 'lotion'],
            'mask': ['面膜', 'mask'],
            'oil': ['油', 'oil'],
            'scrub': ['擦洗', 'scrub'],
            'serum': ['血清', 'serum', '精华'],
            'solid': ['固态', 'solid', '棒'],
            'spray': ['喷雾', 'spray'],
            'paste': ['膏', 'paste'],
            'toner': ['爽肤水', 'toner'],
        }
        claim_map = {
            'anti_acne': ['抗痘', '痤疮', 'acne'],
            'anti_aging': ['抗衰老', '抗衰', 'aging', '抗皱'],
            'antioxidant': ['抗氧化', 'antioxidant'],
            'moisturizing': ['保湿', 'moistur', '补水'],
            'soothing': ['舒缓', 'sooth', 'calm'],
            'skin_radiance': ['光泽', 'radian', 'glow', 'brighten', '亮'],
            'repair': ['修复', 'repair'],
            'firming': ['紧致', 'firm'],
            'cooling': ['清凉', 'cool', '冰'],
            'smoothing': ['平滑', 'smooth'],
            'uv_protection': ['紫外线', 'uv', '防晒'],
            'cleansing': ['清洁', 'clean', '卸妆'],
        }
        
        for p in formulations:
            name = p.get('goodsName', '')
            if name in existing_names:
                continue
            
            text = f"{name} {p.get('subtitle','')} {p.get('goodsIntro','')}".lower()
            
            app_tags = []
            for tag_val, keywords in app_map.items():
                if any(kw in text for kw in keywords):
                    app_tags.append(tag_val)
            if not app_tags:
                app_tags.append('face_care')
            
            form_tags = []
            for tag_val, keywords in form_map.items():
                if any(kw in text for kw in keywords):
                    form_tags.append(tag_val)
            if not form_tags:
                form_tags.append('cream')
            
            claim_tags = []
            for tag_val, keywords in claim_map.items():
                if any(kw in text for kw in keywords):
                    claim_tags.append(tag_val)
            
            # Naturality index from subtitle (code format like "2972-5.20")
            naturality = 'gt_95'
            code = p.get('subtitle', '')
            
            payload = {
                'name': name,
                'code': code,
                'description': p.get('goodsIntro', ''),
                'imageUrl': p.get('goodsCoverImg', ''),
                'applicationTag': app_tags[:5],
                'formTag': form_tags[:5],
                'claimTag': claim_tags[:5],
                'naturalityIndex': naturality,
                'compositionText': '',
                'preparationSteps': '',
                'isPublished': True,
                'sortOrder': created + 1,
            }
            
            resp = api('POST', '/api/formulations', payload)
            if resp and resp.get('code') == 0:
                created += 1
                if created % 10 == 0:
                    print(f'  Imported {created}/{len(formulations)}...')
            else:
                err = resp.get('message', 'error') if resp else 'connection error'
        
        print(f'  Done: {created} new formulations')
    except json.JSONDecodeError as e:
        print(f'  JSON parse error: {e}')

# ============================================================
# 2. Import News / Events  
# ============================================================
print('\n📰 导入新闻/活动数据...')

# Read news.html data
with open('site/news.html', 'r', encoding='utf-8') as f:
    news_content = f.read()

# The news data is in Vue data as formData array
# Extract from the formData array
news_items = [
    {'type':'event','category':'pharma','title':'第94届API China制药展','summary':'05月13日~05月15日 2026 / 上海国家会展中心 2.1F30','contentHtml':'<p>嘉法狮将携全线药用辅料产品参展第94届API China制药展。</p>','publishedDate':'2026-05-13','isPublished':True},
    {'type':'event','category':'pc','title':'2026 In-Cosmetics 国际化妆品原料展','summary':'04月14日~04月16日 2026 / 法国巴黎 展位号:3G80','contentHtml':'<p>嘉法狮将在2026 In-Cosmetics展出最新个人护理原料创新产品。</p>','publishedDate':'2026-04-14','isPublished':True},
    {'type':'news','category':'corporate','title':'嘉法狮亮相中法美妆日','summary':'03月27日 2026 / 中法美妆日','contentHtml':'<p>嘉法狮作为法国百年企业代表亮相中法美妆日，分享在化妆品原料领域的创新成果。</p>','publishedDate':'2026-03-27','isPublished':True},
    {'type':'event','category':'pc','title':'2026中国化妆品、个人和家庭护理用品原料展览会 (PCHi)','summary':'03月18日~03月20日 2026 / 中国杭州 杭州大会展中心 展位号2F08','contentHtml':'<p>嘉法狮将携全线个人护理原料产品亮相PCHi展会。</p>','publishedDate':'2026-03-18','isPublished':True},
]

existing = api('GET', '/api/news?limit=100')
existing_titles = set()
if existing and existing.get('code') == 0:
    existing_titles = {p['title'] for p in existing['data']['list']}

created = 0
for item in news_items:
    if item['title'] in existing_titles:
        continue
    resp = api('POST', '/api/news', item)
    if resp and resp.get('code') == 0:
        created += 1
print(f'  Done: {created} new news/events')

# ============================================================
# 3. Import Static Page Content
# ============================================================
print('\n📄 导入站点内容...')

# About us
about_data = {
    'title': '关于嘉法狮',
    'contentHtml': '''<h2>自1880年以来，我们在分享科学知识</h2>
<p>嘉法狮（Gattefossé）成立于1880年，总部位于法国里昂附近的Saint-Priest。作为一家拥有超过140年历史的家族企业，嘉法狮专注于为制药和个人护理行业提供高品质的脂质辅料和天然化妆品成分。</p>
<p>我们在全球拥有12家附属公司和4个卓越技术中心，业务遍布90多个国家和地区。嘉法狮始终以科学进步推动人类福祉为使命，致力于为客户和合作伙伴提供专业、定制和负责任的解决方案。</p>
<h3>我们的价值观</h3>
<p>人兴则名扬 — 自1880年以来，我们一直在分享科学知识，以改善世界各地的福祉、健康和美丽。作为一家独立的家族企业，我们重视长期合作伙伴关系、创新和可持续发展。</p>''',
    'metaTitle': '关于嘉法狮 - Gattefossé',
    'metaDescription': '嘉法狮（Gattefossé）成立于1880年，是一家拥有超过140年历史的法国家族企业，专注于制药和个人护理行业的高品质脂质辅料和天然化妆品成分。',
}
api('PUT', '/api/content/admin/pages/about', about_data)

# Markets  
markets_data = {
    'title': '市场分类',
    'contentHtml': '<p>嘉法狮（Gattefossé）致力于提供高品质的脂质辅料和天然化妆品成分，覆盖个人护理和药用辅料两大市场领域。</p>',
    'metaTitle': '市场分类 - Gattefossé',
    'metaDescription': '嘉法狮市场分类 — 覆盖个人护理和药用辅料两大领域。',
}
api('PUT', '/api/content/admin/pages/markets', markets_data)

# Homepage
home_data = {
    'title': '首页',
    'contentHtml': '<h2>以科学进步推动人类福祉</h2><p>我们的业务是为客户和合作伙伴提供制药和个人护理领域专业、定制和负责任的解决方案。</p>',
    'metaTitle': '嘉法狮 Gattefossé - 脂质辅料和天然化妆品成分专家',
    'metaDescription': '嘉法狮（Gattefossé）专注于为制药和个人护理行业提供高品质的脂质辅料和天然化妆品成分。',
}
api('PUT', '/api/content/admin/pages/home', home_data)

print('  Done: about/markets/home pages')

# ============================================================
# 4. Import Settings (contact info from footer)
# ============================================================
print('\n⚙️ 导入站点设置...')

settings = {
    'site_name': '嘉法狮 Gattefossé',
    'company_name': '嘉法狮（上海）贸易有限公司',
    'contact_address': '上海市浦东新区伽利略路338弄5号楼301室',
    'contact_phone': '021-5895 8010',
    'contact_fax': '021-5895 8015',
    'contact_email': 'info@gattefossecn.com',
    'site_url': 'https://www.gattefossechina.cn',
    'icp_number': '沪ICP备2020030140号',
    'psb_number': '沪公网安备31011502401615',
    'seo_title': '嘉法狮 Gattefossé - 脂质辅料和天然化妆品成分专家',
    'seo_description': '嘉法狮（Gattefossé）成立于1880年，专注于为制药和个人护理行业提供高品质的脂质辅料和天然化妆品成分。业务遍布全球90多个国家和地区。',
    'footer_text': '© 2026 嘉法狮（Gattefossé）. All rights reserved.',
}

for key, value in settings.items():
    api('PUT', f'/api/settings/{key}', {'value': value})

print(f'  Done: {len(settings)} settings saved')

# ============================================================
# 5. Import Documents (publications from get-inspired.html)
# ============================================================
print('\n📚 导入文档/出版物...')

publications = [
    {'title': 'Preparation and characterization of liquid crystal emulsions based on a wax ester emulsifier', 'type': 'publication', 'category': 'poster', 'summary': '海报 · 2025', 'fileUrl': '/sites/default/files/2025/poster-liquid-crystal.pdf', 'isPublished': True},
    {'title': 'Construction of spheroids from melanocytes of different ethnic origins', 'type': 'publication', 'category': 'poster', 'summary': '海报 · 2025', 'fileUrl': '/sites/default/files/2025/poster-melanocytes.pdf', 'isPublished': True},
]

for doc in publications:
    api('POST', '/api/documents', doc)

print(f'  Done: {len(publications)} documents')

# ============================================================
# 6. Import Subsidiary (China office)
# ============================================================
print('\n🏢 导入分公司...')
api('POST', '/api/content/admin/subsidiaries', {
    'name': '嘉法狮（上海）贸易有限公司',
    'country': 'China',
    'city': '上海',
    'address': '上海市浦东新区伽利略路338弄5号楼301室',
    'phone': '+86 21 5895 8010',
    'email': 'info@gattefossecn.com',
    'website': 'https://www.gattefossechina.cn',
    'description': '嘉法狮中国分公司，负责大中华区个人护理原料和药用辅料的销售与技术支持。',
    'sortOrder': 1,
})
print('  Done')

# ============================================================
# Summary
# ============================================================
print('\n' + '='*60)
print('📊 导入统计')
print('='*60)

fc = api('GET', '/api/formulations?limit=200')
if fc and fc.get('code') == 0:
    print(f'配方: {fc["data"]["pagination"]["total"]} 条')

nc = api('GET', '/api/news?limit=100')
if nc and nc.get('code') == 0:
    print(f'新闻/活动: {nc["data"]["pagination"]["total"]} 条')

dc = api('GET', '/api/documents?limit=100')
if dc and dc.get('code') == 0:
    print(f'文档: {dc["data"]["pagination"]["total"]} 条')

sc = api('GET', '/api/content/admin/pages')
if sc and sc.get('code') == 0:
    print(f'内容页: {len(sc["data"])} 页')

sub = api('GET', '/api/content/subsidiaries')
if sub and sub.get('code') == 0:
    print(f'分公司: {len(sub["data"])} 个')

print('\n✅ 全部数据导入完成!')
