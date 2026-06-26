#!/usr/bin/env python3
"""从前端 HTML 提取硬编码数据，通过 API 导入到后端数据库"""
import re
import json
import urllib.request
import urllib.error
import os
import sys

BASE_URL = "http://localhost:3000"
SITE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")
TOKEN = None

def api(method, path, data=None):
    """调用后端 API"""
    url = f"{BASE_URL}{path}"
    headers = {"Content-Type": "application/json"}
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"  API ERROR {method} {path}: {e.code} {e.read().decode()[:200]}")
        return None

def login():
    global TOKEN
    resp = api("POST", "/api/auth/login", {"email": "admin@gattefosse.cn", "password": "admin123456"})
    if resp and resp.get("code") == 0:
        TOKEN = resp["data"]["token"]
        print("✓ 登录成功")
        return True
    print("✗ 登录失败")
    return False

# ============================================================
# PC 产品标签智能匹配（基于产品名称/卡码/简介关键词）
# ============================================================
def match_pc_tags(name, card_code, subtitle, intro):
    """根据产品文本内容匹配标签"""
    text = f"{name} {card_code} {subtitle} {intro}".lower()
    
    tags = {
        "functionTag": [],
        "applicationTag": [],
        "conceptTag": [],
        "claimTag": [],
        "featureTag": [],
        "certificationTag": [],
    }
    
    # 功能分类匹配
    func_map = {
        "active_ingredient": ["活性物", "活性成分", "活性", "acti", "gatuline", "cytobiol", "phylderm", "original extract", "fresh cells", "secrets", "noxifense", "solastemis", "elevastin", "energinius", "hema", "mala", "oli", "rhodo", "zin"],
        "emulsifier_o_w": ["o/w乳化剂", "o/w 乳化剂", "水包油", "emulium"],
        "emulsifier_w_o": ["w/o乳化剂", "w/o 乳化剂", "油包水", "plurol"],
        "emollient": ["润肤剂", "emollient", "labrafac", "dppg", "isostearyl", "mod mb"],
        "solubilizer": ["助溶剂", "增溶剂", "transcutol"],
        "texturizer": ["纹理化剂", "蜡状", "textur", "compritol", "lipocire", "acticire", "apifil", "definicire"],
        "plant_extract": ["植物提取", "水果提取", "提取物", "fresh cells", "original extract", "secrets"],
        "emulsifier_free": ["不含乳化剂", "emulfree", "双凝胶"],
        "humectant": ["润湿剂", "保湿"],
    }
    for tag_val, keywords in func_map.items():
        if any(kw in text for kw in keywords):
            tags["functionTag"].append(tag_val)
    
    # 如果没有匹配到功能，根据 cardCode 猜
    if not tags["functionTag"]:
        if "活性" in card_code or "活性" in name:
            tags["functionTag"].append("active_ingredient")
        elif "乳化" in card_code:
            tags["functionTag"].append("emulsifier_o_w")
        elif "润肤" in card_code:
            tags["functionTag"].append("emollient")
    
    # 应用领域匹配
    app_map = {
        "face_care": ["脸部", "面部", "面", "抗衰", "抗皱", "皱纹", "色斑", "亮肤", "提亮"],
        "body_care": ["身体", "身体护理"],
        "eye_care": ["眼", "黑眼圈", "眼袋", "眼部"],
        "hair_care": ["头发", "发丝", "发"],
        "sun_care": ["防晒", "紫外线", "uva", "uvb", "阳光"],
        "baby_care": ["婴儿", "儿童", "宝宝"],
        "makeup": ["彩妆", "化妆", "颜料"],
        "mens_care": ["男士"],
    }
    for tag_val, keywords in app_map.items():
        if any(kw in text for kw in keywords):
            tags["applicationTag"].append(tag_val)
    
    # 默认至少一个
    if not tags["applicationTag"]:
        tags["applicationTag"].append("face_care")
    
    # 概念匹配
    concept_map = {
        "gourmet": ["美食", "水果", "木瓜", "柠檬", "橙", "葡萄", "苹果", "猕猴桃", "草莓", "南瓜", "芒果", "胡萝卜"],
        "inflaging": ["炎症老化", "敏感", "炎症"],
        "mineral_cosmetics": ["矿物", "矿石", "锌", "铜", "铁", "镁", "锰"],
        "traditional_plants": ["传统", "植物"],
        "skin_health": ["皮肤健康", "皮肤屏障", "屏障"],
        "upcycling": ["升级再造", "零浪费"],
        "wax_butter": ["蜡", "黄油", "butter"],
    }
    for tag_val, keywords in concept_map.items():
        if any(kw in text for kw in keywords):
            tags["conceptTag"].append(tag_val)
    
    # 功效宣称匹配
    claim_map = {
        "anti_acne": ["抗痘", "痤疮", "瑕疵", "皮脂"],
        "anti_aging": ["抗衰老", "抗衰", "抗皱", "皱纹", "年轻"],
        "anti_dark_circles": ["黑眼圈", "眼袋"],
        "antioxidant": ["抗氧化", "自由基"],
        "anti_pollution": ["防污染", "污染"],
        "anti_sagging": ["抗下垂", "下垂", "重力", "紧致"],
        "moisturizing": ["保湿", "补水", "润"],
        "soothing": ["舒缓", "敏感", "镇静"],
        "skin_radiance": ["光泽", "亮肤", "提亮", "容光焕发", "肤色"],
        "repair": ["修复", "再生", "愈合"],
        "firming": ["紧致", "紧肤"],
    }
    for tag_val, keywords in claim_map.items():
        if any(kw in text for kw in keywords):
            tags["claimTag"].append(tag_val)
    
    # 产品特性匹配
    feature_map = {
        "iecic": ["中国标准", "iecic"],
        "cold_process": ["冷加工", "冷配"],
        "peg_free": ["不含聚乙二醇", "不含peg", "无peg", "peg-free"],
        "vegan": ["素食", "vegan"],
    }
    for tag_val, keywords in feature_map.items():
        if any(kw in text for kw in keywords):
            tags["featureTag"].append(tag_val)
    
    # 天然认证匹配
    cert_map = {
        "cosmos_approved": ["cosmos", "批准"],
        "cosmos_certified": ["cosmos认证", "认证"],
        "rspo_mb": ["rspo", "质量平衡"],
    }
    for tag_val, keywords in cert_map.items():
        if any(kw in text for kw in keywords):
            tags["certificationTag"].append(tag_val)
    
    return tags

