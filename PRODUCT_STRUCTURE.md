# 嘉法狮产品数据结构完整参考

> 数据来源：英文总站 gattefosse.com + 中文站 gattefossechina.cn + 本地前端还原版  
> 生成日期：2026-06-24

---

## 一、产品线总览

嘉法狮有两条独立产品线，使用**不同的筛选维度体系和数据字段**：

| 产品线 | 英文名称 | 页面路径 | 预估产品数 | 筛选维度数 |
|--------|----------|----------|-----------|-----------|
| 个人护理原料 | Personal Care | `/personal-care/product-finder/` | ~80+ | 6 维度 |
| 药用辅料 | Pharmaceuticals | `/pharmaceuticals/product-finder/` | 57 | 4 维度 |

---

## 二、个人护理原料 (Personal Care) 数据结构

### 2.1 基本信息字段

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `name` | varchar | 产品名称（含商标符号） | `Silkaress™` |
| `slogan` | varchar | 产品标语 | `Resilience wrapped in softness` |
| `inci_name` | text | INCI 成分名称（多成分用 `(and)` 连接） | `Fructose (and) Water (and) Propanediol (and) Morus Alba Leaf Extract` |
| `description` | text/html | 产品短描述 | 见产品卡片 |
| `main_content` | text/html | 产品详情全文（含 Composition / Sensory / Clinical 等区块） | 见详情页 |
| `image` | varchar | 产品缩略图路径 | `sites/default/files/2026-04/silkaress-thumbnail.jpg` |
| `slug` | varchar | URL 友好名 | `silkaress` |
| `is_sample_available` | boolean | 是否可申请样品 | `true` |
| `sort_order` | int | 排序序号 | `1` |

### 2.2 6 大筛选维度（标签体系）

每个维度都是**多选**关系。一个产品可以拥有某个维度下的多个标签。

#### 维度 1：Functionality（功能分类）— 9 个选项

| 英文 | 中文 | 示例产品 |
|------|------|---------|
| Actives | 活性物 | Silkaress, Solastemis |
| Emulsifier | 乳化剂 | Emulium Dermolea MB |
| Solubilizer | 增溶剂 | — |
| Emollient | 润肤剂 | Labrafac CC MB |
| Texturizing agent | 质感修饰剂 | Compritol 888 CG |
| Surfactant | 表面活性剂 | — |
| Sun Care | 防晒 | — |
| Rheology modifier | 流变调节剂 | — |
| Bioactive | 生物活性物 | EleVastin, Noxifense |

#### 维度 2：Application（应用部位）— 8 个选项

| 英文 | 中文 |
|------|------|
| Face | 面部 |
| Body | 身体 |
| Hair | 头发 |
| Sun care | 防晒护理 |
| Make-up | 彩妆 |
| Lips | 唇部 |
| Hygiene | 卫生 |
| Scalp | 头皮 |

#### 维度 3：Concept（技术概念）— 9 个选项

| 英文 | 中文 |
|------|------|
| Upcycling | 升级再造 |
| Wax butter | 蜡脂技术 |
| NaDES | 天然深共熔溶剂 |
| Plant-based | 植物基 |
| Biomimetic | 仿生学 |
| Biotechnology | 生物技术 |
| Lipid chemistry | 脂质化学 |
| Phytochemistry | 植物化学 |
| Marine | 海洋来源 |

#### 维度 4：Claim（功效宣称）— 25 个选项

| 英文 | 中文 |
|------|------|
| Anti-aging | 抗衰老 |
| Moisturizing | 保湿 |
| Soothing | 舒缓 |
| Brightening | 提亮 |
| Firming | 紧致 |
| Anti-pollution | 抗污染 |
| Sensitive skin | 敏感肌肤 |
| Mattifying | 控油 |
| Purifying | 净化 |
| Anti-acne | 抗痘 |
| Antioxidant | 抗氧化 |
| UV protection | 紫外线防护 |
| Anti-hair loss | 防脱发 |
| Anti-dandruff | 去屑 |
| Color protection | 护色 |
| Volumizing | 蓬松 |
| Curl definition | 卷曲定型 |
| Heat protection | 热防护 |
| Repair | 修复 |
| Nourishing | 滋养 |
| Smoothing | 顺滑 |
| Shine | 光泽 |
| Cooling | 清凉 |
| Warming | 温热 |
| Refreshing | 清爽 |

