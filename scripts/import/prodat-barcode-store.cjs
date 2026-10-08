'use strict';
const barcodeCounters=()=>({inputEntries:0,uniquePairs:0,duplicateEntries:0,emptyEntries:0,created:0,updated:0,unchanged:0,protected:0});
async function createBarcodeStage(db) {
  await db`CREATE TEMP TABLE prodat_barcode_stage (
    "supplierCode" text,barcode text,type text,"sortOrder" integer,"fileId" integer,"recordNumber" integer,"xmlName" text,
    PRIMARY KEY ("supplierCode",barcode)) ON COMMIT PRESERVE ROWS`;
  await db`CREATE TEMP TABLE prodat_barcode_issues (
    "fileId" integer,"supplierCode" text,"recordNumber" integer,severity text,code text,message text,details jsonb) ON COMMIT PRESERVE ROWS`;
}
async function stageBarcodes(db,rows,issues) {
  if(rows.length)await db`INSERT INTO prodat_barcode_stage SELECT * FROM jsonb_to_recordset(${db.json(rows)})
    AS x("supplierCode" text,barcode text,type text,"sortOrder" integer,"fileId" integer,"recordNumber" integer,"xmlName" text)`;
  if(issues.length)await db`INSERT INTO prodat_barcode_issues SELECT * FROM jsonb_to_recordset(${db.json(issues)})
    AS x("fileId" integer,"supplierCode" text,"recordNumber" integer,severity text,code text,message text,details jsonb)`;
}
async function publishBarcodes(tx,runId) {
  const missing=await tx`SELECT s."supplierCode" FROM prodat_barcode_stage s LEFT JOIN public.products p ON p."supplierCode"=s."supplierCode" WHERE p.id IS NULL LIMIT 1`;
  if(missing.length)throw Object.assign(new Error('Barcode refers to a missing catalog product'),{code:'BARCODE_PRODUCT_MISSING',details:missing[0]});
  await tx`CREATE TEMP TABLE prodat_barcode_publish ON COMMIT DROP AS
    SELECT s.*,p.id AS "productId",b.id AS "existingId",
      CASE WHEN 'barcodes'=ANY(p."lockedFields") OR (b.id IS NOT NULL AND (b.origin='MANUAL' OR b."isLocked")) THEN 'protected'
        WHEN b.id IS NULL THEN 'created'
        WHEN b.type IS DISTINCT FROM s.type OR b."sortOrder" IS DISTINCT FROM s."sortOrder" THEN 'updated'
        ELSE 'unchanged' END AS action,
      (b.id IS NULL OR b.type IS DISTINCT FROM s.type OR b."sortOrder" IS DISTINCT FROM s."sortOrder") AS differs
    FROM prodat_barcode_stage s JOIN public.products p ON p."supplierCode"=s."supplierCode"
    LEFT JOIN public.product_barcodes b ON b."productId"=p.id AND b.barcode=s.barcode`;
  await tx`INSERT INTO prodat_barcode_issues
    SELECT "fileId","supplierCode","recordNumber",'WARNING','BARCODE_PROTECTED',
      'Manual or locked barcode data preserved',jsonb_build_object('barcode',barcode,'xmlName',"xmlName")
    FROM prodat_barcode_publish WHERE action='protected' AND differs`;
  await tx`INSERT INTO prodat_barcode_issues
    WITH links AS (
      SELECT "productId",barcode FROM public.product_barcodes
      UNION SELECT "productId",barcode FROM prodat_barcode_publish WHERE action!='protected' OR "existingId" IS NOT NULL
    ), shared AS (SELECT barcode,count(*) AS owners FROM links GROUP BY barcode HAVING count(*)>1)
    SELECT s."fileId",s."supplierCode",s."recordNumber",'WARNING','BARCODE_SHARED_ACROSS_PRODUCTS',
      'Same barcode belongs to several products; products remain separate',
      jsonb_build_object('barcode',s.barcode,'owners',shared.owners,'xmlName',s."xmlName")
    FROM prodat_barcode_publish s JOIN shared USING(barcode)`;
  await tx`INSERT INTO public.product_barcodes ("productId",barcode,type,"sortOrder",origin,"isLocked")
    SELECT "productId",barcode,type,"sortOrder",'PRODAT',false FROM prodat_barcode_publish
    WHERE action IN ('created','updated') ORDER BY "supplierCode","sortOrder",barcode
    ON CONFLICT ("productId",barcode) DO UPDATE SET type=EXCLUDED.type,"sortOrder"=EXCLUDED."sortOrder"
    WHERE product_barcodes.origin='PRODAT' AND NOT product_barcodes."isLocked"`;
  await tx`INSERT INTO public.import_issues ("runId","fileId",severity,code,"supplierCode","recordNumber",message,details)
    SELECT ${runId},"fileId",severity::"IssueSeverity",code,"supplierCode","recordNumber",message,details FROM prodat_barcode_issues`;
  return {
    counts:await tx`SELECT "fileId",action,count(*)::int AS count FROM prodat_barcode_publish GROUP BY "fileId",action`,
    warnings:await tx`SELECT "fileId",count(*)::int AS count FROM prodat_barcode_issues GROUP BY "fileId"`,
  };
}
module.exports={barcodeCounters,createBarcodeStage,stageBarcodes,publishBarcodes};
