/**
 * ComfyUI Output File Watcher Service
 *
 * Monitors ComfyUI output directory for generated files (images/videos)
 * Provides file tracking, thumbnail generation, and workflow association
 *
 * @module services/output
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import sharp from 'sharp';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Output file watcher service with thumbnail generation and tracking
 * @extends EventEmitter
 * @fires OutputWatcher#file:new - New file detected
 * @fires OutputWatcher#file:change - File modified
 * @fires OutputWatcher#file:ready - Watcher initialized
 */
class OutputWatcher extends EventEmitter {
  /**
   * Create an output watcher
   * @param {Object} config - Configuration object
   * @param {string} config.watchDir - Directory to watch
   * @param {Array<string>} config.patterns - File patterns to watch
   * @param {Object} config.thumbnailSize - Thumbnail dimensions
   * @param {number} config.thumbnailSize.width - Thumbnail width
   * @param {number} config.thumbnailSize.height - Thumbnail height
   */
  constructor(config) {
    super();

    this.config = {
      watchDir: config.watchDir || '/home/devuser/ComfyUI/output',
      patterns: config.patterns || ['*.png', '*.jpg', '*.jpeg', '*.mp4', '*.webm', '*.gif'],
      thumbnailSize: config.thumbnailSize || { width: 256, height: 256 }
    };

    this.watcher = null;
    this.files = new Map(); // filename -> file info
    this.thumbnailCache = new Map(); // filepath -> base64 thumbnail
    this.workflowAssociations = new Map(); // workflow_id -> [files]
    this.isWatching = false;

    // Video extensions for type detection
    this.videoExtensions = ['.mp4', '.webm', '.gif'];
    this.imageExtensions = ['.png', '.jpg', '.jpeg'];
  }

  /**
   * Start watching the output directory
   * @returns {Promise<void>}
   * @throws {Error} If directory doesn't exist or watcher already running
   */
  async start() {
    if (this.isWatching) {
      throw new Error('OutputWatcher is already running');
    }

    // Check if directory exists
    if (!existsSync(this.config.watchDir)) {
      throw new Error(`Output directory does not exist: ${this.config.watchDir}`);
    }

    // Initialize chokidar watcher
    this.watcher = chokidar.watch(this.config.patterns.map(p =>
      path.join(this.config.watchDir, p)
    ), {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      },
      depth: 1
    });

    // Set up event handlers
    this.watcher
      .on('add', async (filepath) => {
        await this._handleNewFile(filepath);
      })
      .on('change', async (filepath) => {
        await this._handleFileChange(filepath);
      })
      .on('ready', () => {
        this.isWatching = true;
        this.emit('file:ready', {
          watchDir: this.config.watchDir,
          patterns: this.config.patterns,
          filesTracked: this.files.size
        });
      })
      .on('error', (error) => {
        console.error('OutputWatcher error:', error);
        this.emit('error', error);
      });

