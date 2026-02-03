/**
 * Playwright Display Capture Service
 * Captures ComfyUI interface on virtual display :1 for visual feedback to Claude
 */

const { chromium } = require('playwright');
const EventEmitter = require('events');

class DisplayCaptureService extends EventEmitter {
  constructor() {
    super();
    this.browser = null;
    this.page = null;
    this.isInitialized = false;
    this.comfyUrl = process.env.COMFYUI_URL || 'http://localhost:8188';
    this.display = process.env.DISPLAY || ':1';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // Start with 1 second
  }

  /**
   * Initialize browser and navigate to ComfyUI
   */
  async init() {
    try {
      if (this.isInitialized) {
        console.log('Display capture already initialized');
        return;
      }

      console.log(`Launching Chromium on display ${this.display}`);

      // Launch browser with display environment
      this.browser = await chromium.launch({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          `--display=${this.display}`
        ],
        env: {
          ...process.env,
          DISPLAY: this.display
        }
      });

      // Create new page with viewport
      this.page = await this.browser.newPage({
        viewport: {
          width: 1920,
          height: 1080
        }
      });

      // Set up page error handlers
      this.page.on('crash', () => this.handlePageCrash());
      this.page.on('close', () => this.handlePageClose());

      // Navigate to ComfyUI
      console.log(`Navigating to ComfyUI at ${this.comfyUrl}`);
      await this.page.goto(this.comfyUrl, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      this.isInitialized = true;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;

      this.emit('initialized');
      console.log('Display capture service initialized');

      // Start health check
      this.startHealthCheck();
    } catch (error) {
      console.error('Failed to initialize display capture:', error);
      await this.handleInitError(error);
      throw error;
    }
  }

  /**
   * Clean shutdown of browser
   */
  async close() {
    try {
      this.stopHealthCheck();

      if (this.page && !this.page.isClosed()) {
        await this.page.close().catch(err =>
          console.error('Error closing page:', err)
        );
      }

      if (this.browser) {
        await this.browser.close().catch(err =>
          console.error('Error closing browser:', err)
        );
      }

      this.isInitialized = false;
      this.page = null;
      this.browser = null;

      this.emit('closed');
      console.log('Display capture service closed');
    } catch (error) {
      console.error('Error during shutdown:', error);
      throw error;
    }
  }

  /**
   * Capture screenshot with options
   * @param {Object} options - Screenshot options
   * @param {boolean} options.fullPage - Capture full page (default: true)
   * @param {string} options.selector - CSS selector for specific element
   * @param {string} options.format - 'png' or 'jpeg' (default: 'png')
   * @param {number} options.quality - JPEG quality 0-100 (default: 90)
   * @returns {Promise<Object>} Screenshot data
   */
  async captureScreenshot(options = {}) {
    await this.ensureInitialized();

    try {
      const {
        fullPage = true,
        selector = null,
        format = 'png',
        quality = 90
      } = options;

      const screenshotOptions = {
        type: format,
        fullPage: selector ? false : fullPage
      };

      if (format === 'jpeg') {
        screenshotOptions.quality = quality;
      }

      let screenshot;
      if (selector) {
        const element = await this.page.$(selector);
        if (!element) {
          throw new Error(`Element not found: ${selector}`);
        }
        screenshot = await element.screenshot(screenshotOptions);
      } else {
        screenshot = await this.page.screenshot(screenshotOptions);
      }

      const base64 = screenshot.toString('base64');
      const viewport = this.page.viewportSize();

      const result = {
        base64,
        format,
        width: viewport.width,
        height: viewport.height,
        timestamp: new Date(),
        url: this.page.url()
      };

      this.emit('screenshot', result);
      return result;
    } catch (error) {
      console.error('Screenshot capture failed:', error);
      throw error;
    }
  }

  /**
   * Capture specific element
   * @param {string} selector - CSS selector
   * @param {Object} options - Screenshot options
   * @returns {Promise<Object>} Screenshot data
   */
  async captureElement(selector, options = {}) {
    return this.captureScreenshot({
      ...options,
      selector,
      fullPage: false
    });
  }

