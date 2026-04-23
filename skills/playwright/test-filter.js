const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Collect console messages for filtering
  const filterLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('Filter') || text.includes('filter') ||
        text.includes('maxNode') || text.includes('nodes') ||
        text.includes('Validated') || text.includes('edges')) {
      filterLogs.push(text.substring(0, 300));
    }
  });

  console.log('Navigating to VisionFlow...');
  await page.goto('http://192.168.0.51:3001', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for graph to start loading
  await page.waitForTimeout(5000);

  console.log('\n=== Console logs (filtering) ===');
  filterLogs.forEach(l => console.log(l));

  // Check node count in UI
  const nodeCount = await page.evaluate(() => {
    const text = document.body.innerText;
    const match = text.match(/Nodes[:\s]+(\d+)/);
    return match ? match[1] : 'unknown';
  });

  console.log(`\nCurrent node count in UI: ${nodeCount}`);

  // Wait for full render
  await page.waitForTimeout(10000);

  console.log('\n=== Final console logs ===');
  filterLogs.slice(-15).forEach(l => console.log(l));

  await page.screenshot({ path: '/tmp/playwright-screenshots/filter-test.png' });
  console.log('\nScreenshot saved');

  await browser.close();
})();
