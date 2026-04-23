#!/usr/bin/env node
/**
 * Screenshot Tool for Host Webserver Debug Skill
 * Takes screenshots of web applications via HTTPS bridge
 */

const path = require('path');

async function takeScreenshot(options = {}) {
  const {
    url = 'https://localhost:3001',
    outputDir = process.env.SCREENSHOT_DIR || '/tmp/screenshots',
    filename = null,
    fullPage = true,
    viewport = { width: 1920, height: 1080 },
    waitUntil = 'networkidle',
    timeout = 30000
  } = options;

  // Try to load playwright from various locations
  let chromium;
  try {
    // Try global playwright first
    chromium = require('/usr/local/lib/node_modules/@playwright/mcp/node_modules/playwright').chromium;
  } catch {
    try {
      // Fall back to local playwright
      chromium = require('playwright').chromium;
    } catch {
      throw new Error('Playwright not found. Install with: npm install -g playwright');
    }
  }
  const fs = require('fs');

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`Taking screenshot of ${url}...`);

  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--ignore-certificate-errors',
      '--disable-web-security',
      '--disable-gpu'
    ]
  });

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport
    });

    const page = await context.newPage();

    await page.goto(url, {
      waitUntil,
      timeout
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFilename = filename || `screenshot-${timestamp}.png`;
    const outputPath = path.join(outputDir, outputFilename);

    await page.screenshot({
      path: outputPath,
      fullPage
    });

    const title = await page.title();
    const pageUrl = page.url();

    console.log(`Screenshot saved: ${outputPath}`);
    console.log(`Page title: ${title}`);

    return {
      success: true,
      path: outputPath,
      title,
      url: pageUrl,
      viewport,
      fullPage,
      timestamp: new Date().toISOString()
    };
  } finally {
    await browser.close();
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const url = args[0] || 'https://localhost:3001';
  const outputDir = args[1] || '/tmp/screenshots';

  takeScreenshot({ url, outputDir })
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = { takeScreenshot };