#### 维度 5：Characteristic（特性标签）— 6 个选项

| 英文 | 中文 |
|------|------|
| China compliant (NMPA notified) | 中国合规（NMPA 备案） |
| PEG-free | 无 PEG |
| Vegan | 纯素 |
| Preservative-free | 无防腐剂 |
| Silicone-free | 无硅 |
| Halal | 清真 |

#### 维度 6：Naturality & Labels（天然性 & 认证）— 7 个选项

| 英文 | 中文 |
|------|------|
| COSMOS Approved | COSMOS 认证 |
| ERI 360 | ERI 360 评分 |
| RSPO | RSPO 可持续棕榈油 |
| ISO 16128 | ISO 16128 天然指数 |
| NATRUE | NATRUE 天然认证 |
| COSMOS certified | COSMOS 持证 |
| Natural origin content ≥ X% | 天然来源含量 ≥ X% |

### 2.3 产品详情页（5 个内容区块）

```
产品详情页结构：
├─ 区块 1: 描述 (Description)
│   └─ 产品主描述文字 + 宣称摘要 (Claims Summary)
├─ 区块 2: 成分组成 (Composition)
│   └─ 化学成分表、配方比例、活性物含量
├─ 区块 3: 感官评估 (Sensory Evaluation)
│   └─ 质地、肤感、吸收速度、香气等专业评测数据
├─ 区块 4: 临床评估 (Clinical Data)
│   └─ 功效测试数据、对比图表、志愿者实验数据
└─ 区块 5: 资源下载 (Documents)
    ├─ 技术文件 (TDS / SDS) — 文件集 1
    ├─ 产品手册 (Brochure) — 文件集 2
    └─ 配方资料 (Formulation docs) — 文件集 3
    └─ 权限：公开 / 需登录 (lock 字段控制)
```

### 2.4 个人护理产品清单（来自总站第1页）

| 序号 | 产品名 | INCI 名称 | 标语 |
|------|--------|-----------|------|
| 1 | Silkaress™ | Fructose (and) Water (and) Propanediol (and) Morus Alba Leaf Extract | Resilience wrapped in softness |
| 2 | Noxifense™ | Propanediol (and) Hippophae Rhamnoides Extract | Soothing with every drop |
| 3 | Eyeglorius™ | Octyldodecyl Myristate (and) Hippophae Rhamnoides Extract | Brilliance with every blink |
| 4 | Emulium® Dermolea MB | Polyglyceryl-6 Distearate (and) Candelilla/Jojoba/Rice Bran Polyglyceryl-3 Esters | Sensitive skin shield |
| 5 | Solastemis® | Fructose (and) Glycerin (and) Water (and) Sechium Edule Fruit Extract | Guardian of DNA |
| 6 | EleVastin™ | Betaine (and) Water (and) Propanediol (and) Murraya Koenigii Stem Extract | Free from gravity |
| 7 | Emulium® Dolcea MB | Cetearyl Alcohol (and) Glyceryl Stearate (and) Jojoba Esters (and) Helianthus Annuus Seed Wax (and) Sodium Stearoyl Glutamate (and) Water (and) Polyglycerin-3 | Soft by nature |
| 8 | Emulium® Illustro | Polyglyceryl-6 Polyhydroxystearate (and) Polyglyceryl-6 Polyricinoleate (and) Polyglycerin-6 | Pigment empowered |
| 9 | Definicire® | Jojoba Esters (and) Helianthus Annuus Seed Wax (and) Polyglycerin-3 | Good hair day |

---

## 三、药用辅料 (Pharmaceuticals) 数据结构

### 3.1 基本信息字段

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `name` | varchar | 产品名称（含商标符号） | `Compritol® 888 ATO` |
| `inci_name` / `cardCode` | varchar | 化学成分名（中文版用 cardCode 存 INCI） | `Glyceryl dibehenate` |
| `cas_no` | varchar | CAS 号 | 见真实数据 |
| `goods_code` | varchar | 产品编码 | `11051` |
| `description` | text/html | 产品描述 | 见产品卡片 |
| `main_content` | text/html | 扩展详情（富文本） | 见详情页 |
| `image` | varchar | 产品图片 | `sites/default/files/2023-07/compritol_direct_compression.jpg.jpg` |
| `is_sample_available` | boolean | 是否可申请样品 | `true` |

