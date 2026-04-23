const { chromium } = require('playwright');

(async () => {
  console.log('Launching browser to trace bad edges...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Capture all console messages, especially errors
  page.on('console', msg => {
    const text = msg.text();
    // Log all graph-related and bad edge messages
    if (text.includes('BAD EDGE') || text.includes('graphWorkerProxy') ||
        text.includes('Stack trace') || text.includes('setGraphData')) {
      console.log(`[${msg.type()}] ${text}`);
    }
  });

  console.log('Navigating to http://192.168.0.51:3001...');
  try {
    await page.goto('http://192.168.0.51:3001', { waitUntil: 'networkidle', timeout: 60000 });
  } catch (e) {
    console.log('Navigation warning:', e.message.substring(0, 100));
  }

  await page.waitForTimeout(2000);

  // Click Dev Login
  console.log('Looking for Dev Login button...');
  const devLoginButton = await page.locator('button:has-text("Dev Login")').first();
  if (await devLoginButton.isVisible()) {
    console.log('Clicking Dev Login button...');
    await devLoginButton.click();
    await page.waitForTimeout(8000);
  }

  console.log('Waiting for potential bad edge stack traces...');
  await page.waitForTimeout(5000);

  // Take screenshot
  await page.screenshot({ path: '/tmp/edge_trace.png' });
  console.log('\nScreenshot saved to /tmp/edge_trace.png');

  await browser.close();
})().catch(e => console.error('Fatal Error:', e.message));
