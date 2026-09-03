/**
 * 导入原中文站 get-inspired/addiactive 杂志页的 12 条 addiactive 杂志数据
 * 运行: cd backend && npx tsx scripts/import-magazines.ts
 * 幂等：按 title 去重，已存在则跳过
 *
 * 数据来源：原站 API https://www.gattefossechina.cn/api/webBrochures/getWebBrochuresList?catId=30&goodsCategoryId=1
 * 年份：每条 tag=[[301,N]] 中 N 对应 302=2019 ... 307=2024（原站 addiactive_year facet）
 */
import { prisma } from '../src/utils/prisma';

const yearOfTag: Record<number, string> = {
  302: '2019',
  303: '2020',
  304: '2021',
  305: '2022',
  306: '2023',
  307: '2024',
};

// title 为空的行用 PDF 文件名推断（如 addiactive-126-en-v3.pdf -> addiactive #126）
const titleFromUrl = (url: string): string => {
  const m = /addiactive-(\d+)/i.exec(url || '');
  return m ? `addiactive #${m[1]}` : 'addiactive';
};

// 按原站返回顺序排列的杂志数据（id, title(可为空取默认), thumb, url, tag, lock）
const magazines: {
  title?: string;
  summary?: string;
  imageUrl?: string;
  pdfUrl?: string;
  lock?: boolean;
  tag?: string | null; // 形如 "[[301,307]]"
  publishedDate?: string;
}[] = [
  {
    title: 'addiactive #126: Spotted!',
    summary: '',
    imageUrl: 'https://www.gattefossechina.cn/uploads/file/3085d34979e5d5c8fdd9f2e15409e75c_20240726123130.jpg',
    pdfUrl: 'https://www.gattefosse.com/files/2730/addiactive-126-en-v3.pdf',
    lock: true,
    tag: '[[301,307]]', // 2024
    publishedDate: '2024-07-26',
  },
  {
    title: 'Once Upon a Time',
    summary: '',
    imageUrl: 'https://www.gattefossechina.cn/uploads/file/c9691a3e96ae30036a852ee8a95e1a2c_20240524101101.png',
    pdfUrl: 'https://www.gattefosse.com/files/2691/addiactive-125-en.pdf',
    lock: true,
    tag: '[[301,307]]', // 2024
    publishedDate: '2024-05-24',
  },
  {
    title: 'addiactive #124 : EuphorIA',
    summary: '',
    imageUrl: 'https://www.gattefossechina.cn/uploads/file/7bd8623d9fa65a57e314e6eefc86e3c8_20240524101131.jpg',
    pdfUrl: 'https://www.gattefosse.com/files/2583/addiactive-124-en-vf.pdf',
    lock: true,
    tag: '[[301,306]]', // 2023
    publishedDate: '2023-05-24',
  },
  {
    title: 'addiactive #123',
    summary: '',
    imageUrl: 'https://www.gattefossechina.cn/uploads/file/9598b8a3bc3e9589e14265f423d2f4a3_20240524101153.jpg',
    pdfUrl: 'https://www.gattefosse.com/files/2266/addiactive-123-en-bd.pdf',
    lock: true,
    tag: '[[301,306]]', // 2023
    publishedDate: '2023-05-24',
  },
  {
    title: 'addiactive #122',
    summary: '',
    imageUrl: 'https://www.gattefossechina.cn/uploads/file/916b936d73f26f04dcfd5d7988526b0e_20240524101214.jpg',
    pdfUrl: 'https://www.gattefosse.com/files/350/addiactive-122-en-v3.pdf',
    lock: true,
    tag: '[[301,306]]', // 2023
    publishedDate: '2023-05-24',
  },
  {
    title: 'addiactive #121',
    summary: '',
    imageUrl: 'https://www.gattefossechina.cn/uploads/file/526e6f0753a49a269d7136248097dcc1_20240524101233.jpg',
    pdfUrl: 'https://www.gattefosse.com/files/1205/addiactive-121-en-v3.pdf',
    lock: true,
    tag: '[[301,305]]', // 2022
    publishedDate: '2022-05-24',
  },
  {
    title: 'addiactive #120',
    summary: '',
    imageUrl: 'https://www.gattefossechina.cn/uploads/file/c77edabfda7ab194c5cd6b2b2b018105_20240524101250.jpg',
    pdfUrl: 'https://www.gattefosse.com/files/1201/addiactive-120-en.pdf',
    lock: true,
    tag: '[[301,305]]', // 2022
    publishedDate: '2022-05-24',
  },
  {
    title: 'addiactive #116',
    summary: '',
    imageUrl: 'https://www.gattefossechina.cn/uploads/file/dd7e1f58eea6a6e7ed5079d29c580ab7_20240524101325.jpg',
    pdfUrl: 'https://www.gattefosse.com/files/1192/addiactive-116-en-v4.pdf',
    lock: true,
    tag: '[[301,304]]', // 2021
    publishedDate: '2021-05-24',
  },
  {
    title: 'addiactive #115',
    summary: '',
    imageUrl: 'https://www.gattefossechina.cn/uploads/file/95e80a0d51c7d0a4b96f13fa3601818e_20240524101438.jpg',
    pdfUrl: 'https://www.gattefosse.com/files/1188/addiactive-115-en-bd.pdf',
    lock: true,
    tag: '[[301,303]]', // 2020
    publishedDate: '2020-05-24',
  },
  {
    title: 'addiactive #114',
    summary: '',
    imageUrl: 'https://www.gattefossechina.cn/uploads/file/25231d990fbc1a6cffc915170bc73d70_20240524101444.jpg',
    pdfUrl: 'https://www.gattefosse.com/files/1184/addiactive-114-en-bd-1.pdf',
    lock: true,
    tag: '[[301,303]]', // 2020
    publishedDate: '2020-05-24',
  },
  {
    title: 'addiactive #113',
    summary: '',
    imageUrl: 'https://www.gattefossechina.cn/uploads/file/f60313fc28ec7b0dd9592fa802364647_20240524101518.jpg',
    pdfUrl: 'https://www.gattefosse.com/files/727/addiactive-113-en-bd.pdf',
    lock: true,
    tag: '[[301,303]]', // 2020
    publishedDate: '2020-05-24',
  },
  {
    title: 'addiactive #112',
    summary: '',
    imageUrl: 'https://www.gattefossechina.cn/uploads/file/71e4c32675c39ae07ed855eed94f3a83_20240524101523.jpg',
    pdfUrl: 'https://www.gattefosse.com/files/346/addiactive-112-en-bd-2.pdf',
    lock: true,
    tag: '[[301,302]]', // 2019
    publishedDate: '2019-05-24',
  },
];

