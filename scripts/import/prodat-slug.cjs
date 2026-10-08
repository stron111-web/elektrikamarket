'use strict';
const { createHash } = require('node:crypto');
const RU = Object.fromEntries([... 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'].map((c,i)=>[c, ['a','b','v','g','d','e','yo','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','kh','ts','ch','sh','shch','','y','','e','yu','ya'][i]]));
const hash = value => createHash('sha256').update(value).digest('hex');
function slugify(value, limit = 120) {
  return [...value.normalize('NFC').toLowerCase()].map(c=>RU[c] ?? c).join('')
    .normalize('NFKD').replace(/\p{M}/gu,'').replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'').slice(0,limit).replace(/-+$/g,'');
}
function technicalSlug(kind, identity) { return kind + '-' + hash(identity); }
// Each table is a separate URL namespace. Existing slugs are immutable and reserved.
function planSlugs(kind, candidates, existing = []) {
  if (!['product','category','brand'].includes(kind)) throw new Error('Unknown slug kind');
  const reserved = new Set(existing.map(row=>row.slug));
  if (reserved.size !== existing.length) throw new Error('Existing slugs are not unique');
  const identities = new Set(), groups = new Map();
  const rows = candidates.map(row=>{
    if (typeof row.identity !== 'string' || !row.identity || typeof row.name !== 'string') throw new Error('Invalid slug identity/name');
    if (identities.has(row.identity)) throw new Error('Duplicate slug identity');
    identities.add(row.identity);
    const base = slugify(row.name) || kind;
    groups.set(base,(groups.get(base)||0)+1);
    return {...row,base};
  }).sort((a,b)=>a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0);
  for (const row of rows) {
    row.suffixed = groups.get(row.base)>1 || reserved.has(row.base) || !slugify(row.name);
    row.proposed = row.suffixed
      ? row.base + '-' + (kind === 'brand' ? hash(row.identity).slice(0,12) : slugify(row.identity,48) || hash(row.identity).slice(0,12))
      : row.base;
  }
  const counts = new Map();
  for(const row of rows) counts.set(row.proposed,(counts.get(row.proposed)||0)+1);
  for(const row of rows) {
    row.fallback = reserved.has(row.proposed) || counts.get(row.proposed)>1;
    if(row.fallback) row.proposed += '-' + hash(row.identity);
  }
  for(const row of rows) {
    if(reserved.has(row.proposed)) throw new Error('Unresolved slug collision: ' + row.proposed);
    reserved.add(row.proposed);
  }
  return { rows, stats: {
    candidates: rows.length,
    collisionGroups: [...groups.values()].filter(n=>n>1).length,
    rowsInCollisionGroups: [...groups.values()].filter(n=>n>1).reduce((a,b)=>a+b,0),
    suffixed: rows.filter(r=>r.suffixed).length,
    fallback: rows.filter(r=>r.fallback).length,
    unresolved: 0,
  }};
}
module.exports = { slugify, technicalSlug, planSlugs, hash };
