'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {matching}=require('./release-policy.cjs');
test('v2 uses the tested source arithmetic: severe contraction and conflict ratio are not percentage vetoes',()=>{
  const files=['PRICAT1','PRICAT2'].map((source,i)=>({source,sha256:String(i).repeat(64),rows:100,uniqueCodes:50,matched:40,missing:10,conflictingCodes:40,invalidRecords:10,identicalDuplicates:0}));
  const d={status:'DRY_RUN',files,processedRecords:200,conflictingCodes:80,invalidRecords:20,matchedUniqueProducts:40,missingUniqueCodes:10};
  assert.equal(matching(d,files).policy,'owner-current-source-v2');
  assert.throws(()=>matching({...d,processedRecords:201},files),/INVALID_SOURCE_STATS/);
});
