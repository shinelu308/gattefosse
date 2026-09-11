const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
(async()=>{
  const rows=await p.$queryRawUnsafe("SELECT id,title,summary,content_html AS html FROM news_events WHERE is_published=1 AND summary IS NOT NULL AND length(summary)>20 AND content_html IS NOT NULL");
  const norm=(s)=>(s||'').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g,'');
  let hidden=0, shownDup=[], ok=0;
  for(const r of rows){
    const ns=norm(r.summary), nb=norm(r.html);
    const sample=ns.substring(0,20);
    if(sample && nb.indexOf(sample)!==-1){ hidden++; continue; }
    // 20字窗口未命中 → 滑窗找 10 字片段判断是否实际重复
    let dup=false;
    for(let i=0;i+10<=ns.length;i+=4){ if(nb.indexOf(ns.substr(i,10))!==-1){dup=true;break;} }
    if(dup) shownDup.push(r.id+':'+(r.title||'').slice(0,22));
    else ok++;
  }
  console.log('已隐藏(20字窗口命中):', hidden);
  console.log('仍会显示但实为重复(滑窗命中):', shownDup.length, JSON.stringify(shownDup, null, 1));
  console.log('正常显示(真导语):', ok);
  process.exit(0);
})();
