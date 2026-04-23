const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Collect console messages
  const consoleLogs = [];
  page.on('console', msg => {
    const type = msg.type();
    if (type === 'error' || type === 'warning' || msg.text().includes('edge') || msg.text().includes('Edge')) {
      consoleLogs.push({ type, text: msg.text().substring(0, 300) });
    }
  });

  console.log('Navigating to VisionFlow...');
  await page.goto('http://192.168.0.51:3001', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait longer for WebSocket connection and data
  console.log('Waiting for graph to load...');
  await page.waitForTimeout(10000);

  // Check page state
  const pageInfo = await page.evaluate(() => {
    // Look for any visible nodes or edges
    const canvas = document.querySelector('canvas');

    // Try to get Three.js scene info via window
    let sceneInfo = 'not found';
    if (window.__THREE_DEVTOOLS__) {
      sceneInfo = 'THREE DevTools detected';
    }

    // Check localStorage/sessionStorage for settings
    let storedSettings = null;
    try {
      const stored = localStorage.getItem('visionflow-settings') || localStorage.getItem('settings');
      if (stored) {
        const parsed = JSON.parse(stored);
        storedSettings = {
          edgeOpacity: parsed?.visualisation?.graphs?.logseq?.edges?.opacity,
          nodeOpacity: parsed?.visualisation?.graphs?.logseq?.nodes?.opacity
        };
      }
    } catch(e) {}

    return {
      hasCanvas: canvas !== null,
      canvasSize: canvas ? { w: canvas.width, h: canvas.height } : null,
      sceneInfo,
      storedSettings,
      url: window.location.href
    };
  });

  console.log('Page info:', JSON.stringify(pageInfo, null, 2));
  console.log('\nConsole messages (' + consoleLogs.length + '):');
  consoleLogs.slice(0, 10).forEach(l => console.log('  [' + l.type + ']', l.text.substring(0, 150)));

  // Try clicking on the canvas to focus it
  console.log('\nClicking canvas to activate...');
  const canvas = await page.locator('canvas').first();
  if (await canvas.isVisible()) {
    await canvas.click({ position: { x: 960, y: 540 } });
    await page.waitForTimeout(2000);
  }

  // Take final screenshot
  await page.screenshot({ path: '/tmp/playwright-screenshots/vf-debug-final.png' });
  console.log('\nScreenshot saved to /tmp/playwright-screenshots/vf-debug-final.png');

  await browser.close();
})();
