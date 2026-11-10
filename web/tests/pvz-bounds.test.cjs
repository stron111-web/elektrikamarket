'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectVisiblePoints } = require('../lib/pvz-bounds.cjs');

const point = (code, lon, lat, cityCode) => ({
  code, longitude: lon, latitude: lat, cityCode,
});

test('expanding a map beyond Tolyatti reveals neighbouring cities, not just its city_code', () => {
  const points = [
    point('TLT1', 49.4, 53.5, 123),
    point('SAM1', 50.1, 53.2, 456),
    point('ZHI1', 49.5, 53.4, 789),
    point('MOS1', 37.6, 55.7, 321),
  ];
  assert.deepEqual(selectVisiblePoints(points, [[49, 53], [51, 54]])?.points.map((p) => p.code),
    ['TLT1', 'SAM1', 'ZHI1']);
  assert.deepEqual(selectVisiblePoints(points, [[49.3, 53.4], [49.6, 53.6]])?.points.map((p) => p.code),
    ['TLT1', 'ZHI1']);
});

test('points without real CDEK city codes or coordinates are not selectable on map', () => {
  const points = [point('KNOWN', 50, 53, 10), point('UNKNOWN', 50, 53, undefined),
    point('ZERO', 50, 53, 0), point('BAD', NaN, 53, 10)];
  assert.deepEqual(selectVisiblePoints(points, [[49, 52], [51, 54]])?.points.map((p) => p.code),
    ['KNOWN']);
});

test('huge viewports are truncated, prioritizing markers near their center', () => {
  const points = Array.from({ length: 12 }, (_, i) => point(String(i), i, 55, i + 1));
  const result = selectVisiblePoints(points, [[0, 50], [12, 60]], 3);
  assert.equal(result?.truncated, true);
  assert.deepEqual(result?.points.map((p) => p.code), ['6', '5', '7']);
});

test('invalid bounds and invalid result limits are rejected before CDEK fetch', () => {
  for (const bounds of [
    [[51, 54], [49, 53]],
    [[NaN, 53], [51, 54]],
    [[-200, 53], [51, 54]],
    [[49, 53], [51, 120]],
    [[49, 53], [49, 54]],
  ]) {
    assert.equal(selectVisiblePoints([], bounds), null);
  }
  assert.equal(selectVisiblePoints([], [[49, 53], [51, 54]], 0), null);
  assert.equal(selectVisiblePoints([], [[49, 53], [51, 54]], 50000), null);
});
