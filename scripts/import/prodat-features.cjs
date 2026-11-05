'use strict';
const {createHash}=require('node:crypto');
const fail=message=>{throw Object.assign(new Error(message),{code:'FEATURE_STRUCTURE'});};
function normalizeFeatures(record){
 const rows=[],stats={inputEntries:0,emptyEntries:0,duplicateEntries:0},seen=new Map();
 const container=record.FeatureETIMDetails;
 if(container===undefined||container==='')return {rows,issues:[],stats};
 if(!container||typeof container!=='object'||Array.isArray(container)||Object.keys(container).some(k=>k!=='FeatureETIM'))fail('Expected FeatureETIMDetails.FeatureETIM');
 const values=container.FeatureETIM===undefined?[]:Array.isArray(container.FeatureETIM)?container.FeatureETIM:[container.FeatureETIM];
 for(const [sortOrder,f]of values.entries()){
  stats.inputEntries++;
  if(!f||typeof f!=='object'||Array.isArray(f)||Object.keys(f).some(k=>!['FeatureCode','FeatureName','FeatureValue','FeatureUom'].includes(k)))fail('Unexpected ETIM fields');
  for(const k of ['FeatureCode','FeatureName','FeatureValue','FeatureUom'])if(f[k]!==undefined&&typeof f[k]!=='string')fail('ETIM scalar required: '+k);
  if(!f.FeatureValue?.trim()){stats.emptyEntries++;continue;}
  const featureCode=f.FeatureCode?.trim(),featureName=f.FeatureName?.trim();
  if(!featureCode||!featureName)fail('Nonempty ETIM value requires code and name');
  const row={identityKey:createHash('sha256').update(JSON.stringify(['ETIM',featureCode])).digest('hex'),featureCode,featureName,featureValue:f.FeatureValue,featureUom:f.FeatureUom?.trim()||null,sortOrder};
  const prior=seen.get(featureCode);
  if(prior){if(prior.featureName!==row.featureName||prior.featureValue!==row.featureValue||prior.featureUom!==row.featureUom)fail('Conflicting ETIM code '+featureCode);stats.duplicateEntries++;continue;}
  seen.set(featureCode,row);rows.push(row);
 }
 return {rows,issues:[],stats};
}
module.exports={normalizeFeatures};
