'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ARNIS_BIN = process.env.ARNIS_BIN || '/usr/local/bin/arnis';

/**
 * Run the patched arnis binary to generate a Minecraft world.
 *
 * @param {Object} options
 * @param {string} options.osmFile - Path to OSM JSON data file
 * @param {number[]} options.bbox - [minLat, minLng, maxLat, maxLng]
 * @param {number} options.scale - World scale (blocks per meter)
 * @param {number} options.groundLevel - Minecraft Y ground level
 * @param {string} options.outputDir - Directory to create the world in
 * @param {string|null} options.elevationFile - Optional GeoTIFF elevation file
 * @param {number|null} options.spawnLat - Optional spawn latitude
 * @param {number|null} options.spawnLng - Optional spawn longitude
 * @param {function} options.onProgress - Progress callback
 * @returns {Promise<{worldDir: string}>}
 */
async function runArnis(options) {
  const { osmFile, bbox, scale, groundLevel, outputDir, elevationFile, spawnLat, spawnLng, onProgress } = options;

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  const bboxStr = `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`;

  const args = [
    '--bbox', bboxStr,
    '--file', osmFile,
    '--output-dir', outputDir,
    '--scale', String(scale),
    '--ground-level', String(groundLevel),
    '--terrain',
    '--fillground',
    '--city-boundaries=false',
  ];

  if (elevationFile) {
    args.push('--elevation-file', elevationFile);
  }

  if (spawnLat != null && spawnLng != null) {
    args.push('--spawn-lat', String(spawnLat));
    args.push('--spawn-lng', String(spawnLng));
  }

  if (onProgress) onProgress(`Running arnis: ${ARNIS_BIN} ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    const proc = spawn(ARNIS_BIN, args, {
      cwd: outputDir,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      // Parse arnis progress output
      const lines = text.split('\n').filter(Boolean);
      for (const line of lines) {
        if (onProgress) onProgress(line.trim());
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start arnis: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`arnis exited with code ${code}:\n${stderr || stdout}`));
        return;
      }

      // Find the generated world directory (arnis creates a timestamped folder)
      const entries = fs.readdirSync(outputDir, { withFileTypes: true });
      const worldDirs = entries
        .filter((e) => e.isDirectory() && e.name !== '.' && e.name !== '..')
        .map((e) => ({
          name: e.name,
          mtime: fs.statSync(path.join(outputDir, e.name)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (worldDirs.length === 0) {
        reject(new Error('arnis completed but no world directory was found'));
        return;
      }

      const worldDir = path.join(outputDir, worldDirs[0].name);
      if (onProgress) onProgress(`World generated at: ${worldDir}`);
      resolve({ worldDir });
    });
  });
}

module.exports = { runArnis };
