'use strict';

const fs = require('fs');
const path = require('path');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

/**
 * Build the Overpass QL query for a bounding box.
 * Fetches buildings, highways, waterways, landuse, natural features, amenities, leisure.
 */
function buildQuery(minLat, minLng, maxLat, maxLng) {
  const bbox = `${minLat},${minLng},${maxLat},${maxLng}`;
  return `
[out:json][timeout:120][bbox:${bbox}];
(
  way["building"];
  relation["building"];
  way["highway"];
  way["waterway"];
  way["natural"="water"];
  relation["natural"="water"];
  way["landuse"];
  relation["landuse"];
  way["natural"];
  way["leisure"];
  way["amenity"];
  way["barrier"];
  way["railway"];
  node["natural"="tree"];
);
out body;
>;
out skel qt;
`.trim();
}

/**
 * Fetch OSM data from Overpass API with retry logic.
 * Returns the path to the saved JSON file.
 */
async function fetchOsmData(minLat, minLng, maxLat, maxLng, outputDir, onProgress) {
  const query = buildQuery(minLat, minLng, maxLat, maxLng);
  const outputFile = path.join(outputDir, 'osm_data.json');

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (onProgress) onProgress(`Fetching OSM data (attempt ${attempt}/${MAX_RETRIES})...`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180000);

      const resp = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (resp.status === 429 || resp.status === 504) {
        const delay = RETRY_DELAY_MS * attempt;
        if (onProgress) onProgress(`Overpass API rate limited, retrying in ${delay / 1000}s...`);
        await sleep(delay);
        continue;
      }

      if (!resp.ok) {
        throw new Error(`Overpass API returned ${resp.status}: ${resp.statusText}`);
      }

      const data = await resp.text();
      fs.writeFileSync(outputFile, data, 'utf-8');

      const parsed = JSON.parse(data);
      const elementCount = parsed.elements ? parsed.elements.length : 0;
      if (onProgress) onProgress(`Downloaded ${elementCount} OSM elements`);

      return { file: outputFile, elementCount };
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`Failed to fetch OSM data after ${MAX_RETRIES} attempts: ${err.message}`);
      }
      const delay = RETRY_DELAY_MS * attempt;
      if (onProgress) onProgress(`OSM fetch failed: ${err.message}. Retrying in ${delay / 1000}s...`);
      await sleep(delay);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { fetchOsmData };
