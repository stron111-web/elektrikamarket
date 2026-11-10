'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectVisiblePoints } = require('../lib/pvz-bounds.cjs');
const pvz = (code, x, y, cityCode) => ({code, longitude:x, latitude:y, cityCode, address:code, city:code, hours:''});

test('Yandex upper-left/lower-right bounds contain Tolyatti, Samara and Zhigulyovsk', () => {
  const points = [
    pvz('TLT',49.35,53.52,100), pvz('SAM',50.1,53.2,200),
    pvz('ZHI',49.5,53.4,300), pvz('MOS',37.6,55.7,400)];
  assert.deepEqual(
    selectVisiblePoints(points, [[49,54],[51,53]])?.points.map(x=>x.code),
    ['TLT','SAM','ZHI']);
});

test('both corner orientations are accepted; no result from outside the viewport', () => {
  const points = [pvz('SAM',50.1,53.2,200),pvz('MOS',37.6,55.7,400)];
  assert.deepEqual(selectVisiblePoints(points, [[51,53],[49,54]])?.points.map(x=>x.code), ['SAM']);
});

test('points without a verified CDEK city code cannot be selected from the adjacent-city map', () => {
  const points = [pvz('OK',50,53,100),pvz('NO_CODE',50,53,undefined),pvz('ZERO',50,53,0)];
  assert.deepEqual(selectVisiblePoints(points,[[49,54],[51,52]])?.points.map(x=>x.code),['OK']);
});

test('overfull response caps size and favors points near center', () => {
  const points = Array.from({length:9},(_,i)=>pvz(String(i),i,55,i+1));
  const result = selectVisiblePoints(points, [[0,56],[10,54]],3);
  assert.equal(result?.truncated,true);
  assert.deepEqual(result?.points.map(x=>x.code),['5','4','6']);
});

test('invalid bounds rejected and do not trigger a CDEK fetch', () => {
  for(const bounds of [ [[0,0],[0,1]], [[0,0],[1,0]], [[NaN,1],[2,3]],
    [[181,1],[182,2]], [[1,-91],[2,2]], [], [[1,2],[3,Infinity]] ]) {
    assert.equal(selectVisiblePoints([],bounds),null);
  }
});
