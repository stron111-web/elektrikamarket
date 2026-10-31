'use strict';
const { availableStocksQuery } = require('../import/pricat-store.cjs');
const PROJECTION_VERSION='assortment-v1';
const PRICAT_LOCK=1707312402;

// Must be called inside the caller's publication transaction, after successful
// file AND run statuses. No independent connection, no source-data correction.
async function buildAssortmentSnapshot(tx,{runId=null,beforeActivate=async()=>{}}={}) {
  const [lock]=await tx`SELECT pg_try_advisory_xact_lock(${PRICAT_LOCK}) acquired`;
  if(!lock.acquired)throw new Error('Another PRICAT publication is running');
  await tx`LOCK TABLE public.products,public.warehouses,public.shop_settings,
    public.product_commercial_data,public.product_prices,public.product_stocks IN SHARE ROW EXCLUSIVE MODE`;
  const files=await tx`SELECT DISTINCT ON (f.source) f.id,f.source
    FROM import_files f JOIN import_runs r ON r.id=f."runId"
    WHERE f.source IN ('PRICAT1','PRICAT2') AND f.status='SUCCEEDED' AND r.status='SUCCEEDED'
    ORDER BY f.source,f.id DESC`;
  if(files.length!==2)throw new Error('Both successfully processed PRICAT sources are required');
  const [settings]=await tx`SELECT "protectiveMarkupPercent" FROM shop_settings WHERE id=1`;
  if(!settings)throw new Error('ShopSettings id=1 is required');
  const [previous]=await tx`SELECT id FROM assortment_snapshots WHERE active`;
  const [generation]=await tx`INSERT INTO assortment_snapshots
    ("importRunId","pricat1FileId","pricat2FileId","projectionVersion","protectiveMarkupPercent")
    VALUES (${runId},${files.find(f=>f.source==='PRICAT1').id},
      ${files.find(f=>f.source==='PRICAT2').id},${PROJECTION_VERSION},${settings.protectiveMarkupPercent})
    RETURNING id`;
  const available=await availableStocksQuery(tx,tx`SELECT "supplierCode" FROM products WHERE NOT "isArchived"`);
  await tx`WITH available AS MATERIALIZED (${available.query})
    INSERT INTO assortment_items ("snapshotId","productId","priceSource","retailPrice","purchasePrice",
      currency,uom,"itemsPerUnit","itemsPerUom",multiplicity,"multiplicityRaw",stocks)
    SELECT ${generation.id},p.id,c.source,a."retailPrice",price."price2",a.currency,a.uom,
      c."itemsPerUnit",c."itemsPerUom",c.multiplicity,c."multiplicityRaw",
      jsonb_agg(jsonb_build_object('warehouse',a.warehouse,'quantity',a.quantity::text,
        'uom',a.uom,'source',a.source) ORDER BY w."sortOrder",w.code)
    FROM available a JOIN products p ON p."supplierCode"=a."supplierCode"
    JOIN product_commercial_data c ON c."productId"=p.id AND c.source::text=a."priceSource"::text
    JOIN product_prices price ON price."commercialDataId"=c.id
    JOIN warehouses w ON w.code=a.warehouse
    GROUP BY p.id,c.id,price.id,a."retailPrice",a.currency,a.uom`;
  const [validation]=await tx`SELECT count(*)::int total,
    count(*) FILTER (WHERE EXISTS(
      SELECT 1 FROM jsonb_array_elements(i.stocks) s
      WHERE s->>'warehouse' NOT IN ('stock1','stock2','stock3')
        OR (s->>'quantity')::numeric<=0 OR s->>'uom'<>i.uom
    ) OR jsonb_array_length(i.stocks)<>(
      SELECT count(DISTINCT s->>'warehouse') FROM jsonb_array_elements(i.stocks) s
    ))::int invalid
    FROM assortment_items i WHERE "snapshotId"=${generation.id}`;
  if(validation.invalid)throw new Error('Assortment validation failed');
  await tx`UPDATE assortment_snapshots SET "productCount"=${validation.total} WHERE id=${generation.id}`;
  // Tests pause/fail here to verify old readers and full source rollback.
  await beforeActivate({snapshotId:generation.id,productCount:validation.total});
  await tx`UPDATE assortment_snapshots SET active=false WHERE active`;
  await tx`UPDATE assortment_snapshots SET active=true WHERE id=${generation.id}`;
  // Keep the just-replaced generation. Cascades affect only derived snapshot rows.
  await tx`DELETE FROM assortment_snapshots WHERE id<>${generation.id} AND id<>${previous?.id ?? generation.id}`;
  return {id:generation.id,productCount:validation.total};
}

async function activeAssortment(tx) {
  const [snapshot]=await tx`SELECT id,"productCount","projectionVersion","createdAt"
    FROM assortment_snapshots WHERE active`;
  if(!snapshot || snapshot.projectionVersion!==PROJECTION_VERSION)
    throw new Error('Assortment snapshot is not ready; run the explicit bootstrap before enabling this reader');
  return snapshot;
}
// Public DTO explicitly omits purchasePrice. No live trading-rule calculation.
async function readSnapshotOffers(tx,snapshotId,productIds) {
  if(!productIds.length)return [];
  return tx`SELECT "productId","priceSource","retailPrice",currency,uom,
    "itemsPerUnit","itemsPerUom",multiplicity,"multiplicityRaw",stocks
    FROM assortment_items WHERE "snapshotId"=${snapshotId} AND "productId" IN ${tx(productIds)}`;
}
module.exports={PROJECTION_VERSION,buildAssortmentSnapshot,activeAssortment,readSnapshotOffers};
