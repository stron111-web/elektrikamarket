'use strict';
const fs=require('node:fs/promises'),postgres=require('postgres');
(async()=>{const u=(await fs.readFile('/run/config/database_url','utf8')).trim();const db=postgres(u,{max:1,onnotice:()=>{}});try{
 const result=JSON.parse(await fs.readFile('/prodat-state/last-publication.json','utf8'));
 const warnings=await db`SELECT severity,code,count(*)::int n FROM import_issues WHERE "runId" IN ${db([result.prodat.runId,result.pricat.runId])} GROUP BY severity,code ORDER BY n DESC`;
 const [newSale]=await db`SELECT p."supplierCode",p.slug,i."retailPrice",i.uom,i.stocks FROM products p JOIN assortment_items i ON i."productId"=p.id JOIN assortment_snapshots s ON s.id=i."snapshotId" AND s.active WHERE p.id>${result.pricat.reconciliation.afterProductId} ORDER BY p.id LIMIT 1`;
 const [newStats]=await db`SELECT count(*)::int total,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM product_commercial_data c WHERE c."productId"=p.id))::int withCommercial,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM assortment_items i JOIN assortment_snapshots s ON s.id=i."snapshotId" AND s.active WHERE i."productId"=p.id))::int sale FROM products p WHERE p.id>${result.pricat.reconciliation.afterProductId}`;
 const report={status:result.status,createdProducts:result.createdProducts,updatedProducts:result.updatedProducts,newSaleOffers:result.newSaleOffers,existingSaleOffersChanged:result.existingSaleOffersChanged,zeroedStocks:result.pricat.zeroedStocks,zeroedPositiveStocks:result.pricat.zeroedPositiveStocks,protectedDataUnchanged:result.protectedDataUnchanged,warnings,newStats,newSale};
 console.log(JSON.stringify(report,null,2));await fs.writeFile('/prodat-state/rehearsal-summary.json',JSON.stringify(report,null,2),{mode:0o600});
}finally{await db.end({timeout:5});}})().catch(e=>{console.error(e.code||'AUDIT_FAILED');process.exitCode=1;});
