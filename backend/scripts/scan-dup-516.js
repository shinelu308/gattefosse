const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
(async()=>{
  const r=await p.newsEvent.findUnique({where:{id:516},select:{summary:true,contentHtml:true}});
  const html=r.contentHtml||'';
  const idx=html.indexOf('塑造美容');
  console.log('「塑造美容」在正文位置:', idx);
  if(idx>=0){
    const text=html.replace(/<[^>]+>/g,'').replace(/\s+/g,' ');
    const t=text.indexOf('塑造美容');
    console.log('正文纯文本上下文:', JSON.stringify(text.slice(Math.max(0,t-60), t+120)));
  }
  const norm=(s)=>(s||'').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g,'');
  const ns=norm(r.summary), nb=norm(html);
  console.log('summary前40(norm):', ns.slice(0,40));
  console.log('正文「塑造美容」后40(norm):', idx>=0 ? nb.slice(nb.indexOf(norm.slice? '':''), 0) : '');
  // 直接对比 summary 前 40 与正文对应段
  const k=nb.indexOf(ns.slice(4,14)); // 从第5字开始找10字片段（跳过「近年来」）
  console.log('第5-14字片段命中:', k>=0 ? JSON.stringify(nb.slice(Math.max(0,k-15), k+45)) : '无');
  process.exit(0);
})();
