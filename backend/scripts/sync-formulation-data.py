"""
从原中文站 gattefossechina.cn 同步配方数据
自动为现有配方关联 天然指数(naturality_index) 和 成分/概念标签(concept_tag)

用法: python3 scripts/sync-formulation-data.py   # 抓取数据生成 JSON
       npx tsx scripts/sync-formulation-data.ts  # 导入到数据库
"""

import urllib.request
import json
import re
import time
import os

API_BASE = 'https://www.gattefossechina.cn/api'

# 天然指数标签映射：picto 中有"天然"即为天然产品，使用 >95% 作为默认值
# 注意：值必须与 tag_dictionary 中的 value 一致（格式: '> XX%'）
DEFAULT_NATURALITY_TAG = '> 95%'

def fetch_json(url: str, timeout: int = 15) -> dict:
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
            })
            r = urllib.request.urlopen(req, timeout=timeout)
            return json.loads(r.read())
        except Exception as e:
            if attempt < 2:
                print(f'  ⚠ 重试 {attempt+1}/3: {e}')
                time.sleep(2)
            else:
                raise

def main():
    output_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
    os.makedirs(output_dir, exist_ok=True)

    # ========== Step 1: 获取所有配方 ==========
    print('�� Step 1: 获取配方列表...')
    list_data = fetch_json(f'{API_BASE}/mallGoodsInfo/getMallGoodsInfoList?pageSize=250&pageNum=1')
    all_products = list_data.get('data', {}).get('list', [])
    formulations = [p for p in all_products if p.get('goodsCategoryId') == 120]
    print(f'   共获取 {len(formulations)} 个配方')

    # ========== Step 2: 获取所有成分产品 ==========
    print('\n📦 Step 2: 获取成分产品列表...')
    ing_data = fetch_json(f'{API_BASE}/mallGoodsInfo/getMallGoodsInfoList?pageSize=250&pageNum=1&goodsCategoryId=121')
    ingredients = ing_data.get('data', {}).get('list', [])
    ing_name_map = {ing['ID']: ing['goodsName'] for ing in ingredients}
    print(f'   共获取 {len(ingredients)} 个成分产品')

    # ========== Step 3: 解析数据 ==========
    print('\n🔍 Step 3: 解析配方数据...')
    results = []

    for idx, f in enumerate(formulations):
        code = f.get('subtitle', '')
        name = f.get('goodsName', '')
        print(f'   [{idx+1}/{len(formulations)}] {name} ({code})', end='')

        # 3a. 天然指数：从 picto 中判断 "天然" 标签
        picto = f.get('picto', '')
        picto_texts = re.findall(r'<p[^>]*class="s-product-picto__text"[^>]*>(.*?)</p>', picto)
        is_natural = '天然' in picto_texts
        nat_tag = DEFAULT_NATURALITY_TAG if is_natural else ''
        print(f'  天然:{"是→"+nat_tag if is_natural else "否"}', end='')

        # 3b. 成分标签：从 relatedProducts 映射
        rp_raw = f.get('relatedProducts', '')
        concept_tags = []
        try:
            if rp_raw and rp_raw.strip() not in ['""', '']:
                rp_list = json.loads(rp_raw)
                for item in rp_list:
                    if isinstance(item, list) and len(item) > 0:
                        pid = item[0]
                        ing_name = ing_name_map.get(pid)
                        if ing_name:
                            concept_tags.append(ing_name)
        except json.JSONDecodeError:
            pass

        if concept_tags:
            print(f'  成分:{",".join(concept_tags)}', end='')
        else:
            print('  无成分', end='')
        print()

        results.append({
            'code': code,
            'name': name,
            'id_on_source': f.get('ID'),
            'picto_texts': picto_texts,
            'is_natural': is_natural,
            'naturality_tag': nat_tag,
            'concept_tags': concept_tags,
        })

    # ========== Step 4: 保存结果 ==========
    print(f'\n💾 Step 4: 保存结果...')
    output_path = os.path.join(output_dir, 'formulation_sync_data.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({
            'total': len(results),
            'results': results,
        }, f, ensure_ascii=False, indent=2)
    print(f'   已保存到 {output_path}')

    # 统计
    nat_count = sum(1 for r in results if r['naturality_tag'])
    ing_count = sum(1 for r in results if r['concept_tags'])
    total_ing = sum(len(r['concept_tags']) for r in results)
    print(f'\n📊 统计:')
    print(f'   配方总数: {len(results)}')
    print(f'   关联天然指数: {nat_count}')
    print(f'   关联成分标签: {ing_count} (共 {total_ing} 个引用)')

    # 摘要
    print('\n📋 数据摘要:')
    for r in results:
        if r['naturality_tag'] or r['concept_tags']:
            parts = []
            if r['naturality_tag']:
                parts.append(f"天然:{r['naturality_tag']}")
            if r['concept_tags']:
                parts.append(f"成分:{','.join(r['concept_tags'])}")
            print(f'  {r["code"]:15s} {r["name"]:25s} | {" | ".join(parts)}')

if __name__ == '__main__':
    main()