### 3.2 4 大筛选维度

#### 维度 1：Markets（市场）— 4 个选项

| 英文 | 中文 |
|------|------|
| All markets | 全部市场 |
| Human health | 人类健康 |
| Animal health | 动物健康 |
| Dietary supplements | 膳食补充剂 |

#### 维度 2：Administration route（给药途径）— 6 个选项

| 英文 | 中文 |
|------|------|
| All | 全部 |
| Oral | 口服 |
| Topical / Transdermal | 外用 / 透皮 |
| Rectal | 直肠 |
| Vaginal | 阴道 |
| Parenteral (veterinary) | 注射（兽用） |

#### 维度 3：Functionality（功能性）— 19 个选项

| 英文 | 中文 |
|------|------|
| API Protection | API 保护 |
| Bioenhancer | 生物利用度增强剂 |
| Co-emulsifier | 助乳化剂 |
| Co-surfactant | 助表面活性剂 |
| Emulsifier | 乳化剂 |
| Hard fat | 硬脂 |
| Lubricant | 润滑剂 |
| Lymphatic promoter | 淋巴吸收促进剂 |
| Oily vehicle | 油性载体 |
| Permeation enhancer | 渗透增强剂 |
| Self emulsifying drug delivery system (SEDDS) | 自乳化药物递送系统 |
| Skin penetration enhancer | 皮肤渗透增强剂 |
| Solubilizer | 增溶剂 |
| Solvent | 溶剂 |
| Stabilizing agent | 稳定剂 |
| Surfactant | 表面活性剂 |
| Sustained release | 缓释 |
| Taste masking | 掩味 |
| Thickener | 增稠剂 |

#### 维度 4：Dosage form（剂型）— 20 个选项

| 英文 | 中文 |
|------|------|
| Bi-gel | 双凝胶 |
| Cream | 乳膏 |
| Emulgel | 乳凝胶 |
| Foam | 泡沫 |
| Gel | 凝胶 |
| Granule | 颗粒 |
| Hard capsule | 硬胶囊 |
| Lotion | 洗剂 |
| Microemulsion | 微乳 |
| Ointment | 软膏 |
| Patch | 贴剂 |
| Pessary | 阴道栓 |
| Pour-on / Spot-on | 浇泼剂 / 点滴剂 |
| Powder | 粉末 |
| Soft capsule | 软胶囊 |
| Solution | 溶液 |
| Stick | 棒剂 |
| Suppository | 栓剂 |
| Suspension | 混悬剂 |
| Tablet | 片剂 |

### 3.3 药用辅料完整产品清单（来自本地 DB，45 个）