# ============================================================
# 提取 PC 产品数据
# ============================================================
def extract_pc_products():
    """从 personal-care/product-finder.html 提取产品"""
    filepath = os.path.join(SITE_DIR, "personal-care", "product-finder.html")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    # 匹配 allProducts 数组
    pattern = r'\{[^}]*?ID:\s*(\d+)[^}]*?goodsName:\s*[\'"]([^\'"]+)[\'"][^}]*?subtitle:\s*[\'"]([^\'"]*)[\'"][^}]*?cardCode:\s*[\'"]([^\'"]*)[\'"][^}]*?goodsIntro:\s*[\'"]([^\'"]*)[\'"][^}]*?goodsCoverImg:\s*[\'"]([^\'"]*)[\'"]'
    matches = re.findall(pattern, content)
    
    products = []
    for m in matches:
        products.append({
            "id": int(m[0]),
            "name": m[1].strip(),
            "subtitle": m[2].strip(),
            "inci": m[3].strip(),
            "intro": m[4].strip(),
            "image": m[5].strip(),
        })
    return products

# ============================================================
# 提取 Pharma 产品数据
# ============================================================
def extract_pharma_products():
    """从 pharmaceuticals/product-finder.html 提取产品"""
    filepath = os.path.join(SITE_DIR, "pharmaceuticals", "product-finder.html")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    products = []
    # 匹配 Vue data 中的 productList
    # 更宽松的正则匹配
    pattern = r'\{[^}]*?(?:ID|id)\s*:\s*(\d+)[^}]*?(?:goodsName|name)\s*:\s*[\'"]([^\'"]+)[\'"]'
    matches = re.findall(pattern, content)
    
    # 尝试更完整的提取
    alt_pattern = r'\{\s*(?:ID|id)\s*:\s*(\d+)\s*,\s*(?:goodsName|name)\s*:\s*[\'"]([^\'"]+)[\'"]\s*,\s*(?:subtitle|cardCode)\s*:\s*[\'"]([^\'"]*)[\'"]\s*,\s*(?:cardCode|subtitle)\s*:\s*[\'"]([^\'"]*)[\'"]\s*,\s*(?:goodsIntro|intro)\s*:\s*[\'"]([^\'"]*)[\'"]'
    alt_matches = re.findall(alt_pattern, content)
    
    if alt_matches:
        for m in alt_matches:
            # 判断哪个是 subtitle 哪个是 cardCode
            name = m[1].strip()
            a = m[2].strip()
            b = m[3].strip()
            subtitle = a if len(a) < 30 else ""
            card_code = b if len(b) < 100 and not subtitle else a
            products.append({
                "id": int(m[0]),
                "name": name,
                "subtitle": subtitle,
                "inci": card_code,
                "intro": m[4].strip() if len(m) > 4 else "",
                "image": "",
            })
    else:
        # Fallback: just extract IDs and names
        for m in matches:
            products.append({
                "id": int(m[0]),
                "name": m[1].strip(),
                "subtitle": "",
                "inci": "",
                "intro": "",
                "image": "",
            })
    
    return products