  /**
   * Interact with page elements
   * @param {string} action - 'click', 'type', 'select', 'hover'
   * @param {string} selector - CSS selector
   * @param {*} value - Value for type/select actions
   */
  async interact(action, selector, value = null) {
    await this.ensureInitialized();

    try {
      await this.waitForSelector(selector, 5000);

      switch (action) {
        case 'click':
          await this.page.click(selector);
          break;
        case 'type':
          await this.page.type(selector, String(value));
          break;
        case 'select':
          await this.page.selectOption(selector, value);
          break;
        case 'hover':
          await this.page.hover(selector);
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      this.emit('interaction', { action, selector, value });
    } catch (error) {
      console.error(`Interaction failed (${action} on ${selector}):`, error);
      throw error;
    }
  }

  /**
   * Wait for selector to appear
   * @param {string} selector - CSS selector
   * @param {number} timeout - Timeout in milliseconds (default: 30000)
   */
  async waitForSelector(selector, timeout = 30000) {
    await this.ensureInitialized();

    try {
      await this.page.waitForSelector(selector, {
        timeout,
        state: 'visible'
      });
    } catch (error) {
      console.error(`Selector not found: ${selector}`, error);
      throw error;
    }
  }

  /**
   * Parse progress information from ComfyUI DOM
   * @returns {Promise<Object>} Progress data
   */
  async getProgressFromUI() {
    await this.ensureInitialized();

    try {
      const progress = await this.page.evaluate(() => {
        // ComfyUI progress bar selectors (adjust based on actual UI)
        const progressBar = document.querySelector('.progress-bar, [role="progressbar"]');
        const progressText = document.querySelector('.progress-text, .status-text');
        const queueInfo = document.querySelector('.queue-info, .queue-size');

        return {
          percentage: progressBar ?
            parseFloat(progressBar.getAttribute('aria-valuenow') || progressBar.style.width || '0') : 0,
          text: progressText ? progressText.textContent.trim() : '',
          queueSize: queueInfo ? parseInt(queueInfo.textContent) || 0 : 0,
          isRunning: !!document.querySelector('.running, .processing')
        };
      });

      this.emit('progress', progress);
      return progress;
    } catch (error) {
      console.error('Failed to get progress from UI:', error);
      return {
        percentage: 0,
        text: '',
        queueSize: 0,
        isRunning: false,
        error: error.message
      };
    }
  }

  /**
   * Click queue prompt button in ComfyUI
   * @returns {Promise<boolean>} Success status
   */
  async queuePromptFromUI() {
    await this.ensureInitialized();

    try {
      // Common ComfyUI queue button selectors
      const queueSelectors = [
        '#queue-button',
        'button[title="Queue Prompt"]',
        'button:has-text("Queue Prompt")',
        '.queue-prompt-button'
      ];

      for (const selector of queueSelectors) {
        const button = await this.page.$(selector);
        if (button) {
          await button.click();
          this.emit('queuePrompt');
          return true;
        }
      }

      throw new Error('Queue button not found');
    } catch (error) {
      console.error('Failed to queue prompt from UI:', error);
      throw error;
    }
  }

  /**
   * Handle page crash
   */
  async handlePageCrash() {
    console.error('Page crashed, attempting recovery...');
    this.isInitialized = false;
    this.emit('crash');
    await this.reconnectWithBackoff();
  }

  /**
   * Handle page close
   */
  async handlePageClose() {
    if (this.isInitialized) {
      console.warn('Page closed unexpectedly');
      this.isInitialized = false;
      this.emit('pageClose');
    }
  }

  /**
   * Handle initialization error
   */
  async handleInitError(error) {
    console.error('Initialization error, attempting recovery:', error);
    await this.reconnectWithBackoff();
  }

  /**
   * Reconnect with exponential backoff
   */
  async reconnectWithBackoff() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      this.emit('maxReconnectFailed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.close();
      await this.init();
      console.log('Reconnection successful');
      this.emit('reconnected');
    } catch (error) {
      console.error('Reconnection failed:', error);
      await this.reconnectWithBackoff();
    }
  }

  /**
   * Ensure service is initialized
   */
  async ensureInitialized() {
    if (!this.isInitialized || !this.page || this.page.isClosed()) {
      throw new Error('Display capture service not initialized or page closed');
    }
  }

  /**
   * Start health check interval
   */
  startHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
      try {
        if (this.isInitialized && this.page && !this.page.isClosed()) {
          // Simple health check - evaluate basic expression
          await this.page.evaluate(() => true);
        } else if (this.isInitialized) {
          console.warn('Health check failed - page closed');
          await this.handlePageClose();
        }
      } catch (error) {
        console.error('Health check error:', error);
        if (this.isInitialized) {
          await this.handlePageCrash();
        }
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop health check
   */
  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get current status
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      display: this.display,
      comfyUrl: this.comfyUrl,
      reconnectAttempts: this.reconnectAttempts,
      pageUrl: this.page && !this.page.isClosed() ? this.page.url() : null,
      browserConnected: this.browser && this.browser.isConnected()
    };
  }
}

// Export singleton instance
const displayCapture = new DisplayCaptureService();

module.exports = displayCapture;
module.exports.DisplayCaptureService = DisplayCaptureService;
