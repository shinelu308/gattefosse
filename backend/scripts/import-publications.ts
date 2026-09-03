/**
 * 导入原中文站 get-inspired/publications 页的 24 条出版物数据
 * 运行: cd backend && npx tsx scripts/import-publications.ts
 * 幂等：按 title 去重，已存在则跳过
 */
import { prisma } from '../src/utils/prisma';

const publications: {
  title: string;
  summary?: string;
  publicationName?: string;
  authorName?: string;
  articleType?: string;
  tags: string[];
  pdfUrl?: string;
  publishedDate?: string | null;
}[] = [
  {
    title: "Preparation and characterization of liquid crystal emulsions based on a wax ester emulsifier",
    summary: "Liquid crystals have fascinated the cosmetic world for many decades because of the interest in terms of biomimetism, moisturization/barrier function, active controlled release, and stability they bring to emulsions. In this study the effects of manufacturing process and formulation composition on the formation of liquid crystals with a wax ester emulsifier will be presented.",
    authorName: "Paula LENNON, Wanping ZHANG, Qianjie ZHANG, Jin ZHANG, Linghua SHEN, Vincent HUBICHE",
    articleType: "海报",
    tags: [],
    pdfUrl: "https://www.gattefosse.com/files/2841/poster_ifsccbrazil_emulium_dolcea_mb_9c_0.pdf",
    publishedDate: "2024-01-01",
  },
  {
    title: "Construction of spheroids from melanocytes of different ethnic origins: screening model and variation",
    publicationName: "53rd Annual ESDR Meeting (4-7 September 2024, Lisbon, Portugal)  - Sep 2024",
    summary: "Melanogenesis is a complex porcess, ans its in vitro modeling remains a challenge to develop relevant test suitable for rapid preclinical evaluation of the efficacy of lightening products to modulate human skin pigmentation.",
    authorName: "Nicolas Bechetoille, Sébastien Bonnet et Chloé Lorion",
    articleType: "海报",
    tags: [],
    pdfUrl: "https://www.gattefosse.com/files/2739/bechetoille_nicolas_p472.pdf",
    publishedDate: "2024-01-01",
  },
  {
    title: "Elastogenic potential and antisagging properties of a novel Murraya koenigii extract",
    summary: "The newly discovered extract of Murraya koenigii leafy stems represents an innovative antiaging ingredient suited for elasticity-boosting and antisagging claims.",
    authorName: "C. Lorion PhD, V. Bardin, S. Bonnet, A. Lopez-Gaydon, B. Vogelgesang, N. Bechetoille PhD",
    articleType: "科技出版物",
    tags: ["EleVastin™"],
    pdfUrl: "https://www.gattefosse.com/files/2354/j-of-cosmetic-dermatology-2023-lorion-elastogenic-potential-and-antisagging-properties-of-a-novel-murraya-koenigii.pdf",
    publishedDate: "2023-01-01",
  },
  {
    title: "A multiparametric, stepwise in vitro approach to identify anti-dark circle and anti-puffiness ingredients",
    summary: "A unique plant extract with promising anti-puffiness and anti-dark circle potential has been identified using the stepwise selection model.",
    authorName: "C. Lorion PhD, C. Lavastre, A. Rascalou, A. Lopez-Gaydon, S. Bonnet, T. Rinaldi, V. Charton, B. Vogelgesang, N. Bechetoille PhD",
    articleType: "海报",
    tags: [],
    pdfUrl: "https://www.gattefosse.com/files/2156/a-multiparametric-stepwise-in-vitro-approach-to-identify-anti-dark-circle-and-anti-puffiness-ingredients_7t.pdf",
    publishedDate: "2022-01-01",
  },
  {
    title: "Advanced translational cosmetics: using the world’s first non-invasive bioimpedance 3D bioprinted skin chips to link cosmetics lab testing to humans",
    summary: "This model enables advanced translational lab-to-donor data to help bring sophisticated cosmetics ingredients to market faster, safely and more affordably.",
    authorName: "McGuckin, Bechetoille, Legues, Milet, Besseyre, Boyer, Ferrier, Sanchez, Forraz, Vogelgesang",
    articleType: "海报",
    tags: [],
    pdfUrl: "https://www.gattefosse.com/files/2157/advanced-translational-cosmetics-using-the-worlds-first-non-invasive-bioimpedance-3d-bioprinted-skin-chips-to-link-cosmetics-lab-testing-to-humans._4c.pd",
    publishedDate: "2024-01-01",
  },
  {
    title: "A NaDES extract of Rose ‘Jardin de Granville®’ displays pro-resolving and epidermal strengthening properties",
    summary: "The fructose/propanediol/water (NaDES FPW113) extract of “Jardin de Granville” Rose flowers has demonstrated great potential in vitro and ex vivo to support epidermal homeostasis and counteract the inflammaging process.",
    authorName: "Pecher V., Franchi J., Charton V., Dubourdeau M, Van Goethem E., Baillif V., Nizard C., Choisy P., Vogelgesang B., Bechetoille N.",
    articleType: "海报",
    tags: [],
    pdfUrl: "https://www.gattefosse.com/files/2158/a-nades-extract-of-rose-jardin-de-granviller-displays-pro-resolving-andepidermal-strengthening-properties_6w.pdf",
    publishedDate: "2024-01-01",
  },
  {
    title: "Unexpected elasticity-booting properties of a traditional ayurvedic plant",
    summary: "Murraya koenigii extract displays undeniable elasticity boosting properties, highlighted at molecular, cellular and tissue levels, and appears as a powerful anti-aging ingredient.",
    authorName: "Chloé Lorion PhD, Sébastien Bonnet, Amandine Lopez-Gaydon, Anna Drillat, Virginie Charton, Nicolas Bechetoille PhD",
    articleType: "海报",
    tags: ["EleVastin™"],
    pdfUrl: "https://www.gattefosse.com/files/2159/poster-esdr-2021-604f6a6d7db44596095754.pdf",
    publishedDate: "2024-01-01",
  },
  {
    title: "Biobased and non-ionic LTTMs composed of fructose and glycerol: water and temperature impact on the supramolecular organization",
    summary: "The objective is to understand interactions at the molecular level for various F/G/W mixtures and establish a relationship between their micro and macroscopical features.",
    authorName: "Benoit Caprin",
    articleType: "会议交流",
    tags: [],
    pdfUrl: "https://www.gattefosse.com/files/2160/biobased-and-non-ionic-lttms-composed-of-fructose-and-glycerol-water-and-temperature-impact-on-the-supramolecular-organization.pdf",
    publishedDate: "2024-01-01",
  },
  {
    title: "Generation of homogeneous, scaffold-free adipose spheroids for screening of lipolytic agents",
    summary: "Adipose spheroids provide an interesting in vitro model of pre-adipocyte maturation and adipocyte expansion.",
    authorName: "Sébastien Bonnet, Amandine Lopez-Gaydon, Cindy Lavastre, Chloé Lorion, Nicolas Bechetoille",
    articleType: "海报",
    tags: [],
    pdfUrl: "https://www.gattefosse.com/files/2128/generation-of-homogeneous-scaffold-free-adipose-spheroids-for-screening-of-lipolytic-agents_9s.pdf",
    publishedDate: "2024-01-01",
  },
  {
    title: "Fibroblasts extracellular vesicles modulate human keratinocytes differentiation during skin aging",
    summary: "Microvesicles and exosomes, once considered as mechanisms of waste elimination, are now emerging as key players in intercellular communications.",
    authorName: "J. Rorteau, FP. Chevalier, T. Barthélémy, M. Dos Santos, N. Bechetoille, J. Lamartine",
    articleType: "海报",
    tags: [],
    pdfUrl: "https://www.gattefosse.com/files/2129/fibroblasts-extracellular-vesicles-modulate-human-keratinocytes-differentiation-during-skin-aging_5y.pdf",
    publishedDate: "2024-01-01",
  },
  {
    title: "Differential profile of proinflammatory/proresolving lipid mediators in acute inflammation model using young and old skin biopsies",
    summary: "Skin aging may involve an endogenous inflammation resolution program displaying dysregulation and/or absence of proresolving mediators.",
    authorName: "Lopez-Gaydon Amandine, Baillif Vincent, Bertholon Cindy, Van Goethem Emeline, Demarne Frédéric, Dubourdeau Marc, Bechetoille Nicolas",
    articleType: "科技出版物",
    tags: ["Gatuline® Skin-Repair AF"],
    pdfUrl: "https://www.gattefosse.com/files/2134/2019_differential-profile-of-proinflammatory.pdf",
    publishedDate: "2024-01-01",
  },
  {
    title: "An efficient method to determine the Hydrophile-Lipophile Balance of surfactants using the phase inversion temperature deviation of CiEj/n-octane/water emulsions",
    summary: "A fast and accurate method has been developed to determine the hydrophilic-lipophilic balance (HLB) number of amphiphilic chemicals.",
    authorName: "M. Nollet, H. Boulghobra, E. Calligaro, J.-D. Rodier",
    articleType: "科技出版物",
    tags: ["Emulium® Mellifera MB"],
    pdfUrl: "https://www.gattefosse.com/files/2135/nollet_et_al-2019-an-efficient-method-to-determine-the-hydrophile-lipophile-balance.pdf",
    publishedDate: "2024-01-01",
  },
  {
    title: "Structural and biomechanical properties of a novel 3d microdermis model: the spheroid",
    summary: "Spheroids as micro-tissues are a powerful alternative to standard 2D cell culture for in vitro studies.",
    authorName: "Chloé Lorion PhD, Amandine Lopez-Gaydon, Sébastien Bonnet, Anna Drillat, Pascale Milani PhD, Nicolas Bechetoille",
    articleType: "海报",
    tags: ["EleVastin™"],
    pdfUrl: "https://www.gattefosse.com/files/2142/esdr_2019_poster_spheroid-structural-and-biomechanical-properties.pdf",
    publishedDate: "2024-01-01",
  },
  {
    title: "Keratinocyte stem cells are more resistant to UVA radiation than their direct progeny",
    summary: "Keratinocyte stem cells, which are responsible for epidermal renewal throughout life, are equipped with an efficient arsenal against several genotoxic agents.",
    authorName: "Elodie Metral, Nicolas Bechetoille, Frédéric Demarne, Odile Damour, Walid Rachidi",
    articleType: "科技出版物",
    tags: ["Solastemis™"],
    pdfUrl: "https://www.gattefosse.com/files/2144/keratinocyte-stem-cells-are-more-resistant-to-uva-radiation-than-their-direct-progeny.pdf",
    publishedDate: "2024-01-01",
  },
  {
    title: "Harmful effects of screen-emitted artificial visible light in dermis: an additional environmental stress not to be neglected",
    summary: "We have investigated the effects of artificial visible light in human dermal fibroblasts and we described a patented plant extract of Withania somnifera root able to protect those skin cells.",
    authorName: "Adeline Rascalou , Frédéric Demarne PhD, Nicolas Bechetoille PhD",
    articleType: "海报",
    tags: ["EnergiNius®"],
    pdfUrl: "https://www.gattefosse.com/files/2145/2018_poster_iid_jinvestdermatol_harmful-effects-of-screen-emitted-artifical.pdf",
    publishedDate: "2024-01-01",
  },
  {
    title: "α6 Integrin/Transferrin receptor (CD71) low keratinocyte stem cells are more potent for generating reconstructed skin epidermis than rapid adherent cells",
    summary: "Cells isolated by a rapid adherent method are not the same population as keratinocytes stem cells isolated by flow cytometry following α6high/CD71low phenotype.",
    authorName: "Elodie Metral, Nicolas Bechetoille, Frédéric Demarne, Walid Rachidi, Odile Damour",
    articleType: "科技出版物",
    tags: [],
    pdfUrl: "https://www.gattefosse.com/files/2146/keratinocyte-stem-cells-are-more-potent-for-generating-reconstructed-skin-epidermis.pdf",
    publishedDate: "2024-01-01",
  },
  {
    title: "Scrutiny of the supramolecular structure of bio-sourced fructose/glycerol/water ternary mixtures: towards green low transition temperature mixtures",
    publicationName: "Journal of Molecular Liquids",
    summary: "This comprehensive study is a prerequisite for a further industrial implementation of eco-designed solvents in various applicative attractive domains, as in cosmetic field.",
    authorName: "B. Caprin, V. Charton, J-D. Rodier, B. Vogelgesang, A. Charlot, F. Da Cruz-Boisson, E. Fleury",
    articleType: "科技出版物",
    tags: [],
    pdfUrl: "",
    publishedDate: "2021-01-01",
  },
  {
    title: "A rapid and sensitive method for characterization and quantification of polyglycerol esters by supercritical fluid chromatography coupled to high-resolution mass spectrometry (SFC-HRMS)",
    publicationName: "The International Journal of Pure and Applied Analytical Chemistry",
    summary: "Polyglycerol esters of fatty acids are widely used in cosmetics. However, no study related to the purification and the absolute quantification of these compounds has been described yet.",
    authorName: "Thi Phuong Thuy Hoang, Nicolas Ritter, Jean-David Rodier, David Touboul",
    articleType: "科技出版物",
    tags: [],
    pdfUrl: "",
    publishedDate: "2021-01-01",
  },
  {
    title: "The use of NADES to support innovation in the cosmetic industry",
    publicationName: "Advances in Botanical Research",
    summary: "Since their introduction, natural deep eutectic solvents (NaDES) have emerged as a promising, eco-friendly alternative to petrochemicals to dissolve plant metabolites.",
    authorName: "Caprin Benoit, Charton Virginie, Vogelgesang Boris",
    articleType: "科技出版物",
    tags: [],
    pdfUrl: "",
    publishedDate: "2021-01-01",
  },
  {
    title: "The Camera Never Lies: Visualizing Sun Protection Loss and Ways to Fortify Films",
    publicationName: "Cosmetics&Toiletries",
    summary: "Visualizing sun protection loss and ways to fortify films.",
    authorName: "Vincent Hubiche, Malorie Duvent, Viviane Bardin, Paula Lennon",
    articleType: "科技出版物",
    tags: [],
    pdfUrl: "",
    publishedDate: "2019-01-01",
  },
  {
    title: "Differential profiles of pro-inflammatory and specialized pro-resolving lipid mediators in PMA-treated skin biopsies from young and old donors",
    publicationName: "Journal of Investigative Dermatology",
    summary: "The skin immune system is regulated by bioactive lipids that initiate and amplify inflammation but control its efficient ending also called resolution.",
    authorName: "N. Bechetoille, V. Baillif, A. Lopez-Gaydon, E. Van Goethem, F. Demarne, M. Dubourdeau",
    articleType: "科技出版物",
    tags: ["Gatuline® Skin-Repair AF"],
    pdfUrl: "",
    publishedDate: "2018-01-01",
  },
  {
    title: "Mitochondrial damage and cytoskeleton reorganization in human dermal fibroblasts exposed to artificial visible light similar to screen-emitted light",
    publicationName: "Journal of Dermatological Science",
    summary: "",
    authorName: "Adeline Rascalou, Jérôme Lamartine, Pauline Poydenot, Frédéric Demarne, Nicolas Bechetoille",
    articleType: "科技出版物",
    tags: ["EnergiNius®"],
    pdfUrl: "",
    publishedDate: "2018-01-01",
  },
  {
    title: "Long-term genoprotection effect of Sechium edule fruit extract against UVA irradiation in keratinocytes",
    publicationName: "Photochemistry and Photobiology",
    summary: "The objective of this study was to investigate the effects of a Sechium edule fruit extrac in terms of photoprotection against UVA in primary human keratinocytes.",
    authorName: "Elodie Metral, Walid Rachidi, Odile Damour, Frédéric Demarne, Nicolas Bechetoille",
    articleType: "科技出版物",
    tags: ["Solastemis™"],
    pdfUrl: "",
    publishedDate: "2017-01-01",
  },
  {
    title: "Distinct photoprotective effects on UVA irradiated-keratinocytes",
    publicationName: "Journal of Investigative Dermatology",
    summary: "Using different techniques enable to explore cellular responses against UVA stress and to demonstrate the photoprotective effects of products against UV irradiation.",
    authorName: "N. Bechetoille, E. Metral, F. Demarne, O. Damour, W. Rachidi",
    articleType: "科技出版物",
    tags: ["Solastemis™"],
    pdfUrl: "",
    publishedDate: "2016-01-01",
  },
];

