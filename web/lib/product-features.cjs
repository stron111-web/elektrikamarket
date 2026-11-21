'use strict';
const text=value=>typeof value==='string'?value.trim():'';
function meaningful(value){
  if(!value)return false;
  // Supplier/legacy JSON is a technical payload, never a human ETIM value.
  if(/^[\[{]/.test(value)){try{const parsed=JSON.parse(value);if(parsed&&typeof parsed==='object')return false;}catch{}}
  return true;
}
function productFeatures(rows){
  const groups=new Map();
  for(const row of rows){
    const name=text(row.featureName),value=text(row.featureValue),code=text(row.featureCode)||null,uom=text(row.featureUom)||null;
    if(!meaningful(name)||!meaningful(value)||/^EF\d+(?:_\d+)?$/i.test(name))continue;
    const key=JSON.stringify([code,name,uom]);
    if(!groups.has(key))groups.set(key,{key,code,name,uom,values:[]});
    const group=groups.get(key);if(!group.values.includes(value))group.values.push(value);
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru')||a.key.localeCompare(b.key));
}
function duplicateBasic(label,value,features){
  const normalize=v=>String(v).trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
  return features.some(f=>normalize(f.name)===normalize(label)&&f.values.some(v=>normalize(v+(f.uom?' '+f.uom:''))===normalize(value)));
}
module.exports={productFeatures,duplicateBasic};
