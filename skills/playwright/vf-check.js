const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  console.log('Navigating to VisionFlow...');
  await page.goto('http://192.168.0.51:3001', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(6000);

  // Get page state
  const info = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const hasCanvas = canvas !== null;
    return {
      hasCanvas: hasCanvas,
      title: document.title
    };
  });
  console.log('Page info:', JSON.stringify(info));

  await page.screenshot({ path: '/tmp/playwright-screenshots/vf-check.png' });
  console.log('Screenshot saved');

  await browser.close();
})();