| ID | 产品名 | INCI / 化学名 |
|----|--------|--------------|
| 10913 | Transcutol® V | 二乙二醇单乙醚 |
| 10915 | Transcutol® P | 二乙二醇单乙醚 |
| 10916 | Transcutol® HP | 二乙二醇单乙醚 |
| 11012 | Suppocire® CM | 混合脂肪酸甘油酯（硬脂） |
| 11013 | Suppocire® BS2X | 混合脂肪酸甘油酯（硬脂） |
| 11014 | Suppocire® BM | 混合脂肪酸甘油酯（硬脂） |
| 11015 | Suppocire® AS2 | 混合脂肪酸甘油酯（硬脂） |
| 11016 | Suppocire® AP | 含添加剂混合脂肪酸甘油酯 |
| 11017 | Suppocire® AML | 混合脂肪酸甘油酯（硬脂） |
| 11018 | Suppocire® AM | 混合脂肪酸甘油酯（硬脂） |
| 11019 | Suppocire® A-64 | 混合脂肪酸甘油酯（硬脂） |
| 11020 | Suppocire® A | 混合脂肪酸甘油酯（硬脂） |
| 11023 | Plurol® Oleique CC 497 | 聚甘油脂肪酸酯 |
| 11025 | Peceol™ | 单油酸甘油酯 |
| 11026 | Ovucire® WL 3264 | 混合脂肪酸甘油酯 |
| 11027 | Ovucire® 3460 | 混合脂肪酸甘油酯 |
| 11028 | Monosteol™ | 单硬脂酸甘油酯 |
| 11029 | Maisine® CC | 单亚油酸甘油酯 |
| 11032 | Labrasol® ALF | 辛酸癰酸聚乙二醇甘油酯 |
| 11033 | Labrasol® | 辛酸癰酸聚乙二醇甘油酯 |
| 11034 | Labrafil® M 2130 CS | 月桂酰聚氧乙烯(6)甘油酯 |
| 11035 | Labrafil® M 2125 CS | 亚油酰聚氧乙烯(6)甘油酯 |
| 11036 | Labrafil® M 1944 CS | 油酰聚氧乙烯甘油酯 |
| 11037 | Labrafac™ PG | 二辛酸癰酸丙二醇酯 |
| 11038 | Labrafac™ MC60 | 单双辛酸癰酸甘油酯 |
| 11039 | Labrafac™ Lipophile WL 1349 | 中链甘油三酸酯 |
| 11040 | Gelucire® 59/14 | 月桂酰聚氧乙烯(32)甘油酯与 PEG 6000 混合物 |
| 11041 | Gelucire® 50/13 | 硬脂酰聚氧乙烯(32)甘油酯 |
| 11042 | Gelucire® 48/16 | 聚氧乙烯(32)硬脂酸酯 |
| 11043 | Gelucire® 44/14 | 月桂酰聚氧乙烯(32)甘油酯 |
| 11044 | Gelucire® 43/01 | 混合脂肪酸甘油酯（硬脂） |
| 11045 | Gelot™ 64 | 单双硬脂酸甘油酯和聚氧乙烯-75 硬脂酸酯混合物 |
| 11049 | Compritol® HD5 ATO | 聚氧乙烯-8 山崙酸甘油酯 |
| 11050 | Compritol® 888 Pellets | 山崙酸甘油酯（颗粒） |
| 11051 | Compritol® 888 ATO | 山崙酸甘油酯 |
| 11052 | Capryol® PGMC | 单辛酸丙二醇酯（I型） |
| 11053 | Capryol® 90 | 单辛酸丙二醇酯（II型） |
| 11054 | Lauroglycol™ 90 | 月桂酸丙二醇酯（II） |
| 11055 | Lauroglycol™ FCC | 月桂酸丙二醇酯（I） |
| 11060 | Transcutol® CG | 二乙二醇单乙醚 |
| 11062 | Apifil® CG | 蜂蜡基乳化剂 |
| 11064 | Plurol® Stearique MB | 聚甘油酯 |
| 11072 | Labrafac™ CC MB | 内辛酸内辛酯 |
| 11074 | Plurol® Diisostearique CG | 聚甘油-3 双异硬脂酸酯 |
| 11076 | Emulium® 22 MB | 非离子乳化剂 |
| 11078 | Emulium® Delta MB | 非离子乳化剂 |
| 11080 | Compritol® 888 CG | 山崙酸甘油酯 |
| 11086 | Emulium® Kappa MB | 无 PEG 乳化剂 |
| 11090 | Emulium® Mellifera MB | O/W 乳化剂 |
| 11096 | Emulium® Illustro | W/O 乳化剂 |
| 11097 | Emulium® Dolcea MB | O/W 乳化剂 |
| 11100 | Emulium® Dermolea MB | 富含醇类和三碗烯类成分 |
| 11102 | Compritol® E ATO | 双山崙酸甘油酯 |
| 11104 | Labrafac™ N MB | 中链甘油三酯 |

> **注意**：本地 DB 中 ID 11060-11104 范围的产品（如 Emulium、Plurol、Apifil CG、Compritol CG 等）实际上是**个人护理线**的产品，目前被混放在药用辅料产品详情页的脚本中。后台设计时应分配正确的产品线归属。

---

## 四、文档 / 文件关联结构

每个产品可以关联技术文档，分为 3 个文件集：

