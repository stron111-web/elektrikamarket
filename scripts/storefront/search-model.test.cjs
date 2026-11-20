'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {modelTerms,terms}=require('./search.cjs');
test('hyphen/space model spellings share one adjacent technical phrase',()=>{
 for(const q of ['ВА47-29 16','ва 47 29 16','ва47 29 16','ВА 47–29 16','ВА 47−29 16'])assert.deepEqual(modelTerms(q),{prefix:'ва',numbers:['47','29'],rest:'16'});
 assert.equal(modelTerms('ВА 47-29 16А').rest,'16А');
});
test('single codes, long ordinary words, and suffixes are not guessed as models',()=>{
 for(const q of ['404089','кабель 47 29 16','ВА4729','ВА47-29-1C16','лампа 10 220','ток 16 24','16'])assert.equal(modelTerms(q),null);
});
test('ordinary short words, numbers and typo eligibility keep their existing parsing',()=>{
 assert.equal(terms('кабель')[0].fuzzy,true);assert.equal(terms('ток')[0].shortWord,true);assert.equal(terms('16')[0].technical,true);
});
