'use strict';

/**
 * Yandex bounds arrive as two opposite corners. The latitude may be supplied
 * north-to-south, so normalize both axes rather than relying on corner order.
 * @typedef {{code:string, latitude:number, longitude:number, cityCode?:number}} Point
 * @typedef {[[number,number],[number,number]]} Bounds
 */

/**
 * @template {Point} T
 * @param {T[]} points
 * @param {Bounds} bounds
 * @param {number} [limit]
 * @returns {{points:T[], truncated:boolean}|null}
 */
function selectVisiblePoints(points, bounds, limit = 500) {
  if (!Array.isArray(bounds) || bounds.length !== 2 ||
    bounds.some((corner) => !Array.isArray(corner) || corner.length !== 2 ||
      corner.some((value) => typeof value !== 'number' || !Number.isFinite(value))) ||
    !Number.isInteger(limit) || limit < 1 || limit > 500) return null;

  const [a, b] = bounds;
  const west = Math.min(a[0], b[0]);
  const east = Math.max(a[0], b[0]);
  const south = Math.min(a[1], b[1]);
  const north = Math.max(a[1], b[1]);
  if (west < -180 || east > 180 || south < -90 || north > 90 ||
    west === east || south === north) return null;

  const middleX = (west + east) / 2;
  const middleY = (south + north) / 2;
  const found = points.filter((point) =>
    Number.isInteger(point.cityCode) && point.cityCode > 0 &&
    Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
    point.longitude >= west && point.longitude <= east &&
    point.latitude >= south && point.latitude <= north);

  if (found.length > limit) {
    found.sort((a, b) =>
      (a.longitude - middleX) ** 2 + (a.latitude - middleY) ** 2 -
      ((b.longitude - middleX) ** 2 + (b.latitude - middleY) ** 2));
  }
  return { points: found.slice(0, limit), truncated: found.length > limit };
}

module.exports = { selectVisiblePoints };