def match_pharma_tags(name, intro):
    """匹配药用辅料标签"""
    text = f"{name} {intro}".lower()
    tags = {
        "marketTag": [],
        "routeTag": [],
        "functionalityTag": [],
        "dosageFormTag": [],
    }
    
    # 市场
    if any(kw in text for kw in ["generic", "仿制药"]):
        tags["marketTag"].append("generic")
    if any(kw in text for kw in ["innovator", "创新药", "新药"]):
        tags["marketTag"].append("innovator")
    if any(kw in text for kw in ["otc", "非处方"]):
        tags["marketTag"].append("otc")
    if any(kw in text for kw in ["veterinary", "兽药", "动物"]):
        tags["marketTag"].append("veterinary")
    if not tags["marketTag"]:
        tags["marketTag"].append("generic")
    
    # 给药途径
    if any(kw in text for kw in ["oral", "口服", "胶囊", "片剂"]):
        tags["routeTag"].append("oral")
    if any(kw in text for kw in ["topical", "外用", "皮肤", "乳膏"]):
        tags["routeTag"].append("topical")
    if any(kw in text for kw in ["injectable", "注射"]):
        tags["routeTag"].append("injectable")
    if any(kw in text for kw in ["nasal", "鼻用"]):
        tags["routeTag"].append("nasal")
    if not tags["routeTag"]:
        tags["routeTag"].append("oral")
    
    # 功能
    func_map = {
        "solubilizer": ["增溶", "solubil", "助溶"],
        "emulsifier": ["乳化", "emulsif"],
        "bioavailability_enhancer": ["生物利用度", "bioavail", "吸收促进"],
        "lipid_excipient": ["脂质", "lipid", "油脂"],
        "coating_agent": ["包衣", "coat"],
        "binder": ["粘合", "bind"],
        "filler": ["填充", "fill"],
        "disintegrant": ["崩解", "disintegr"],
        "lubricant": ["润滑", "lubric"],
        "matrix_former": ["骨架", "matrix"],
        "solvent": ["溶剂", "solvent"],
        "surfactant": ["表面活性", "surfact"],
        "penetration_enhancer": ["促渗", "penetrat", "渗透"],
        "antioxidant_excipient": ["抗氧化", "antioxid"],
        "preservative": ["防腐", "preserv"],
        "suspending_agent": ["助悬", "suspend"],
        "viscosity_modifier": ["粘度", "viscos", "增稠"],
        "plasticizer": ["增塑", "plastic"],
        "taste_masking": ["掩味", "taste mask", "矫味"],
    }
    for tag_val, keywords in func_map.items():
        if any(kw in text for kw in keywords):
            tags["functionalityTag"].append(tag_val)
    if not tags["functionalityTag"]:
        tags["functionalityTag"].append("lipid_excipient")
    
    # 剂型
    form_map = {
        "tablet": ["片剂", "tablet", "片"],
        "capsule": ["胶囊", "capsul"],
        "cream": ["乳膏", "cream", "软膏", "ointment"],
        "gel": ["凝胶", "gel"],
        "solution": ["溶液", "solution", "口服液"],
        "suspension": ["混悬", "suspension"],
        "emulsion": ["乳剂", "emulsion"],
        "suppository": ["栓剂", "suppositor"],
        "injection": ["注射", "injection"],
        "patch": ["贴剂", "patch"],
        "powder": ["粉末", "powder"],
        "granule": ["颗粒", "granul"],
        "pellet": ["微丸", "pellet"],
        "film": ["膜剂", "film"],
        "aerosol": ["气雾", "aerosol", "喷雾"],
    }
    for tag_val, keywords in form_map.items():
        if any(kw in text for kw in keywords):
            tags["dosageFormTag"].append(tag_val)
    if not tags["dosageFormTag"]:
        tags["dosageFormTag"].append("capsule")
    
    return tags

