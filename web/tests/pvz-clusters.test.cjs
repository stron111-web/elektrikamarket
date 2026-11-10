'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { groupVisiblePoints } = require('../lib/pvz-clusters.cjs');
const point = (code, longitude, latitude, cityCode) => ({
  code, longitude, latitude, cityCode, address: code, city: String(cityCode), hours: '',
});

test('server groups 2500 visible PVZ before the former 500-item limit', () => {
  const all = Array.from({length:2500}, (_,i)=>point('UFA'+i,55.9+(i%25)/20000,54.73+(i%50)/20000,1));
  const out = groupVisiblePoints(all,[[55,55],[57,54]],7,1);
  assert.equal(out?.total,2500);
  assert.equal(out?.hasSelectedCity,true);
  assert.equal(out?.truncated,false);
  assert.equal(out?.nodes.reduce((n,p)=>n+(p.kind==='cluster'?p.count:1),0),2500);
  assert.ok(out.nodes.length < 100);
});

test('faraway visible towns are included instead of choosing only the map centre', () => {
  const all = [point('UFA',55.9,54.74,1),point('STERLITAMAK',55.95,53.62,2),
    point('BELORETSK',58.4,53.97,3),point('MOSCOW',37.6,55.7,4)];
  const out = groupVisiblePoints(all,[[55,55],[59,53]],10,1);
  assert.equal(out?.total,3);
  const counts = out.nodes.reduce((n,p)=>n+(p.kind==='cluster'?p.count:1),0);
  assert.equal(counts,3);
});

test('clicking on a cluster can expose distinct points at higher zoom', () => {
  const all = [point('A',55.9,54.73,1),point('B',55.95,54.73,1)];
  const bounds = [[55,55],[56,54]];
  const zoomOut = groupVisiblePoints(all,bounds,4);
  const zoomIn = groupVisiblePoints(all,bounds,18);
  assert.equal(zoomOut?.nodes.length,1);
  assert.equal(zoomOut?.nodes[0]?.kind,'cluster');
  assert.deepEqual(zoomIn?.nodes.map(n=>n.kind),['point','point']);
});

test('at street zoom current city pins are left to the existing renderer', () => {
  const all = [point('LOCAL',55.9,54.73,1),point('NEIGHBOUR',55.92,54.73,2)];
  const out = groupVisiblePoints(all,[[55,55],[56,54]],15,1);
  assert.equal(out?.hasSelectedCity,true);
  assert.equal(out?.total,1);
  assert.equal(out?.nodes[0]?.kind,'point');
  assert.equal(out?.nodes[0]?.point.code,'NEIGHBOUR');
});

test('invalid camera locations and bounds are rejected', () => {
  const all = [point('LOCAL',55.9,54.73,1)];
  assert.equal(groupVisiblePoints(all,[[55,55],[56,54]],NaN),null);
  assert.equal(groupVisiblePoints(all,[[55,55],[56,54]],0),null);
  assert.equal(groupVisiblePoints(all,[[55,55],[56,54]],22),null);
  assert.equal(groupVisiblePoints(all,[[55,55],[56,54]],10,-1),null);
  assert.equal(groupVisiblePoints(all,[[55,55],[56,54]],10,1,1000),null);
  assert.equal(groupVisiblePoints(all,[[55,55],[55,54]],10),null);
});
