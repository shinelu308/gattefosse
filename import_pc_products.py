# -*- coding: utf-8 -*-
"""批量导入个人护理产品"""
import urllib.request
import json
import sys

API = 'http://localhost:3000/api'

def import_all():
    # Login
    payload = json.dumps({"email": "admin@gattefosse.cn", "password": "admin123456"}).encode('utf-8')
    req = urllib.request.Request(f'{API}/auth/login', data=payload,
                                 headers={'Content-Type': 'application/json'})
    resp = urllib.request.urlopen(req)
    token = json.loads(resp.read().decode('utf-8'))['data']['token']
    print(f'Token obtenido')

    products = [
        {
            "name": u"Eyeglorius™",
            "inciName": u"辛基十二醇肉豆蔻酸酯（和）沙棘（HIPPOPHAE RHAMNOIDES）提取物",
            "tagline": u"明媚双眸",
            "description": u"Eyeglorius™ 是一款油溶性的活性成分，主要用于去除黑眼圈、眼袋，改善面部疲劳状态的护肤和彩妆产品中。它为化妆品品牌提供了多功能用途护肤品解决方案，可一次性同时改善黑眼圈和眼袋。",
            "dosage": u"2%",
            "isPublished": True
        },
        {
            "name": u"Emulium® Dermolea MB",
            "inciName": u"聚甘油-6 二硬脂酸（和）小烛树蜡 / 霍霍巴 / 米糠聚甘油-3 酯类",
            "tagline": u"敏感肌肤的保护盾",
            "description": u"Emulium® Dermolea MB，是一款O/W乳化剂，它富含甾醇类和三萜烯类成分，可以减少皮肤炎症和压力，带来长效舒缓。它呈现出高保湿和防护性能，可增强皮肤屏障功能。",
            "dosage": u"2-4%",
            "isPublished": True
        },
        {
            "name": u"Solastemis™",
            "inciName": u"果糖（和）甘油（和）水（和）佛手瓜（SECHIUM EDULE）果提取物",
            "tagline": u"DNA守护盾",
            "description": u"Solastemis™ 通过保护角质形成细胞的DNA免受UVA光线的伤害，促进内源性DNA修复系统，在表皮机制中发挥核心作用。它保存了表皮的干细胞，确保了皮肤的第一道防线的平衡。",
            "dosage": u"2%",
            "isPublished": True
        },
        {
            "name": u"EleVastin™",
            "tagline": u"对抗重力",
            "description": u"EleVastin™ 是针对重力引起的皮肤下垂的针对性解决方案。在维持弹性纤维的同时促进关键生物学标志物的合成，同时防止它们降解，为皮肤提供支撑作用，使其承受日复一日的重力带来的压力。",
            "isPublished": True
        },
        {
            "name": u"Emulium® Dolcea MB",
            "tagline": u"天然柔软",
            "description": u"Emulium® Dolcea MB是一种不含PEG的O/W乳化剂，100%天然来源，易于配制，应用灵活可制备从流动质地到稠厚的膏霜。与化妆品各成分具有高度的兼容性，并与天然胶凝剂一起提供优异的稳定性。",
            "isPublished": True
        },
        {
            "name": u"Emulium® Illustro",
            "tagline": u"赋予色彩力量",
            "description": u"Emulium® Illustro是一款油包水乳化剂，与颜料和紫外线过滤剂高度相容，同时也与其它各种化妆品成分具有很好的相容性。完全符合消费者对天然成分的需求，同时满足配方师对成分高性能和高应用灵活性的期望。",
            "isPublished": True
        },
        {
            "name": u"Definicire®",
            "tagline": u"拥有好头发 天天好心情",
            "description": u"Definicire®是一种可重建发丝脂质保护屏障的活性质感成分。100%天然来源，基于功能性蜡酯霍霍巴蜡和向日葵籽蜡，在各种气候下，它都可以使发丝具有很好的定型和梳理柔顺性。",
            "isPublished": True
        },
        {
            "name": u"EnergiNius®",
            "tagline": u"肌肤充电宝",
            "description": u"EnergiNius®具有增强活力的特性，通过增强皮肤细胞能量抵御外部攻击，特别是电子污染。给皮肤注入新的活力，其生物力学性能，包括皮肤紧致度和弹性，得到明显改善，皮肤疲劳迹象消失，呈现健康的光泽。",
            "isPublished": True
        }
    ]

    success = 0
    fail = 0
    for p in products:
        try:
            data = json.dumps(p, ensure_ascii=False).encode('utf-8')
            req = urllib.request.Request(
                f'{API}/pc-ingredients',
                data=data,
                headers={
                    'Content-Type': 'application/json; charset=utf-8',
                    'Authorization': f'Bearer {token}'
                }
            )
            resp = urllib.request.urlopen(req)
            result = json.loads(resp.read().decode('utf-8'))
            if result.get('code') == 0:
                sys.stdout.write(f"✅ {p['name']}\n")
                sys.stdout.flush()
                success += 1
            else:
                sys.stdout.write(f"❌ {p['name']}: {result.get('message')}\n")
                sys.stdout.flush()
                fail += 1
        except Exception as e:
            sys.stdout.write(f"❌ {p['name']}: {e}\n")
            sys.stdout.flush()
            fail += 1

    sys.stdout.write(f"\n结果: 成功 {success}, 失败 {fail}\n")
    sys.stdout.flush()

if __name__ == '__main__':
    import_all()
