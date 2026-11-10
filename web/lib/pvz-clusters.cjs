'use strict';

const { selectVisiblePoints } = require('./pvz-bounds.cjs');

/**
 * Group every visible CDEK point BEFORE limiting the response. This preserves
 * actual point counts when the user zooms out beyond the previous 500-pin cap.
 *
 * @typedef {{code:string, longitude:number, latitude:number, cityCode?:number}} Point
 * @typedef {[[number,number],[number,number]]} Bounds
 */

/**
 * @template {Point} T
 * @param {T[]} points
 * @param {Bounds} bounds
 * @param {number} zoom
 * @param {number} [selectedCityCode]
 * @param {number} [limit]
 * @returns {{nodes:Array<{kind:'point',point:T}|{kind:'cluster',count:number,longitude:number,latitude:number}>,total:number,hasSelectedCity:boolean,truncated:boolean}|null}
 */
function groupVisiblePoints(points, bounds, zoom, selectedCityCode = 0, limit = 400) {
  if (!selectVisiblePoints([], bounds) || !Number.isFinite(zoom) || zoom < 1 || zoom > 21 ||
      !Number.isInteger(selectedCityCode) || selectedCityCode < 0 ||
      !Number.isInteger(limit) || limit < 1 || limit > 400) return null;

  const west = Math.min(bounds[0][0], bounds[1][0]);
  const east = Math.max(bounds[0][0], bounds[1][0]);
  const south = Math.min(bounds[0][1], bounds[1][1]);
  const north = Math.max(bounds[0][1], bounds[1][1]);
  const rawCityPinsShown = zoom >= 15;
  const worldSize = 256 * (2 ** Math.round(zoom));
  const cellSize = 64;
  /** @type {Map<string,{count:number,sumLongitude:number,sumLatitude:number,first:T}>} */
  const buckets = new Map();
  const seen = new Set();
  let total = 0;
  let hasSelectedCity = false;

  for (const point of points) {
    if (!point.code || seen.has(point.code) ||
        !Number.isInteger(point.cityCode) || point.cityCode <= 0 ||
        !Number.isFinite(point.longitude) || !Number.isFinite(point.latitude) ||
        point.longitude < west || point.longitude > east ||
        point.latitude < south || point.latitude > north ||
        Math.abs(point.latitude) > 85) continue;
    seen.add(point.code);
    if (point.cityCode === selectedCityCode) hasSelectedCity = true;
    // At street-level zoom the original city pins remain visible. Aggregate
    // other cities only, avoiding duplicates with the existing city list.
    if (rawCityPinsShown && point.cityCode === selectedCityCode) continue;
    total += 1;
    const latRadians = point.latitude * Math.PI / 180;
    const sinLat = Math.sin(latRadians);
    const x = (point.longitude + 180) / 360 * worldSize;
    const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;
    const key = Math.floor(x / cellSize) + ':' + Math.floor(y / cellSize);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.sumLongitude += point.longitude;
      bucket.sumLatitude += point.latitude;
    } else {
      buckets.set(key, { count: 1, sumLongitude: point.longitude, sumLatitude: point.latitude, first: point });
    }
  }

  /** @type {Array<{kind:'point',point:T}|{kind:'cluster',count:number,longitude:number,latitude:number}>} */
  const nodes = [];
  for (const bucket of buckets.values()) {
    if (bucket.count === 1) nodes.push({ kind: 'point', point: bucket.first });
    else nodes.push({
      kind: 'cluster',
      count: bucket.count,
      longitude: bucket.sumLongitude / bucket.count,
      latitude: bucket.sumLatitude / bucket.count,
    });
  }
  const truncated = nodes.length > limit;
  if (truncated) {
    const centerLongitude = (west + east) / 2;
    const centerLatitude = (south + north) / 2;
    nodes.sort((a, b) => {
      const distance = (node) => {
        const x = node.kind === 'point' ? node.point.longitude : node.longitude;
        const y = node.kind === 'point' ? node.point.latitude : node.latitude;
        return (x - centerLongitude) ** 2 + (y - centerLatitude) ** 2;
      };
      return distance(a) - distance(b);
    });
  }
  return { nodes: nodes.slice(0, limit), total, hasSelectedCity, truncated };
}

module.exports = { groupVisiblePoints };
