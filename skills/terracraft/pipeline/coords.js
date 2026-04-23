'use strict';

/**
 * Approximate WGS84 (lat/lng) to British National Grid (easting/northing).
 * Accuracy ~5m, sufficient for DEM grid sampling.
 */
function wgs84ToBng(lat, lng) {
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;

  const a = 6377563.396;
  const b = 6356256.909;
  const e2 = (a * a - b * b) / (a * a);
  const n = (a - b) / (a + b);
  const n2 = n * n;
  const n3 = n * n * n;

  const lat0 = (49.0 * Math.PI) / 180;
  const lng0 = (-2.0 * Math.PI) / 180;
  const f0 = 0.9996012717;
  const e0 = 400000.0;
  const n0 = -100000.0;

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const tanLat = Math.tan(latRad);
  const tan2 = tanLat * tanLat;

  const nu = (a * f0) / Math.sqrt(1.0 - e2 * sinLat * sinLat);
  const rho = (a * f0 * (1.0 - e2)) / Math.pow(1.0 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1.0;

  const dlat = latRad - lat0;
  const slat = latRad + lat0;

  const ma = (1.0 + n + 1.25 * n2 + 1.25 * n3) * dlat;
  const mb = (3.0 * n + 3.0 * n2 + (21.0 / 8.0) * n3) * Math.sin(dlat) * Math.cos(slat);
  const mc = ((15.0 / 8.0) * n2 + (15.0 / 8.0) * n3) * Math.sin(2.0 * dlat) * Math.cos(2.0 * slat);
  const md = ((35.0 / 24.0) * n3) * Math.sin(3.0 * dlat) * Math.cos(3.0 * slat);
  const mVal = b * f0 * (ma - mb + mc - md);

  const dLng = lngRad - lng0;
  const dLng2 = dLng * dLng;

  const iVal = mVal + n0;
  const ii = (nu / 2.0) * sinLat * cosLat;
  const iii = (nu / 24.0) * sinLat * Math.pow(cosLat, 3) * (5.0 - tan2 + 9.0 * eta2);
  const iiia = (nu / 720.0) * sinLat * Math.pow(cosLat, 5) * (61.0 - 58.0 * tan2 + tan2 * tan2);

  const iv = nu * cosLat;
  const v = (nu / 6.0) * Math.pow(cosLat, 3) * (nu / rho - tan2);
  const vi = (nu / 120.0) * Math.pow(cosLat, 5) * (5.0 - 18.0 * tan2 + tan2 * tan2 + 14.0 * eta2 - 58.0 * tan2 * eta2);

  const northing = iVal + ii * dLng2 + iii * dLng2 * dLng2 + iiia * dLng2 * dLng2 * dLng2;
  const easting = e0 + iv * dLng + v * dLng * dLng2 + vi * dLng * dLng2 * dLng2;

  return { easting, northing };
}

/**
 * Calculate area of a bounding box in square kilometres.
 */
function bboxAreaKm2(minLat, minLng, maxLat, maxLng) {
  const R = 6371;
  const dLat = ((maxLat - minLat) * Math.PI) / 180;
  const dLng = ((maxLng - minLng) * Math.PI) / 180;
  const midLat = (((minLat + maxLat) / 2) * Math.PI) / 180;
  const heightKm = dLat * R;
  const widthKm = dLng * R * Math.cos(midLat);
  return heightKm * widthKm;
}

/**
 * Estimate block count from bbox and scale.
 */
function estimateBlocks(minLat, minLng, maxLat, maxLng, scale) {
  const areaKm2 = bboxAreaKm2(minLat, minLng, maxLat, maxLng);
  const areaM2 = areaKm2 * 1e6;
  return Math.round(areaM2 * scale * scale);
}

/**
 * Reverse geocode using Nominatim to get region context for LLM enrichment.
 */
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=8&addressdetails=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'TerraCraft/1.0 (minecraft world generator)' },
    });
    if (!resp.ok) return 'Unknown region';
    const data = await resp.json();
    const addr = data.address || {};
    const parts = [addr.city || addr.town || addr.village, addr.state || addr.county, addr.country].filter(Boolean);
    return parts.join(', ') || 'Unknown region';
  } catch {
    return 'Unknown region';
  }
}

module.exports = { wgs84ToBng, bboxAreaKm2, estimateBlocks, reverseGeocode };
