'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {normalizeReferences,hash}=require('./prodat-references.cjs');
const n=r=>normalizeReferences(r,'001');const img='https://example.test/a.jpg',other='https://example.test/b.png';
test('references: absent and empty containers create no rows',()=>{for(const r of [{},{Image:'',CertificateInfo:'',CatalogBrochure:'',Passport:'',Video:'',Analog:'',RelatedProd:''}])for(const v of Object.values(n(r))){assert.equal(v.rows.length,0);assert.equal(v.issues.length,0);}});
test('images: one/multiple, exact identity, duplicates and source positions',()=>{
  assert.deepEqual(n({Image:{Value:img}}).images.rows,[{url:img,urlKey:hash(img),sortOrder:0,alt:null}]);
  const r=n({Image:{Value:[img,img,other]}}).images;assert.equal(r.rows.length,2);assert.equal(r.rows[1].sortOrder,2);assert.equal(r.stats.duplicateEntries,1);assert.equal(r.issues[0].code,'REFERENCE_DUPLICATE');
  assert.equal(normalizeReferences({Image:{Value:img}},'002').images.rows[0].urlKey,r.rows[0].urlKey);
});
test('documents: URL, kind and certificate subtype distinguish identity, no guessed names',()=>{
  const d=n({CertificateInfo:{Certificate:[{CertificateType:'A',CertificateURL:img},{CertificateType:'B',CertificateURL:img},{CertificateType:'A',CertificateURL:img}]},CatalogBrochure:{Value:img},Passport:{Value:[img,other]},Video:{Value:img}}).documents;
  assert.equal(d.rows.length,6);assert.equal(new Set(d.rows.map(r=>r.identityKey)).size,6);assert.equal(d.stats.duplicateEntries,1);assert.deepEqual(d.rows.map(r=>r.sortOrder),[0,1,3,4,5,6]);assert.ok(d.rows.every(r=>r.name===null));assert.equal(n({Passport:{Value:img}}).documents.rows.length,1);
});
test('references: URL spelling, fragments, case and Unicode are preserved; only outer trim is applied visibly',()=>{
  const d=n({Passport:{Value:[' https://example.test/Д окумент.pdf ','пырвпа','../doc.pdf','ftp://example.test/a.pdf','','https://example.test/a.pd']}}).documents;
  assert.equal(d.rows.length,5);assert.equal(d.rows[0].url,'https://example.test/Д окумент.pdf');assert.equal(d.rows[1].url,'пырвпа');assert.ok(d.issues.some(r=>r.code==='REFERENCE_EMPTY'));assert.ok(d.issues.some(r=>r.details.raw===' https://example.test/Д окумент.pdf '));
  assert.equal(n({Image:{Value:['https://example.test/A.jpg','https://example.test/a.jpg','https://example.test/a.jpg#x']}}).images.rows.length,3);
});
test('relations: string codes, multiple kinds, duplicates and self preserved explicitly',()=>{
  const r=n({Analog:{ItemCode:['0002','0002','001']},RelatedProd:{ItemCode:'0002'}}).relations;
  assert.deepEqual(r.rows,[{targetSupplierCode:'0002',relationType:'analog',sortOrder:0},{targetSupplierCode:'001',relationType:'analog',sortOrder:2},{targetSupplierCode:'0002',relationType:'related',sortOrder:0}]);assert.equal(r.stats.duplicateEntries,1);assert.ok(r.issues.some(v=>v.code==='RELATION_SELF'));
});
test('references: unknown metadata and ambiguous structures fail before publication',()=>{
  for(const r of [{Image:{Value:img,Description:'lost'}},{Image:{Value:123}},{CertificateInfo:{Certificate:{CertificateType:'A',CertificateURL:img,Expiry:'tomorrow'}}},{Analog:{ItemCode:2}},{Passport:img}])assert.throws(()=>n(r),{code:'REFERENCE_STRUCTURE'});
});
