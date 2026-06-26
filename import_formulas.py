#!/usr/bin/env python3
"""导入配方数据 - 使用逐字段正则提取"""
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
    except Exception as e:
        return None

resp = api('POST', '/api/auth/login', {'email': 'admin@gattefosse.cn', 'password': 'admin123456'})
TOKEN = resp['data']['token']

# Read formulation finder
with open('site/personal-care/formulation-finder.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract each object from allProducts array
# Match pattern: {ID:NNN,goodsName:'...',subtitle:'...',goodsIntro:'...',goodsCoverImg:'...',...}
pattern = r'\{ID:(\d+),goodsName:\'([^\']+)\',subtitle:\'([^\']*)\',goodsIntro:\'([^\']*)\',goodsCoverImg:\'([^\']*)\'[^}]*\}'
matches = re.findall(pattern, content)
print(f'Extracted {len(matches)} formulations')

existing = api('GET', '/api/formulations?limit=200')
existing_names = set()
if existing and existing.get('code') == 0:
    existing_names = {p['name'] for p in existing['data']['list']}

# Tag matching maps
app_map = {
    'baby_care': ['婴儿', '宝宝'],
    'body_care': ['身体', 'body'],
    'eye_care': ['眼', '黑眼圈', '眼袋', '浮肿', 'eye'],
    'face_care': ['面', '脸', '腮红', '唇', 'face', '肤色', '底妆', '粉底'],
    'hair_care': ['头发', '发丝', '卷发', 'hair', '护发'],
    'makeup': ['口红', '唇膏', '腮红', '粉底', '粉末', 'makeup', '彩妆', '唇妆'],
    'sun_care': ['防晒', '紫外线', 'uv', 'sun'],
}
form_map = {
    'balm': ['香脂', 'balm', '膏'],
    'butter': ['润肤膏', 'butter'],
    'cream': ['乳霜', 'cream', '面霜', '日霜', '有色霜', '有色面霜', '眼霜'],
    'gel': ['凝胶', 'gel', '啫喱', '双凝胶'],
    'lotion': ['洗剂', 'lotion'],
    'mask': ['面膜', 'mask'],
    'oil': ['油', 'oil'],
    'scrub': ['擦洗', 'scrub'],
    'serum': ['精华', 'serum', '精华液', '精华粉底'],
    'solid': ['固态', 'solid', '棒', '压制', '粉末'],
    'spray': ['喷雾', 'spray'],
    'paste': ['膏', 'paste', '护发膏'],
    'toner': ['爽肤水', 'toner'],
}
claim_map = {
    'anti_aging': ['抗衰老', '抗衰', 'anti.age', '焕肤', '焕新'],
    'moisturizing': ['保湿', 'moistur', '补水', '润', '水润'],
    'soothing': ['舒缓', 'sooth', '舒适'],
    'skin_radiance': ['亮', '光泽', '闪耀', 'radian', 'glow', '提亮', '闪亮'],
    'repair': ['修复', 'repair'],
    'firming': ['紧致', 'firm', '紧', '提升'],
    'smoothing': ['平滑', 'smooth', '丝滑', '滑'],
    'cooling': ['冰', '清凉', 'cool', '冰霜', '冰爽', '冰感'],
    'uv_protection': ['防晒', 'uv'],
    'cleansing': ['清洁', 'clean', '卸妆'],
    'anti_dark_circles': ['黑眼圈', '眼袋', 'dark circle'],
    'long_lasting': ['持久', 'lasting'],
}

created = 0
for i, m in enumerate(matches):
    obj_id, name, subtitle, intro, image = m
    if name in existing_names:
        continue
    
    text = f"{name} {intro}".lower()
    
    app_tags = []
    for tag_val, keywords in app_map.items():
        if any(kw in text for kw in keywords):
            app_tags.append(tag_val)
    if not app_tags:
        app_tags = ['face_care']
    
    form_tags = []
    for tag_val, keywords in form_map.items():
        if any(kw in text for kw in keywords):
            form_tags.append(tag_val)
    if not form_tags:
        form_tags = ['cream']
    
    claim_tags = []
    for tag_val, keywords in claim_map.items():
        if any(kw in text for kw in keywords):
            claim_tags.append(tag_val)
    if not claim_tags:
        claim_tags = ['moisturizing']
    
    payload = {
        'name': name,
        'code': subtitle or '',
        'description': intro,
        'imageUrl': image,
        'applicationTag': app_tags[:5],
        'formTag': form_tags[:5],
        'claimTag': claim_tags[:5],
        'naturalityIndex': 'gt_95',
        'compositionText': '',
        'preparationSteps': '',
        'isPublished': True,
        'sortOrder': i + 1,
    }
    
    resp = api('POST', '/api/formulations', payload)
    if resp and resp.get('code') == 0:
        created += 1
        if created % 10 == 0:
            print(f'  {created}/{len(matches)}...')
    else:
        err = resp.get('message', '?') if resp else 'connection error'

print(f'Done: {created} formulations')

# Stats
fc = api('GET', '/api/formulations?limit=200')
if fc and fc.get('code') == 0:
    print(f'Total formulations in DB: {fc["data"]["pagination"]["total"]}')
