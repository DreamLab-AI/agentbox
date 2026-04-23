const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Collect all console messages related to data/nodes/filtering
  const dataLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('node') || text.includes('Node') ||
        text.includes('edge') || text.includes('Edge') ||
        text.includes('filter') || text.includes('quality') ||
        text.includes('maxNode') || text.includes('GraphWorker')) {
      dataLogs.push({ type: msg.type(), text: text.substring(0, 400) });
    }
  });

  console.log('Navigating to VisionFlow...');
  await page.goto('http://192.168.0.51:3001', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(8000);

  console.log('\n=== Initial data logs ===');
  dataLogs.forEach(l => console.log(`[${l.type}] ${l.text}`));

  // Find and click on Quality tab in Control Center
  console.log('\n=== Looking for Quality tab ===');

  // Try to find Quality button/tab
  const qualityTab = await page.locator('text=Quality').first();
  if (await qualityTab.isVisible()) {
    console.log('Found Quality tab, clicking...');
    await qualityTab.click();
    await page.waitForTimeout(2000);
  } else {
    console.log('Quality tab not visible, looking for icon...');
    // Try by icon or other selector
    const tabs = await page.locator('[class*="tab"], [class*="Tab"], button').allTextContents();
    console.log('Available tabs/buttons:', tabs.filter(t => t.length > 0 && t.length < 30).slice(0, 15));
  }

  // Take screenshot of Quality panel
  await page.screenshot({ path: '/tmp/playwright-screenshots/quality-panel.png' });
  console.log('\nScreenshot saved to /tmp/playwright-screenshots/quality-panel.png');

  // Try to find Max Node Count slider
  console.log('\n=== Looking for Max Node Count setting ===');
  const maxNodeLabel = await page.locator('text=Max Node').first();
  if (await maxNodeLabel.isVisible()) {
    console.log('Found Max Node setting');

    // Get current value
    const sliders = await page.locator('input[type="range"]').all();
    console.log(`Found ${sliders.length} sliders`);

    // Try to reduce max nodes to 500
    for (let i = 0; i < sliders.length; i++) {
      const slider = sliders[i];
      const val = await slider.inputValue();
      console.log(`Slider ${i}: value = ${val}`);
    }
  }

  // Check current node count
  const nodeInfo = await page.evaluate(() => {
    const nodeText = document.body.innerText.match(/Nodes[:\s]+(\d+)/);
    return nodeText ? nodeText[0] : 'not found';
  });
  console.log('\nCurrent node count:', nodeInfo);

  console.log('\n=== Data logs after Quality tab ===');
  dataLogs.slice(-10).forEach(l => console.log(`[${l.type}] ${l.text}`));

  await browser.close();
})();