| 文件集 | 类型 | 中文名 | 英文名 | 权限 |
|--------|------|--------|--------|------|
| fileSet=1 | 技术文件 | 技术文件 | Technical Documents (TDS/SDS) | 可设 lock |
| fileSet=2 | 产品手册 | 产品手册 | Brochure / Product Manual | 可设 lock |
| fileSet=3 | 配方资料 | 配方资料 / 科学文献 | Formulation Docs / Scientific Literature | 可设 lock |

文件对象字段：
```json
{
  "id": "文件ID",
  "title": "文件标题",
  "url": "文件相对/绝对路径",
  "fileSet": 1,            // 1=技术文件 2=产品手册 3=配方资料
  "lock": true,            // true=需登录才能下载
  "sort": 1                // 排序
}
```

---

## 五、产品线归属分类参考

### 药用辅料 (Pharma) 核心品牌系列

| 品牌系列 | 代表产品 | 主要用途 |
|----------|---------|---------|
| **Gelucire®** | 44/14, 50/13, 48/16, 43/01, 59/14 | 口服脂质制剂、缓释 |
| **Labrafil®** | M 2130 CS, M 2125 CS, M 1944 CS | 脂质载体 |
| **Labrafac™** | PG, MC60, Lipophile WL 1349, N MB | 油性载体 |
| **Labrasol®** | Labrasol®, Labrasol® ALF | 增溶/渗透 |
| **Compritol®** | 888 ATO, E ATO, HD5 ATO, 888 Pellets | 缓释骨架/润滑 |
| **Suppocire®** | A, AM, AML, CM, BM, BS2X, AS2, AP, A-64 | 栓剂基质 |
| **Capryol®** | 90, PGMC | 助表面活性剂 |
| **Lauroglycol™** | 90, FCC | 增溶剂 |
| **Transcutol®** | V, P, HP | 渗透增强剂 |
| **Peceol™** | Peceol™ | 增稠稳定 |
| **Maisine®** | Maisine® CC | 增溶稳定 |
| **Gelot™** | Gelot™ 64 | 乳化 |
| **Monosteol™** | Monosteol™ | 乳化 |
| **Ovucire®** | WL 3264, 3460 | 栓剂/油膏 |
| **Geleol™** | Mono and Diglycerides NF, N MB | 乳化/释放 |
| **Plurol®** | Oleique CC 497 | 助表面活性剂 |
| **Emulcire™** | 61 WL 2659 | 乳化蜡 |
| **Emulfree®** | Duo | 无 PEG 包衣 |
| **Apifil®** | Apifil® | PEG-8 蜂蜡 |

### 个人护理 (Personal Care) 核心品牌

| 品牌系列 | 代表产品 | 类别 |
|----------|---------|------|
| **Emulium®** | Dolcea MB, Dermolea MB, Illustro, Delta MB, Kappa MB, Mellifera MB | 乳化剂 |
| **Silkaress™** | — | 活性物 |
| **Solastemis®** | — | 活性物 |
| **EleVastin™** | — | 活性物 |
| **Noxifense™** | — | 活性物 |
| **Eyeglorius™** | — | 活性物 |
| **Definicire®** | — | 质感修饰 |
| **Compritol® CG** | 888 CG | 质感修饰 |
| **Plurol®** | Stearique MB, Diisostearique CG | 乳化剂 |
| **Labrafac™** | CC MB | 润肤剂 |
| **Apifil® CG** | — | 乳化剂 |

---

## 六、关键发现和建议

1. **本地 DB 产品线归属混乱**：ID 11060-11104 的 10+ 个产品（Emulium、Plurol、Apifil CG、Compritol CG）属于个人护理线，但当前混在药用辅料产品详情页脚本中。后台必须两条线分开管理。

2. **筛选维度完全不同**：医药用 4 维度（Market/Route/Functionality/Form）、个人护理用 6 维度（Function/Application/Concept/Claim/Characteristic/Naturality），不能共用一套标签体系。

3. **真实站 Pharm 产品只有 57 个**，本地 DB 有 45 个。部分产品可能是新发布但本地未更新的。后台需要支持"产品线归属"字段。

4. **文档权限控制**是核心功能：TDS/SDS 等内部文件需要登录验证才能下载。

5. **产品详情页区块结构**（Composition / Sensory / Clinical）是总站的标配，但中文站当前缺失。后台要支持这些富文本区块的编辑。