    // Scan existing files
    await this._scanExistingFiles();
  }

  /**
   * Stop watching the output directory
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.isWatching = false;
    this.thumbnailCache.clear();
  }

  /**
   * Scan existing files in output directory
   * @private
   * @returns {Promise<void>}
   */
  async _scanExistingFiles() {
    try {
      const entries = await fs.readdir(this.config.watchDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile()) {
          const filepath = path.join(this.config.watchDir, entry.name);
          const ext = path.extname(entry.name).toLowerCase();

          if (this._isWatchedExtension(ext)) {
            await this._processFile(filepath, false);
          }
        }
      }
    } catch (error) {
      console.error('Error scanning existing files:', error);
    }
  }

  /**
   * Check if extension is watched
   * @private
   * @param {string} ext - File extension
   * @returns {boolean}
   */
  _isWatchedExtension(ext) {
    return [...this.videoExtensions, ...this.imageExtensions].includes(ext);
  }

  /**
   * Handle new file detection
   * @private
   * @param {string} filepath - Path to new file
   * @returns {Promise<void>}
   */
  async _handleNewFile(filepath) {
    await this._processFile(filepath, true);
  }

  /**
   * Handle file change
   * @private
   * @param {string} filepath - Path to changed file
   * @returns {Promise<void>}
   */
  async _handleFileChange(filepath) {
    const fileInfo = await this._getFileInfo(filepath);

    if (fileInfo) {
      this.files.set(fileInfo.filename, fileInfo);
      this.emit('file:change', fileInfo);
    }
  }

  /**
   * Process a file (new or existing)
   * @private
   * @param {string} filepath - Path to file
   * @param {boolean} isNew - Whether this is a new file
   * @returns {Promise<void>}
   */
  async _processFile(filepath, isNew) {
    try {
      const fileInfo = await this._getFileInfo(filepath);

      if (fileInfo) {
        this.files.set(fileInfo.filename, fileInfo);

        // Extract workflow association from filename
        const workflowId = this._extractWorkflowId(fileInfo.filename);
        if (workflowId) {
          this._associateFileWithWorkflow(workflowId, fileInfo);
        }

        if (isNew) {
          this.emit('file:new', fileInfo);
        }
      }
    } catch (error) {
      console.error(`Error processing file ${filepath}:`, error);
    }
  }

  /**
   * Get recent files
   * @param {number} limit - Maximum number of files to return
   * @returns {Array<Object>} Array of file info objects
   */
  getRecentFiles(limit = 10) {
    const files = Array.from(this.files.values());

    // Sort by created time (newest first)
    files.sort((a, b) => b.created.getTime() - a.created.getTime());

    return files.slice(0, limit);
  }

  /**
   * Get files created since a timestamp
   * @param {Date|number} timestamp - Timestamp to filter from
   * @returns {Array<Object>} Array of file info objects
   */
  getFilesSince(timestamp) {
    const compareTime = timestamp instanceof Date ? timestamp.getTime() : timestamp;

    return Array.from(this.files.values())
      .filter(file => file.created.getTime() >= compareTime)
      .sort((a, b) => b.created.getTime() - a.created.getTime());
  }

  /**
   * Get detailed file information
   * @param {string} filename - Name of the file
   * @returns {Object|null} File info or null if not found
   */
  getFileInfo(filename) {
    return this.files.get(filename) || null;
  }

  /**
   * Get files associated with a workflow
   * @param {string} workflowId - Workflow ID
   * @returns {Array<Object>} Array of file info objects
   */
  getWorkflowFiles(workflowId) {
    return this.workflowAssociations.get(workflowId) || [];
  }

  /**
   * Get detailed file information from filesystem
   * @private
   * @param {string} filepath - Path to file
   * @returns {Promise<Object|null>} File info object or null
   */
  async _getFileInfo(filepath) {
    try {
      const stats = await fs.stat(filepath);
      const filename = path.basename(filepath);
      const ext = path.extname(filename).toLowerCase();

      const fileInfo = {
        path: filepath,
        filename: filename,
        type: this.videoExtensions.includes(ext) ? 'video' : 'image',
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        thumbnailBase64: null,
        dimensions: null,
        duration: null
      };

      // Generate thumbnail
      fileInfo.thumbnailBase64 = await this.generateThumbnail(filepath);

      // Get dimensions/duration
      if (fileInfo.type === 'image') {
        fileInfo.dimensions = await this._getImageDimensions(filepath);
      } else {
        const videoInfo = await this._getVideoInfo(filepath);
        fileInfo.dimensions = videoInfo.dimensions;
        fileInfo.duration = videoInfo.duration;
      }

      return fileInfo;
    } catch (error) {
      console.error(`Error getting file info for ${filepath}:`, error);
      return null;
    }
  }

  /**
   * Generate thumbnail for an image or video
   * @param {string} filepath - Path to file
   * @returns {Promise<string|null>} Base64-encoded thumbnail or null
   */
  async generateThumbnail(filepath) {
    // Check cache first
    if (this.thumbnailCache.has(filepath)) {
      return this.thumbnailCache.get(filepath);
    }

    try {
      const ext = path.extname(filepath).toLowerCase();
      let thumbnail;

      if (this.imageExtensions.includes(ext)) {
        thumbnail = await this._generateImageThumbnail(filepath);
      } else if (this.videoExtensions.includes(ext)) {
        thumbnail = await this._generateVideoThumbnail(filepath);
      } else {
        return null;
      }

      // Cache the thumbnail
      this.thumbnailCache.set(filepath, thumbnail);

      return thumbnail;
    } catch (error) {
      console.error(`Error generating thumbnail for ${filepath}:`, error);
      return null;
    }
  }

  /**
   * Generate thumbnail for an image using sharp
   * @private
   * @param {string} filepath - Path to image
   * @returns {Promise<string>} Base64-encoded thumbnail
   */
  async _generateImageThumbnail(filepath) {
    const buffer = await sharp(filepath)
      .resize(this.config.thumbnailSize.width, this.config.thumbnailSize.height, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .png()
      .toBuffer();

    return `data:image/png;base64,${buffer.toString('base64')}`;
  }

  /**
   * Generate thumbnail for a video using ffmpeg (first frame)
   * @private
   * @param {string} filepath - Path to video
   * @returns {Promise<string>} Base64-encoded thumbnail
   */
  async _generateVideoThumbnail(filepath) {
    const tempFile = `/tmp/thumb_${Date.now()}.png`;

    try {
      // Extract first frame using ffmpeg
      await execAsync(
        `ffmpeg -i "${filepath}" -vframes 1 -vf scale=${this.config.thumbnailSize.width}:${this.config.thumbnailSize.height}:force_original_aspect_ratio=decrease -y "${tempFile}"`
      );

      // Read and encode
      const buffer = await fs.readFile(tempFile);
      const base64 = `data:image/png;base64,${buffer.toString('base64')}`;

      // Cleanup
      await fs.unlink(tempFile).catch(() => {});

      return base64;
    } catch (error) {
      // Cleanup on error
      await fs.unlink(tempFile).catch(() => {});
      throw error;
    }
  }

  /**
   * Get image dimensions using sharp
   * @private
   * @param {string} filepath - Path to image
   * @returns {Promise<Object>} Dimensions {width, height}
   */
  async _getImageDimensions(filepath) {
    try {
      const metadata = await sharp(filepath).metadata();
      return {
        width: metadata.width,
        height: metadata.height
      };
    } catch (error) {
      console.error(`Error getting image dimensions for ${filepath}:`, error);
      return null;
    }
  }

  /**
   * Get video information using ffprobe
   * @private
   * @param {string} filepath - Path to video
   * @returns {Promise<Object>} Video info {dimensions, duration}
   */
  async _getVideoInfo(filepath) {
    try {
      const { stdout } = await execAsync(
        `ffprobe -v quiet -print_format json -show_format -show_streams "${filepath}"`
      );

      const info = JSON.parse(stdout);
      const videoStream = info.streams.find(s => s.codec_type === 'video');

      return {
        dimensions: videoStream ? {
          width: videoStream.width,
          height: videoStream.height
        } : null,
        duration: info.format.duration ? parseFloat(info.format.duration) : null
      };
    } catch (error) {
      console.error(`Error getting video info for ${filepath}:`, error);
      return { dimensions: null, duration: null };
    }
  }

  /**
   * Extract workflow ID from ComfyUI filename
   * ComfyUI typically uses format: <workflow_name>_<timestamp>_<id>.ext
   * @private
   * @param {string} filename - Filename to parse
   * @returns {string|null} Workflow ID or null
   */
  _extractWorkflowId(filename) {
    // Try to extract workflow ID from common ComfyUI patterns
    // Format 1: workflow_name_timestamp_id.ext
    const match = filename.match(/^(.+?)_\d+_([a-f0-9]+)\./i);
    if (match) {
      return match[2]; // Return the ID portion
    }

    // Format 2: ComfyUI_timestamp_id.ext
    const match2 = filename.match(/^ComfyUI_\d+_([a-f0-9]+)\./i);
    if (match2) {
      return match2[1];
    }

    return null;
  }

  /**
   * Associate a file with a workflow
   * @private
   * @param {string} workflowId - Workflow ID
   * @param {Object} fileInfo - File information object
   */
  _associateFileWithWorkflow(workflowId, fileInfo) {
    if (!this.workflowAssociations.has(workflowId)) {
      this.workflowAssociations.set(workflowId, []);
    }

    const files = this.workflowAssociations.get(workflowId);

    // Check if file already associated
    const existingIndex = files.findIndex(f => f.filename === fileInfo.filename);

    if (existingIndex >= 0) {
      files[existingIndex] = fileInfo; // Update
    } else {
      files.push(fileInfo); // Add new
    }
  }

  /**
   * Get current watcher status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      isWatching: this.isWatching,
      watchDir: this.config.watchDir,
      patterns: this.config.patterns,
      filesTracked: this.files.size,
      workflowsTracked: this.workflowAssociations.size,
      cacheSize: this.thumbnailCache.size
    };
  }

  /**
   * Clear thumbnail cache
   */
  clearThumbnailCache() {
    this.thumbnailCache.clear();
  }

  /**
   * Clear all tracking data (but keep watching)
   */
  clearTracking() {
    this.files.clear();
    this.workflowAssociations.clear();
    this.thumbnailCache.clear();
  }
}

export default OutputWatcher;