# ============================================================
# 主导入流程
# ============================================================
def import_pc_products():
    print("\n" + "="*60)
    print("📦 导入个人护理原料产品")
    print("="*60)
    
    products = extract_pc_products()
    print(f"提取到 {len(products)} 个产品")
    
    # 检查已存在的
    existing = api("GET", "/api/pc-ingredients?limit=200")
    existing_names = set()
    if existing and existing.get("code") == 0:
        existing_names = {p["name"] for p in existing["data"]["list"]}
        print(f"数据库中已有 {len(existing_names)} 个产品")
    
    created = 0
    skipped = 0
    for i, p in enumerate(products):
        if p["name"] in existing_names:
            skipped += 1
            continue
        
        tags = match_pc_tags(p["name"], p["inci"], p["subtitle"], p["intro"])
        
        payload = {
            "name": p["name"],
            "subtitle": p["subtitle"],
            "inciName": p["inci"].replace("INCI: ", "").replace("INCI:", "").strip(),
            "description": p["intro"],
            "imageUrl": p["image"],
            "functionTag": tags["functionTag"][:5],
            "applicationTag": tags["applicationTag"][:5],
            "conceptTag": tags["conceptTag"][:5],
            "claimTag": tags["claimTag"][:5],
            "featureTag": tags["featureTag"][:5],
            "certificationTag": tags["certificationTag"][:5],
            "isPublished": True,
            "sortOrder": i + 1,
        }
        
        resp = api("POST", "/api/pc-ingredients", payload)
        if resp and resp.get("code") == 0:
            created += 1
            if created % 10 == 0:
                print(f"  已导入 {created}/{len(products) - skipped}...")
        else:
            err = resp.get("message", "未知错误") if resp else "连接失败"
            print(f"  ✗ {p['name']}: {err}")
    
    print(f"✓ PC 产品导入完成: 新增 {created}, 跳过 {skipped}")

def import_pharma_products():
    print("\n" + "="*60)
    print("💊 导入药用辅料产品")
    print("="*60)
    
    products = extract_pharma_products()
    print(f"提取到 {len(products)} 个产品")
    
    # 检查已存在的
    existing = api("GET", "/api/pharma-products?limit=200")
    existing_names = set()
    if existing and existing.get("code") == 0:
        existing_names = {p["name"] for p in existing["data"]["list"]}
        print(f"数据库中已有 {len(existing_names)} 个产品")
    
    created = 0
    skipped = 0
    for i, p in enumerate(products):
        if p["name"] in existing_names:
            skipped += 1
            continue
        
        tags = match_pharma_tags(p["name"], p["intro"])
        
        payload = {
            "name": p["name"],
            "subtitle": p["subtitle"],
            "description": p["intro"] or p["name"],
            "imageUrl": p["image"],
            "marketTag": tags["marketTag"],
            "routeTag": tags["routeTag"],
            "functionalityTag": tags["functionalityTag"],
            "dosageFormTag": tags["dosageFormTag"],
            "isPublished": True,
            "sortOrder": i + 1,
        }
        
        resp = api("POST", "/api/pharma-products", payload)
        if resp and resp.get("code") == 0:
            created += 1
            if created % 10 == 0:
                print(f"  已导入 {created}/{len(products) - skipped}...")
        else:
            err = resp.get("message", "未知错误") if resp else "连接失败"
            print(f"  ✗ {p['name']}: {err}")
    
    print(f"✓ 药用辅料导入完成: 新增 {created}, 跳过 {skipped}")

# ============================================================
# 运行
# ============================================================
if __name__ == "__main__":
    print("🔧 嘉法狮数据导入工具")
    print(f"   后端地址: {BASE_URL}")
    
    if not login():
        sys.exit(1)
    
    import_pc_products()
    import_pharma_products()
    
    # 验证结果
    print("\n" + "="*60)
    print("📊 导入结果统计")
    print("="*60)
    
    pc = api("GET", "/api/pc-ingredients?limit=200")
    if pc and pc.get("code") == 0:
        print(f"个人护理原料: {pc['data']['pagination']['total']} 个")
    
    ph = api("GET", "/api/pharma-products?limit=200")
    if ph and ph.get("code") == 0:
        print(f"药用辅料: {ph['data']['pagination']['total']} 个")
    
    print("\n✅ 数据导入完成！")
