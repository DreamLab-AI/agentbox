/**
 * Output Management Tools
 * Handles listing and retrieving generated outputs
 */

const fs = require('fs').promises;
const path = require('path');

module.exports = function(server, services) {
  const { comfyui, logger, config } = services;

  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Output List
      if (name === 'output_list') {
        const { type = 'all', limit = 20, offset = 0 } = args;

        logger.info('Listing outputs', { type, limit, offset });

        const outputDir = config.comfyui.outputDir || '/home/devuser/ComfyUI/output';

        try {
          const files = await fs.readdir(outputDir);

          // Filter by type
          let filteredFiles = files;
          if (type !== 'all') {
            const extensions = {
              image: ['.png', '.jpg', '.jpeg', '.webp'],
              video: ['.mp4', '.webm', '.avi', '.gif'],
              audio: ['.mp3', '.wav', '.ogg']
            };

            const validExtensions = extensions[type] || [];
            filteredFiles = files.filter(file => {
              const ext = path.extname(file).toLowerCase();
              return validExtensions.includes(ext);
            });
          }

          // Sort by modification time (newest first)
          const filesWithStats = await Promise.all(
            filteredFiles.map(async (file) => {
              const filePath = path.join(outputDir, file);
              const stats = await fs.stat(filePath);
              return {
                name: file,
                path: filePath,
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime,
                extension: path.extname(file)
              };
            })
          );

          filesWithStats.sort((a, b) => b.modified - a.modified);

          // Apply pagination
          const paginatedFiles = filesWithStats.slice(offset, offset + limit);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                total: filesWithStats.length,
                limit,
                offset,
                type,
                outputs: paginatedFiles.map(file => ({
                  name: file.name,
                  path: file.path,
                  size: file.size,
                  extension: file.extension,
                  created: file.created.toISOString(),
                  modified: file.modified.toISOString()
                }))
              }, null, 2)
            }]
          };
        } catch (dirError) {
          throw new Error(`Failed to read output directory: ${dirError.message}`);
        }
      }

      // Output Get
      if (name === 'output_get') {
        const { filename, format = 'path' } = args;

        if (!filename) {
          throw new Error('filename is required');
        }

        logger.info('Getting output', { filename, format });

        const outputDir = config.comfyui.outputDir || '/home/devuser/ComfyUI/output';
        const filePath = path.join(outputDir, filename);

        try {
          // Check if file exists
          const stats = await fs.stat(filePath);

          if (format === 'base64') {
            // Read file and encode as base64
            const fileBuffer = await fs.readFile(filePath);
            const base64Data = fileBuffer.toString('base64');

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  filename,
                  size: stats.size,
                  format: 'base64',
                  data: base64Data,
                  mime_type: getMimeType(filename)
                }, null, 2)
              }]
            };
          } else {
            // Return path information
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  filename,
                  path: filePath,
                  size: stats.size,
                  created: stats.birthtime.toISOString(),
                  modified: stats.mtime.toISOString(),
                  mime_type: getMimeType(filename)
                }, null, 2)
              }]
            };
          }
        } catch (fileError) {
          if (fileError.code === 'ENOENT') {
            throw new Error(`Output file not found: ${filename}`);
          }
          throw new Error(`Failed to get output: ${fileError.message}`);
        }
      }

    } catch (error) {
      logger.error('Output tool error', { name, error: error.message });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message,
            tool: name
          }, null, 2)
        }],
        isError: true
      };
    }
  });
};

/**
 * Get MIME type from filename extension
 */
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}
