const path = require('path');
require('module').Module._initPaths();
const puppeteer = require(path.join("C:\\Users\\Shine Lu\\.workbuddy\\binaries\\node\\workspace\\node_modules", 'puppeteer-core'));
const fs = require('fs');

(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new', args: ['--no-sandbox'],
  });
  const p = await b.newPage();
  await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');
  await p.goto('https://www.gattefosse.com/job-form', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));
  const list = await p.$eval('#edit-pays-country--2', e => Array.from(e.options).map(o => o.value));
  await b.close();

  const en = new Intl.DisplayNames(['en'], { type: 'region' });
  const zh = new Intl.DisplayNames(['zh-CN'], { type: 'region' });

  // 用 ISO 3166-1 alpha-2 反查英文名，与 Drupal 列表做匹配
  const CODES = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
    'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN ' +
    'GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY ' +
    'MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA ' +
    'RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ');

  const codeByEn = new Map();
  for (const c of CODES) {
    try { codeByEn.set(en.of(c), c); } catch (e) {}
  }
  // Drupal/CLDR 常见别名补充
  const ALIAS = {
    'United States': 'US', 'United Kingdom': 'GB', 'Russia': 'RU', 'South Korea': 'KR', 'North Korea': 'KP',
    'Vietnam': 'VN', 'Taiwan': 'TW', 'Hong Kong SAR China': 'HK', 'Macao SAR China': 'MO', 'Macau SAR China': 'MO',
    'Congo - Brazzaville': 'CG', 'Congo - Kinshasa': 'CD', "Côte d'Ivoire": 'CI', 'Curaçao': 'CW', 'Curaçao': 'CW',
    'Turkey': 'TR', 'Türkiye': 'TR', 'Czechia': 'CZ', 'Czech Republic': 'CZ', 'Bolivia': 'BO', 'Venezuela': 'VE',
    'Iran': 'IR', 'Syria': 'SY', 'Laos': 'LA', 'Brunei': 'BN', 'Tanzania': 'TZ', 'Moldova': 'MD', 'Macedonia': 'MK',
    'Eswatini': 'SZ', 'Swaziland': 'SZ', 'Cape Verde': 'CV', 'Cabo Verde': 'CV', 'Ivory Coast': 'CI',
    'Micronesia': 'FM', 'Palestinian Territories': 'PS', 'Palestine': 'PS', 'Vatican City': 'VA',
    'Saint Martin': 'MF', 'Sint Maarten': 'SX', 'St. Martin': 'MF', 'Réunion': 'RE', 'Réunion': 'RE',
    'Myanmar (Burma)': 'MM', 'Myanmar': 'MM', 'Caribbean Netherlands': 'BQ', 'St. Barthélemy': 'BL',
    'St. Helena': 'SH', 'St. Kitts & Nevis': 'KN', 'St. Lucia': 'LC', 'St. Vincent & Grenadines': 'VC',
    'St. Pierre & Miquelon': 'PM', 'São Tomé & Príncipe': 'ST', 'Antigua & Barbuda': 'AG',
    'Bosnia & Herzegovina': 'BA', 'Trinidad & Tobago': 'TT', 'Turks & Caicos Islands': 'TC',
    'British Virgin Islands': 'VG', 'U.S. Virgin Islands': 'VI', 'Canary Islands': 'IC', 'Ceuta & Melilla': 'EA',
    'Ascension Island': 'AC', 'Diego Garcia': 'DG', 'Clipperton Island': 'CP', 'Bouvet Island': 'BV',
  };
  for (const [k, v] of Object.entries(ALIAS)) codeByEn.set(k, v);

  // 港澳台必须按中国规范命名（内容合规）
  const FORCE_ZH = {
    'Taiwan': '中国台湾', 'Hong Kong SAR China': '中国香港', 'Macao SAR China': '中国澳门',
    'Hong Kong': '中国香港', 'Macao': '中国澳门', 'Macau': '中国澳门',
  };

  const out = list.filter(Boolean).map(name => {
    const code = codeByEn.get(name);
    let label = FORCE_ZH[name] || null;
    if (!label && code) {
      try { label = zh.of(code); } catch (e) { label = null; }
    }
    if (!label || label === code) label = name;
    return { value: name, label: label === name ? name : `${label} ${name}` };
  });

  const unmatched = out.filter(o => o.label === o.value).map(o => o.value);
  console.log('总数:', out.length, '| 未匹配中文:', unmatched.length);
  console.log('未匹配:', JSON.stringify(unmatched));
  console.log('抽查:', JSON.stringify(out.filter(o => /China|France|Taiwan|Hong Kong|Macao|United States|Japan|Germany/.test(o.value))));

  fs.writeFileSync(path.join(__dirname, '.jobform-countries.json'), JSON.stringify(out, null, 1));
  console.log('已写出 .jobform-countries.json');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
