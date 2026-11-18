'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sourceTimestamp,documentStamp}=require('./source-time.cjs');
const p={maxAgeHours:168,maxFutureMinutes:10};
test('actual Russvet PRICAT2 metadata reproduces the old future-date rejection and fixes it without widening tolerance',()=>{
  const now=Date.parse('2026-11-18T06:12:03.465Z');
  assert.throws(()=>sourceTimestamp({date:'20261118063515'},p,now),{code:'FTP_SOURCE_DATE'});
  assert.equal(sourceTimestamp({date:'20261118063515',modified:'2026-11-18T03:37:00.000Z'},p,now),Date.parse('2026-11-18T03:37:00Z'));
});
test('UTC metadata still rejects future/stale/ambiguous metadata and malformed calendar dates',()=>{
  const now=Date.parse('2026-11-18T06:12:03Z');
  for(const modified of ['2026-11-18T07:00:00.000Z','2026-10-01T03:00:00.000Z'])
    assert.throws(()=>sourceTimestamp({date:'20261118063515',modified},p,now),{code:'FTP_MODIFIED_DATE'});
  assert.throws(()=>sourceTimestamp({date:'20261118063515',modified:'2026-11-18 03:37'},p,now),{code:'FTP_MODIFIED_DATE'});
  assert.throws(()=>documentStamp('20260231000000'),{code:'FTP_SOURCE_DATE'});
  assert.doesNotThrow(()=>sourceTimestamp({date:'20260101000000',modified:'2026-01-01T00:00:00.000Z'},p,now,true));
});
