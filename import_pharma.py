#!/usr/bin/env python3
"""导入 Pharma 产品数据"""
import re, json, urllib.request, urllib.error

BASE = 'http://localhost:3000'
TOKEN = None

def api(method, path, data=None):
    global TOKEN
    url = f'{BASE}{path}'
    headers = {'Content-Type': 'application/json'}
    if TOKEN:
        headers['Authorization'] = f'Bearer {TOKEN}'
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req)
        return json.loads(resp.read())
    except Exception as e:
        return None

# Login
resp = api('POST', '/api/auth/login', {'email': 'admin@gattefosse.cn', 'password': 'admin123456'})
TOKEN = resp['data']['token']
print('Login OK')

# Read pharma file and extract productList
with open('site/pharmaceuticals/product-finder.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

start = None
end = None
for i, line in enumerate(lines):
    if 'productList:' in line and '[' in line:
        start = i
    if start and line.strip() == '],':
        end = i
        break

print(f'productList lines: {start} to {end}')

# Extract and parse JSON
block = ''.join(lines[start:end+1])
# Replace JS unquoted keys with JSON quoted keys
block = re.sub(r'(?m)^\s*(\w+):', r'"\1":', block)
block = block.replace('productList:', '"productList":')
# Handle trailing comma
block = block.replace(',\n]', '\n]')

data = json.loads('{' + block.strip().rstrip(',') + '}')
products = data['productList']
print(f'Parsed {len(products)} products')

existing = api('GET', '/api/pharma-products?limit=300')
existing_names = set()
if existing and existing.get('code') == 0:
    existing_names = {p['name'] for p in existing['data']['list']}

created = 0
for i, p in enumerate(products):
    name = p.get('goodsName', p.get('name', ''))
    if name in existing_names:
        continue
    
    text = f"{name} {p.get('subtitle','')} {p.get('goodsIntro','')}".lower()
    tags = {'marketTag': [], 'routeTag': [], 'functionalityTag': [], 'dosageFormTag': []}
    
    if any(kw in text for kw in ['veterinary', '兽药']):
        tags['marketTag'].append('veterinary')
    if any(kw in text for kw in ['dietary', '膳食', 'nutraceutical']):
        pass  # generic still gets added
    if not tags['marketTag']:
        tags['marketTag'].append('generic')
    
    route_kw = {
        'suppository': ['suppository', '栓剂', 'suppocire', 'ovucire'],
        'topical': ['topical', 'transdermal', '经皮', '外用'],
        'oral': ['oral', '口服', 'tablet', 'capsule', 'gelucire', 'compritol', 'precirol', 'peceol', 'maisine', 'labrafil', 'labrasol', 'gelot', 'laur'],
        'injectable': ['inject', '注射'],
        'nasal': ['nasal', '鼻'],
    }
    for tag_val, keywords in route_kw.items():
        if any(kw in text for kw in keywords):
            tags['routeTag'].append(tag_val)
    if not tags['routeTag']:
        tags['routeTag'].append('oral')
    
    func_map = {
        'solubilizer': ['solubil', '增溶', 'labrasol', 'transcutol'],
        'emulsifier': ['emulsif', '乳化', 'labrafil', 'gelot', 'monosteol', 'maisine', 'plurol'],
        'bioavailability_enhancer': ['bioavail', '吸收', 'penetration', '渗透', 'enhancer', 'transcutol', 'labrasol', 'peceol'],
        'lipid_excipient': ['lipid', '脂质', 'labrafac', 'maisine', 'peceol', 'oleique'],
        'coating_agent': ['coat', '包衣', 'compritol'],
        'binder': ['bind', '粘合', 'direct compression', '直接压片'],
        'lubricant': ['lubricant', '润滑', 'compritol', 'precirol', 'lubritab'],
        'matrix_former': ['matrix', '骨架', '缓释', 'sustained', 'gelucire', 'compritol', 'precirol'],
        'surfactant': ['surfactant', '表面活性', 'labrasol', 'gelucire', 'gelot'],
        'penetration_enhancer': ['penetration', '渗透', '经皮', 'transdermal', 'transcutol'],
        'taste_masking': ['taste mask', '掩味', '矫味'],
    }
    for tag_val, keywords in func_map.items():
        if any(kw in text for kw in keywords):
            tags['functionalityTag'].append(tag_val)
    if not tags['functionalityTag']:
        tags['functionalityTag'].append('lipid_excipient')
    
    form_map = {
        'suppository': ['suppository', '栓剂', 'suppocire', 'ovucire'],
        'tablet': ['tablet', '片剂', 'direct compression', '直接压片', 'lubritab'],
        'capsule': ['capsule', '胶囊', 'gelucire', 'labrasol', 'peceol', 'maisine', 'labrafil', 'gelot'],
        'cream': ['cream', '乳膏', 'ointment', '软膏', 'topical'],
        'ointment': ['ointment', '软膏'],
        'solution': ['solution', '溶液', 'transcutol'],
        'suspension': ['suspension', '混悬'],
        'emulsion': ['emulsion', '乳剂', 'labrafil', 'maisine'],
        'injection': ['injection', '注射'],
        'pellet': ['pellet', '微丸'],
        'powder': ['powder', '粉末'],
        'granule': ['granul', '颗粒'],
    }
    for tag_val, keywords in form_map.items():
        if any(kw in text for kw in keywords):
            tags['dosageFormTag'].append(tag_val)
    if not tags['dosageFormTag']:
        tags['dosageFormTag'].append('capsule')
    
    payload = {
        'name': name,
        'subtitle': p.get('subtitle', ''),
        'description': p.get('goodsIntro', ''),
        'imageUrl': p.get('goodsCoverImg', ''),
        'marketTag': tags['marketTag'],
        'routeTag': tags['routeTag'],
        'functionalityTag': tags['functionalityTag'],
        'dosageFormTag': tags['dosageFormTag'],
        'isPublished': True,
        'sortOrder': i + 1,
    }
    
    resp = api('POST', '/api/pharma-products', payload)
    if resp and resp.get('code') == 0:
        created += 1
        if created % 10 == 0:
            print(f'  Imported {created}...')
    else:
        err = resp.get('message', 'error') if resp else 'connection error'
        print(f'  X {name}: {err}')

print(f'Done: {created} new pharma products')