function extractYear(tag: string | null | undefined): string {
  if (!tag) return '2024';
  // tag 形如 "[[301,307]]"，第二数字是年份子标签（302=2019...307=2024）
  const m = /\[(\d+),(\d+)\]/.exec(tag);
  if (m) {
    const n = parseInt(m[2]);
    if (yearOfTag[n]) return yearOfTag[n];
    const n1 = parseInt(m[1]);
    if (yearOfTag[n1]) return yearOfTag[n1];
  }
  const m2 = tag.match(/30\d/);
  if (m2) {
    const n = parseInt(m2[0]);
    if (yearOfTag[n]) return yearOfTag[n];
  }
  return '2024';
}

async function main() {
  let created = 0;
  let skipped = 0;
  for (const m of magazines) {
    const title = m.title || titleFromUrl(m.pdfUrl || '');
    const exist = await prisma.newsEvent.findFirst({
      where: { type: 'magazine', title },
    });
    if (exist) {
      skipped++;
      console.log(`[跳过] 已存在 magazine #${exist.id}: ${title.slice(0, 50)}`);
      continue;
    }
    const year = extractYear(m.tag);
    const pubDate = m.publishedDate
      ? new Date(m.publishedDate)
      : new Date(`${year}-01-01`);
    const tagArr = [year];
    const item = await prisma.newsEvent.create({
      data: {
        type: 'magazine',
        category: 'pc',
        title,
        summary: m.summary || null,
        contentHtml: null,
        articleType: null,
        tags: JSON.stringify(tagArr),
        imageUrl: m.imageUrl || null,
        pdfUrl: m.pdfUrl || null,
        lock: m.lock ?? true,
        isPublished: true,
        publishedDate: pubDate,
      },
    });
    created++;
    console.log(`[导入] #${item.id}: ${title.slice(0, 50)} | ${year} | ${m.pdfUrl}`);
  }
  console.log(`\n完成：新增 ${created} 条，跳过 ${skipped} 条`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
