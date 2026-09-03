/**
 * 导入原中文站 get-inspired/webinars 页的 4 条在线研讨会数据
 * 运行: cd backend && npx tsx scripts/import-webinars.ts
 * 幂等：按 title 去重，已存在则跳过
 */
import { prisma } from '../src/utils/prisma';

const webinars = [
  {
    title: 'Color catwalk',
    summary:
      "Learn about the dichotomy of today's makeup trends and the high-performing ingredients that will help you create beautiful products for any look.",
    articleType: '应用领域',
    tags: ['彩妆'],
    publishedDate: '2023-03-29',
    imageUrl:
      'https://www.gattefossechina.cn/uploads/file/257d919e332ebbe96cec3879e555d106_20240517105109.png',
    topBackground:
      'https://www.gattefossechina.cn/uploads/file/257d919e332ebbe96cec3879e555d106_20240726125935.webp',
    videoUrl:
      'https://us02web.zoom.us/rec/component-page?hasValidToken=false&clusterId=us02&action=play&filePlayId=&componentName=recording-register&meetingId=3Kfoy8SuZCTGMYG02c9BuQDDl8aCsDpQFakyWa0TBD_PG9',
  },
  {
    title: 'Biodegradability in cosmetics',
    summary:
      'Gather everything you need to know about biodegradability in cosmetics in just 20 minutes.',
    articleType: '专业知识',
    tags: ['纯净美妆', '环境责任'],
    publishedDate: '2022-12-14',
    imageUrl:
      'https://www.gattefossechina.cn/uploads/file/dcc8d188fb21a502826898453e707109_20240517105134.png',
    topBackground:
      'https://www.gattefossechina.cn/uploads/file/dcc8d188fb21a502826898453e707109_20240726125944.webp',
    videoUrl:
      'https://us02web.zoom.us/rec/component-page?hasValidToken=false&clusterId=us02&action=play&filePlayId=&componentName=recording-register&meetingId=8ZKE6nRJqmI-tMfZsldEc9-Oyn217XnNO68uL-RDyhZ-Je',
  },
  {
    title: 'Pout perfect',
    summary:
      "Discover the latest trends in lip cosmetics and the Gattefossé ingredients to help you innovate hybrid lip products.",
    articleType: '灵感与趋势',
    tags: ['口红', '彩妆'],
    publishedDate: '2022-10-26',
    imageUrl:
      'https://www.gattefossechina.cn/uploads/file/8474f8ff8c80608d209aa28540facb4c_20240517105320.png',
    topBackground: '',
    videoUrl:
      'https://us02web.zoom.us/rec/component-page?hasValidToken=false&clusterId=us02&action=play&filePlayId=&componentName=recording-register&meetingId=O-WiTS2Au7-61Rt870xzu2QmSPsu7tPR5PF37RKs01Lssw',
  },
  {
    title: 'Here comes the sun',
    summary:
      'Join our industry suncare expert as she reveals the best formulation practices and testing methods.',
    articleType: '质地与配方',
    tags: ['防晒'],
    publishedDate: '2022-03-30',
    imageUrl:
      'https://www.gattefossechina.cn/uploads/file/88ff30a395ed59b58fbe8ada4bcaac35_20240517105636.png',
    topBackground: '',
    videoUrl:
      'https://us02web.zoom.us/rec/component-page?hasValidToken=false&clusterId=us02&action=play&filePlayId=&componentName=recording-register&meetingId=N6MxLAR-VkYCDPjDhepuujagYu5J9ZMXbh6fHKCAk_nMVO',
  },
];

async function main() {
  let created = 0;
  let skipped = 0;
  for (const w of webinars) {
    const exist = await prisma.newsEvent.findFirst({
      where: { type: 'webinar', title: w.title },
    });
    if (exist) {
      skipped++;
      console.log(`[跳过] 已存在 webinar #${exist.id}: ${w.title}`);
      continue;
    }
    const item = await prisma.newsEvent.create({
      data: {
        type: 'webinar',
        category: 'pc',
        title: w.title,
        summary: w.summary || null,
        contentHtml: null,
        imageUrl: w.imageUrl || null,
        topBackground: w.topBackground || null,
        articleType: w.articleType || null,
        tags: JSON.stringify(w.tags || []),
        videoUrl: w.videoUrl || null,
        lock: true, // 原站需登录（注册）后观看回放
        isPublished: true,
        publishedDate: new Date(w.publishedDate),
      },
    });
    created++;
    console.log(`[导入] #${item.id}: ${w.title} | ${w.articleType} | tags=${w.tags.join(',')}`);
  }
  console.log(`\n完成：新增 ${created} 条，跳过 ${skipped} 条`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
