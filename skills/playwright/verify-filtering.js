const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Collect all filtering-related console messages
  const filterLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('GraphDataManager') || text.includes('maxNodeCount') ||
        text.includes('Filtering') || text.includes('filtering') ||
        text.includes('nodes') || text.includes('Nodes') ||
        text.includes('quality') || text.includes('authority')) {
      filterLogs.push(`[${msg.type()}] ${text.substring(0, 500)}`);
    }
  });

  console.log('Navigating to VisionFlow...');
  await page.goto('http://192.168.0.51:3001', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for graph data to load and filter
  console.log('Waiting for graph to load and filter...');
  await page.waitForTimeout(15000);

  console.log('\n=== FILTERING CONSOLE LOGS ===');
  filterLogs.forEach(l => console.log(l));

  // Get current node count from UI
  const nodeInfo = await page.evaluate(() => {
    const text = document.body.innerText;
    const nodeMatch = text.match(/Nodes[:\s]+(\d+)/);
    const edgeMatch = text.match(/Edges[:\s]+(\d+)/);
    return {
      nodes: nodeMatch ? nodeMatch[1] : 'not found',
      edges: edgeMatch ? edgeMatch[1] : 'not found'
    };
  });

  console.log('\n=== UI NODE/EDGE COUNT ===');
  console.log(`Nodes: ${nodeInfo.nodes}`);
  console.log(`Edges: ${nodeInfo.edges}`);

  // Take screenshot
  await page.screenshot({ path: '/tmp/playwright-screenshots/filtering-verify.png' });
  console.log('\nScreenshot saved to /tmp/playwright-screenshots/filtering-verify.png');

  // Show last 10 filter logs
  console.log('\n=== FINAL FILTERING LOGS (last 10) ===');
  filterLogs.slice(-10).forEach(l => console.log(l));

  await browser.close();
})();
