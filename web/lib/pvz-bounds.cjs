'use strict';

/**
 * Small, testable bounding-box filter. It never reveals all of the CDEK
 * directory to a browser; only the points inside the current map viewport.
 * @typedef {{code:string, latitude:number, longitude:number, cityCode?:number}} Point
 * @typedef {[[number,number],[number,number]]} Bounds
 */

/** @param {Point[]} points @param {Bounds} bounds @param {number} [limit] */
function selectVisiblePoints(points, bounds, limit = 1800) {
  if (!Array.isArray(bounds) || bounds.length !== 2 ||
      bounds.some((corner) => !Array.isArray(corner) || corner.length !== 2 ||
        corner.some((v) => typeof v !== 'number' || !Number.isFinite(v)))) return null;
  const [[west, south], [east, north]] = bounds;
  if (west < -180 || east > 180 || south < -90 || north > 90 ||
      west >= east || south >= north || !Number.isInteger(limit) || limit < 1 || limit > 1800) return null;

  const centerLon = (west + east) / 2;
  const centerLat = (south + north) / 2;
  const inside = points.filter((point) => Number.isInteger(point.cityCode) && (point.cityCode ?? 0) > 0 &&
    Number.isFinite(point.longitude) && Number.isFinite(point.latitude) &&
    point.longitude >= west && point.longitude <= east &&
    point.latitude >= south && point.latitude <= north);
  if (inside.length > limit) {
    inside.sort((a, b) =>
      (a.longitude - centerLon) ** 2 + (a.latitude - centerLat) ** 2 -
      ((b.longitude - centerLon) ** 2 + (b.latitude - centerLat) ** 2));
  }
  return { points: inside.slice(0, limit), truncated: inside.length > limit };
}

module.exports = { selectVisiblePoints };