async function main() {
  let created = 0;
  let skipped = 0;
  for (const p of publications) {
    const exist = await prisma.newsEvent.findFirst({
      where: { type: 'publication', title: p.title },
    });
    if (exist) {
      skipped++;
      console.log(`[跳过] 已存在 publication #${exist.id}: ${p.title.slice(0, 50)}`);
      continue;
    }
    const pubDate = p.publishedDate ? new Date(p.publishedDate) : new Date('2024-01-01');
    // tags = 成分标签 + 发布年份字符串（供年份筛选）
    const tagArr = [...(p.tags || [])];
    const yearStr = String(pubDate.getFullYear());
    if (!tagArr.includes(yearStr)) tagArr.push(yearStr);
    const item = await prisma.newsEvent.create({
      data: {
        type: 'publication',
        category: 'pc',
        title: p.title,
        summary: p.summary || null,
        contentHtml: null,
        publicationName: p.publicationName || null,
        authorName: p.authorName || null,
        articleType: p.articleType || null,
        tags: JSON.stringify(tagArr),
        pdfUrl: p.pdfUrl || null,
        lock: false,
        isPublished: true,
        publishedDate: pubDate,
      },
    });
    created++;
    console.log(`[导入] #${item.id}: ${p.title.slice(0, 50)} | ${p.articleType} | ${p.publishedDate || ''} | tags=[${tagArr.join(',')}]`);
  }
  console.log(`\n完成：新增 ${created} 条，跳过 ${skipped} 条`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
