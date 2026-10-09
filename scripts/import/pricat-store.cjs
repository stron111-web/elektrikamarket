'use strict';
// Identifiers come exclusively from these fixed declarations, never XML.
const definitions={
  product_commercial_data:{key:['productId','source'],fields:['productId','source','multiplicity','multiplicityRaw','itemsPerUnit','itemsPerUom','uom','analitCat','mark','blockExpAll','blockExpBy','blockExpKz','rawData','importFileId','updatedAt']},
  product_prices:{key:['commercialDataId'],fields:['commercialDataId','retailPrice','custPrice','price2','mrc','bsp','availabilityMrc','currency','retailCurrency','rawData','importFileId','updatedAt']},
  product_stocks:{key:['productId','warehouseId'],fields:['productId','warehouseId','quantity','quantityRaw','uom','source','quantityField','sourceUpdatedDate','estimatedArrivalDate','importFileId','updatedAt']},
};
async function upsert(db,table,rows) {
  if(!rows.length)return [];
  const {fields,key}=definitions[table],q=s=>'"'+s+'"';
  const updates=fields.filter(k=>!key.includes(k)).map(k=>`${q(k)}=EXCLUDED.${q(k)}`).join(',');
  return db.unsafe(`INSERT INTO public.${table} AS target (${fields.map(q).join(',')})
    SELECT ${fields.map(q).join(',')} FROM jsonb_populate_recordset(NULL::public.${table},$1::jsonb)
    ON CONFLICT (${key.map(q).join(',')}) DO UPDATE SET ${updates}
    WHERE NOT target."isLocked" RETURNING *`,[db.json(rows)]);
}
async function applyBatch({db,input,batch,warehouseIds,summary,issue,dryRun=false}) {
  if(!batch.length)return;
  const codes=batch.map(r=>r.supplierCode);
  const products=await db`SELECT p.id,p."supplierCode",p."lockedFields",c.id AS cid,c."isLocked" AS locked,
    c.uom,c."itemsPerUnit",c."itemsPerUom",price.id AS pid,price."isLocked" AS "priceLocked"
    FROM public.products p LEFT JOIN public.product_commercial_data c ON c."productId"=p.id AND c.source=${input.source}
    LEFT JOIN public.product_prices price ON price."commercialDataId"=c.id WHERE p."supplierCode" IN ${db(codes)}`;
  if(!products.length)return;
  const byCode=new Map(products.map(p=>[p.supplierCode,p]));
  const stocks=await db`SELECT * FROM public.product_stocks WHERE "productId" IN ${db(products.map(p=>p.id))}`;
  const byStock=new Map(stocks.map(s=>[s.productId+':'+s.warehouseId,s]));
  const unitEvents=await db`SELECT DISTINCT ON (i."supplierCode",i.details->>'warehouse')
      i."supplierCode",i.details->>'warehouse' AS warehouse,i.code
    FROM public.import_issues i JOIN public.import_files f ON f.id=i."fileId"
    JOIN public.import_runs r ON r.id=f."runId"
    WHERE i."supplierCode" IN ${db(codes)} AND f.source=${input.source}
      AND i.code IN ('STOCK_UOM_CONFLICT','STOCK_UOM_CONFIRMED')
      AND f.status='SUCCEEDED' AND r.status='SUCCEEDED'
    ORDER BY i."supplierCode",i.details->>'warehouse',f.id DESC,i.id DESC`;
  const previousUnits=new Map(unitEvents.map(e=>[e.supplierCode+':'+e.warehouse,e.code]));
  const commercial=[],prices=[],stockRows=[],eligible=[];
  const now=new Date().toISOString();
  for(const row of batch) {
    const p=byCode.get(row.supplierCode);if(!p)continue;
    // Diagnose supplier stocks even when their values or commercial data are locked.
    // A matching later observation clears only this warehouse's UOM quarantine.
    for(const s of row.normalized.stocks) {
      const existing=byStock.get(p.id+':'+warehouseIds.get(s.warehouse));
      if(!existing || existing.source!==input.source)continue;
      const mismatch=existing.uom!==s.uom;
      if(mismatch || previousUnits.get(row.supplierCode+':'+s.warehouse)==='STOCK_UOM_CONFLICT')
        await issue(input,row,mismatch?'STOCK_UOM_CONFLICT':'STOCK_UOM_CONFIRMED',
          mismatch?'Supplier stock UOM conflict; exclude warehouse from sale':'Supplier stock UOM confirmed by subsequent record',
          {warehouse:s.warehouse,existingUom:existing.uom,incomingUom:s.uom,record:row.record});
    }
    if(p.locked || p.lockedFields.includes('commercialData')) {
      summary.protectedRecords++;await issue(input,row,'PROTECTED_COMMERCIAL','Manual or locked commercial data preserved',{});continue;
    }
    eligible.push({row,p});
    const priceLocked=p.priceLocked || p.lockedFields.includes('prices');
    const incoming=row.normalized.commercial;
    const unitChanged=p.cid && (p.uom!==incoming.uom || p.itemsPerUom!==incoming.itemsPerUom || decimalKey(p.itemsPerUnit)!==decimalKey(incoming.itemsPerUnit));
    // UOM and package size belong to the price's meaning. Preserve its existing
    // commercial context as well when a locked price cannot follow a unit change.
    if(priceLocked && unitChanged)
      await issue(input,row,'PROTECTED_PRICE_UNIT','Commercial context retained for locked price',{existingUom:p.uom,incomingUom:incoming.uom,record:row.record});
    else commercial.push({...incoming,productId:p.id,importFileId:input.id ?? null,updatedAt:now});
    if(priceLocked) {summary.protectedRecords++;await issue(input,row,'PROTECTED_PRICE','Locked price preserved',{});}
    else prices.push({...row.normalized.price,productId:p.id,importFileId:input.id ?? null,updatedAt:now});
    for(const s of row.normalized.stocks) {
      const warehouseId=warehouseIds.get(s.warehouse),existing=byStock.get(p.id+':'+warehouseId);
      if(p.lockedFields.includes('stocks') || existing && (existing.isLocked || existing.source==='MANUAL' || existing.source!==input.source || existing.uom!==s.uom)) {
        summary.protectedRecords++;await issue(input,row,'PROTECTED_STOCK','Locked/manual/source/UOM mismatch preserved',{warehouse:s.warehouse,existingUom:existing?.uom ?? null,incomingUom:s.uom});continue;
      }
      const {warehouse,...data}=s;
      stockRows.push({...data,productId:p.id,warehouseId,importFileId:input.id ?? null,updatedAt:now});
    }
  }
  if(dryRun) {summary.plannedProducts=(summary.plannedProducts || 0)+eligible.length;return;}
  const ids=new Map((await upsert(db,'product_commercial_data',commercial)).map(c=>[c.productId,c.id]));
  await upsert(db,'product_prices',prices.map(({productId,...price})=>({...price,commercialDataId:ids.get(productId)})));
  await upsert(db,'product_stocks',stockRows);
  summary.updatedRecords+=eligible.length;
}
function decimalKey(value) {
  return value == null ? null : String(value).replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
}
// One authoritative product price, independent of stock quantities or warehouses.
function storefrontPricesSql(db,supplierCodes) {
  return db`SELECT p."supplierCode",chosen.source AS "priceSource",chosen.uom,
      chosen."retailPrice",chosen.currency
    FROM public.products p CROSS JOIN public.shop_settings settings
    CROSS JOIN LATERAL (
      SELECT c.source,c.uom,upper(price."retailCurrency") AS currency,effective.value AS "retailPrice"
      FROM public.product_commercial_data c JOIN public.product_prices price ON price."commercialDataId"=c.id
      CROSS JOIN LATERAL (SELECT CASE WHEN c.source<>'MANUAL' AND NOT price."isLocked" AND NOT c."isLocked"
        AND NOT ('prices'=ANY(p."lockedFields"))
        AND price."rawData"->>'protectiveRuleApplied'='true'
        AND price."rawData"->>'RetailPrice' ~ '^[0-9]+([.][0-9]+)?$'
        THEN (price."rawData"->>'RetailPrice')::numeric ELSE price."retailPrice" END AS value) base
      CROSS JOIN LATERAL (SELECT CASE WHEN price."price2">0 AND base.value<price."price2"
        THEN round(price."price2"*(1+settings."protectiveMarkupPercent"/100),2)
        ELSE base.value END AS value) effective
      WHERE c."productId"=p.id AND c.uom IS NOT NULL AND c.uom<>'' AND price."retailPrice">0
        AND upper(price."retailCurrency")='RUB' AND upper(price.currency)='RUB'
        AND (c.source='MANUAL' OR price."price2">0)
        AND effective.value>0 AND effective.value<1000000000000
        AND NOT EXISTS(SELECT 1 FROM public.import_issues i JOIN public.import_files f ON f.id=i."fileId"
          JOIN public.import_runs r ON r.id=f."runId"
          WHERE i."supplierCode"=p."supplierCode" AND f.source::text=c.source::text
            AND i.code IN ('CONFLICTING_DUPLICATE','INVALID_RECORD') AND f.status='SUCCEEDED' AND r.status='SUCCEEDED'
            AND f.id>=least(COALESCE(c."importFileId",0),COALESCE(price."importFileId",0)))
      ORDER BY CASE c.source WHEN 'MANUAL' THEN 0 WHEN 'PRICAT2' THEN 1 ELSE 2 END LIMIT 1
    ) chosen
    WHERE p."supplierCode" IN ${db(supplierCodes)} AND NOT p."isArchived" AND settings.id=1
      AND settings."protectiveMarkupPercent">=0 AND chosen."retailPrice">0 AND chosen."retailPrice"<1000000000000`;
}
async function readStorefrontPrices(db,supplierCodes) {
  return supplierCodes.length ? storefrontPricesSql(db,supplierCodes) : [];
}
// A single statement gives price and stocks a consistent PostgreSQL snapshot.
// Quarantine applies to each stock's source even when its stored value is locked.
async function readAvailableStocks(db,supplierCodes) {
  if(!supplierCodes.length)return [];
  return db`WITH sale_prices AS (${storefrontPricesSql(db,supplierCodes)})
    SELECT p."supplierCode",w.code AS warehouse,s.quantity,s.uom,s.source,
      sale."priceSource",sale."retailPrice",sale.currency
    FROM public.product_stocks s JOIN public.products p ON p.id=s."productId"
    JOIN public.warehouses w ON w.id=s."warehouseId" JOIN sale_prices sale ON sale."supplierCode"=p."supplierCode"
    WHERE NOT p."isArchived" AND NOT w."isArchived" AND s.quantity>0 AND s.uom=sale.uom
      AND COALESCE((SELECT i.code FROM public.import_issues i JOIN public.import_files f ON f.id=i."fileId"
        JOIN public.import_runs r ON r.id=f."runId"
        WHERE i."supplierCode"=p."supplierCode" AND f.source::text=s.source::text
          AND i.details->>'warehouse'=w.code AND i.code IN ('STOCK_UOM_CONFLICT','STOCK_UOM_CONFIRMED')
          AND f.status='SUCCEEDED' AND r.status='SUCCEEDED'
        ORDER BY f.id DESC,i.id DESC LIMIT 1),'')<>'STOCK_UOM_CONFLICT'
      AND NOT EXISTS(SELECT 1 FROM public.import_issues i JOIN public.import_files f ON f.id=i."fileId"
        JOIN public.import_runs r ON r.id=f."runId"
        WHERE i."supplierCode"=p."supplierCode" AND f.source::text=s.source::text
          AND i.code IN ('CONFLICTING_DUPLICATE','INVALID_RECORD') AND f.status='SUCCEEDED' AND r.status='SUCCEEDED'
          AND f.id>=COALESCE(s."importFileId",0))
    ORDER BY p."supplierCode",w."sortOrder"`;
}
async function readSaleOffers(db,supplierCodes) {
  const stocks=await readAvailableStocks(db,supplierCodes),products=new Map();
  for(const stock of stocks) {
    let offer=products.get(stock.supplierCode);
    if(!offer) {
      offer={supplierCode:stock.supplierCode,priceSource:stock.priceSource,retailPrice:stock.retailPrice,
        currency:stock.currency,uom:stock.uom,stocks:[]};
      products.set(stock.supplierCode,offer);
    }
    offer.stocks.push({warehouse:stock.warehouse,quantity:stock.quantity,uom:stock.uom,source:stock.source});
  }
  return [...products.values()];
}
module.exports={applyBatch,readStorefrontPrices,readAvailableStocks,readSaleOffers};
