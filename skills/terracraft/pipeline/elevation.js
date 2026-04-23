'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Download elevation data if needed.
 * By default, arnis handles AWS Terrarium tiles internally when --terrain is set.
 * This module only acts when GEE credentials are provided for LIDAR data.
 *
 * Returns the path to a GeoTIFF file, or null to let arnis use its default.
 */
async function fetchElevation(bbox, outputDir, options = {}, onProgress) {
  const { geeProject, geeCredentials } = options;

  // If no GEE credentials, let arnis handle elevation via AWS Terrarium
  if (!geeProject || !geeCredentials) {
    if (onProgress) onProgress('Using default AWS Terrarium elevation (handled by arnis)');
    return null;
  }

  // GEE LIDAR path - requires Python + earthengine-api
  // This is an advanced feature for users who configure GEE credentials
  if (onProgress) onProgress('GEE LIDAR elevation requested but not yet configured. Using AWS Terrarium.');
  return null;
}

module.exports = { fetchElevation };
