'use strict';
const {reviewDrySummary}=require('./source-review.cjs');
const POLICY='owner-current-source-v2';
function matching(d,received) {
  reviewDrySummary(d,received);
  return {policy:POLICY,matchedUniqueProducts:d.matchedUniqueProducts,
    unknownUniqueCodes:d.missingUniqueCodes,
    sources:d.files.map(f=>({source:f.source,rows:f.rows,uniqueCodes:f.uniqueCodes,
      matched:f.matched,missing:f.missing,conflictingCodes:f.conflictingCodes,invalidRecords:f.invalidRecords}))};
}
async function publication(tx,id,b,guard) {
  const [active]=await tx`SELECT id FROM assortment_snapshots WHERE active`;
  guard(String(active?.id)===String(b.id),'BASELINE_CHANGED');
  const [v]=await tx`SELECT count(*)::int count,count(*) FILTER(WHERE p.id IS NULL OR p."isArchived"
    OR i."retailPrice"<=0 OR i.currency<>'RUB' OR i.uom IS NULL OR jsonb_array_length(i.stocks)=0
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(i.stocks) s WHERE
      s->>'warehouse' NOT IN ('stock1','stock2','stock3') OR (s->>'quantity')::numeric<=0
      OR s->>'uom'<>i.uom OR s->>'source' IS DISTINCT FROM
        CASE WHEN s->>'warehouse'='stock2' THEN 'PRICAT2' ELSE 'PRICAT1' END)
    OR jsonb_array_length(i.stocks)<>(SELECT count(DISTINCT s->>'warehouse') FROM jsonb_array_elements(i.stocks) s)
    )::int invalid FROM assortment_items i LEFT JOIN products p ON p.id=i."productId" WHERE i."snapshotId"=${id}`;
  guard(v.invalid===0,'SNAPSHOT_STRUCTURAL_INVARIANT');
  // A valid, nonempty source may legitimately have zero saleable offers.
  return {policy:POLICY,count:v.count,invalid:v.invalid};
}
module.exports={POLICY,matching,publication};
