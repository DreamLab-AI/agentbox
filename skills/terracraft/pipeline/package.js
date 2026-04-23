'use strict';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

/**
 * Package a Minecraft world directory into a downloadable zip file.
 *
 * @param {string} worldDir - Path to the generated world directory
 * @param {string} outputFile - Path to the output zip file
 * @param {function} onProgress - Progress callback
 * @returns {Promise<{zipFile: string, sizeBytes: number}>}
 */
async function packageWorld(worldDir, outputFile, onProgress) {
  if (onProgress) onProgress('Packaging world into zip...');

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputFile);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => {
      const sizeBytes = archive.pointer();
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);
      if (onProgress) onProgress(`World packaged: ${sizeMB} MB`);
      resolve({ zipFile: outputFile, sizeBytes });
    });

    archive.on('error', (err) => {
      reject(new Error(`Failed to create zip: ${err.message}`));
    });

    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') {
        reject(err);
      }
    });

    archive.pipe(output);

    // Get the world directory name to use as the root folder in the zip
    const worldName = path.basename(worldDir);
    archive.directory(worldDir, worldName);
    archive.finalize();
  });
}

/**
 * Clean up temporary files from a job directory.
 */
function cleanupTempFiles(jobDir) {
  const tempFiles = ['osm_data.json'];
  for (const f of tempFiles) {
    const fp = path.join(jobDir, f);
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      // ignore cleanup errors
    }
  }
}

module.exports = { packageWorld, cleanupTempFiles };
