'use strict';
const {REFERENCE_LAYERS}=require('./prodat-references.cjs');
const CONFIG={
  images:{table:'product_images',identity:['urlKey'],fields:{url:'text',urlKey:'text',sortOrder:'integer',alt:'text'}},
  documents:{table:'product_documents',identity:['identityKey'],fields:{identityKey:'text',type:'text',certificateType:'text',url:'text',name:'text',sortOrder:'integer'}},
  relations:{table:'product_relations',identity:['targetSupplierCode','relationType'],fields:{targetSupplierCode:'text',relationType:'text',sortOrder:'integer'}},
};
const q=s=>'"'+s+'"';
const referenceCounters=()=>Object.fromEntries(Object.keys(REFERENCE_LAYERS).map(k=>[k,{inputEntries:0,uniquePairs:0,duplicateEntries:0,emptyEntries:0,created:0,updated:0,unchanged:0,protected:0}]));
async function createReferenceStage(db){
  await db`CREATE TEMP TABLE prodat_reference_stage (layer text,"supplierCode" text,data jsonb,"fileId" integer,"recordNumber" integer,"xmlName" text) ON COMMIT PRESERVE ROWS`;
  await db`CREATE TEMP TABLE prodat_reference_issues ("fileId" integer,"supplierCode" text,"recordNumber" integer,severity text,code text,message text,details jsonb) ON COMMIT PRESERVE ROWS`;
}
async function stageReferences(db,rows,issues){
  if(rows.length)await db`INSERT INTO prodat_reference_stage SELECT * FROM jsonb_to_recordset(${db.json(rows)}) AS x(layer text,"supplierCode" text,data jsonb,"fileId" integer,"recordNumber" integer,"xmlName" text)`;
  if(issues.length)await db`INSERT INTO prodat_reference_issues SELECT * FROM jsonb_to_recordset(${db.json(issues)}) AS x("fileId" integer,"supplierCode" text,"recordNumber" integer,severity text,code text,message text,details jsonb)`;
}
async function publishReferences(tx,runId){
  const missing=await tx`SELECT s."supplierCode" FROM prodat_reference_stage s LEFT JOIN public.products p ON p."supplierCode"=s."supplierCode" WHERE p.id IS NULL LIMIT 1`;
  if(missing.length)throw Object.assign(new Error('Reference source product is missing'),{code:'REFERENCE_PRODUCT_MISSING',details:missing[0]});
  await tx`CREATE INDEX ON prodat_reference_stage(layer)`;
  const counts=[];
  for(const [layer,cfg] of Object.entries(CONFIG)){
    const fields=Object.keys(cfg.fields),isRelation=layer==='relations';if(isRelation)fields.push('relatedId');
    const join=cfg.identity.map(k=>`b.${q(k)}=d.${q(k)}`).join(' AND ');
    const col=k=>isRelation&&k==='relatedId'?'target.id':`d.${q(k)}`;
    const changed=fields.filter(k=>!cfg.identity.includes(k)).map(k=>`b.${q(k)} IS DISTINCT FROM ${col(k)}`).join(' OR ');
    const pub='prodat_'+layer+'_publish';
    await tx.unsafe(`CREATE TEMP TABLE ${pub} ON COMMIT DROP AS SELECT s."supplierCode",s."fileId",s."recordNumber",s."xmlName",p.id AS "productId",b.id AS "existingId",
      ${fields.map(k=>`${col(k)} AS ${q(k)}`).join(',')},
      CASE WHEN '${layer}'=ANY(p."lockedFields") OR (b.id IS NOT NULL AND (b.origin='MANUAL' OR b."isLocked")) THEN 'protected'
        WHEN b.id IS NULL THEN 'created' WHEN (${changed}) THEN 'updated' ELSE 'unchanged' END AS action,
      (b.id IS NULL OR (${changed})) AS differs ${isRelation?',b."relatedId" AS "existingRelatedId"':''}
      FROM prodat_reference_stage s CROSS JOIN LATERAL jsonb_to_record(s.data) AS d(${Object.entries(cfg.fields).map(([k,t])=>q(k)+' '+t).join(',')})
      JOIN public.products p ON p."supplierCode"=s."supplierCode"
      ${isRelation?'LEFT JOIN public.products target ON target."supplierCode"=d."targetSupplierCode"':''}
      LEFT JOIN public.${cfg.table} b ON b."productId"=p.id AND ${join} WHERE s.layer='${layer}'`);
    // Refuse an identity collision instead of overwriting a different source URL.
    if(!isRelation){const collisions=await tx.unsafe(`SELECT n."supplierCode" FROM ${pub} n JOIN public.${cfg.table} b ON b.id=n."existingId" WHERE b.url IS DISTINCT FROM n.url LIMIT 1`);
      if(collisions.length)throw Object.assign(new Error('Reference URL identity collision'),{code:'REFERENCE_IDENTITY_COLLISION',details:{layer,...collisions[0]}});}
    await tx.unsafe(`INSERT INTO prodat_reference_issues SELECT "fileId","supplierCode","recordNumber",'WARNING','REFERENCE_PROTECTED',
      'Manual or locked reference preserved',jsonb_build_object('layer','${layer}','source',to_jsonb(n)-'action'-'differs') FROM ${pub} n WHERE action='protected' AND differs`);
    if(isRelation)await tx.unsafe(`INSERT INTO prodat_reference_issues SELECT "fileId","supplierCode","recordNumber",'WARNING','RELATION_UNRESOLVED',
      'Target product absent; external code and nullable link preserved',jsonb_build_object('targetSupplierCode',"targetSupplierCode",'relationType',"relationType",'xmlName',"xmlName")
      FROM ${pub} WHERE (action!='protected' AND "relatedId" IS NULL) OR (action='protected' AND "existingId" IS NOT NULL AND "existingRelatedId" IS NULL)`);
    const all=['productId',...fields];
    await tx.unsafe(`INSERT INTO public.${cfg.table} (${all.map(q).join(',')},origin,"isLocked") SELECT ${all.map(q).join(',')},'PRODAT',false FROM ${pub}
      WHERE action IN ('created','updated') ORDER BY "supplierCode",${cfg.identity.map(q).join(',')}
      ON CONFLICT (${['productId',...cfg.identity].map(q).join(',')}) DO UPDATE SET ${fields.filter(k=>!cfg.identity.includes(k)).map(k=>q(k)+'=EXCLUDED.'+q(k)).join(',')}
      WHERE ${cfg.table}.origin='PRODAT' AND NOT ${cfg.table}."isLocked"`);
    counts.push(...(await tx.unsafe(`SELECT "fileId",action,count(*)::int AS count FROM ${pub} GROUP BY "fileId",action`)).map(r=>({...r,layer})));
  }
  await tx`INSERT INTO public.import_issues ("runId","fileId","supplierCode","recordNumber",severity,code,message,details)
    SELECT ${runId},"fileId","supplierCode","recordNumber",severity::"IssueSeverity",code,message,details FROM prodat_reference_issues`;
  return {counts,warnings:await tx`SELECT "fileId",count(*)::int AS count FROM prodat_reference_issues GROUP BY "fileId"`};
}
async function resolveExistingRelations(tx){
  const rows=await tx`WITH fixed AS (UPDATE public.product_relations r SET "relatedId"=target.id FROM public.products target,public.products source
    WHERE r."relatedId" IS NULL AND r.origin='PRODAT' AND NOT r."isLocked" AND source.id=r."productId" AND NOT ('relations'=ANY(source."lockedFields"))
      AND target."supplierCode"=r."targetSupplierCode" RETURNING r.id) SELECT count(*)::int AS count FROM fixed`;
  return rows[0].count;
}
module.exports={referenceCounters,createReferenceStage,stageReferences,publishReferences,resolveExistingRelations};
