const { chromium } = require('playwright');

(async () => {
  console.log('Taking final screenshot to verify edges...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  try {
    await page.goto('http://192.168.0.51:3001', { waitUntil: 'load', timeout: 30000 });
  } catch (e) {
    console.log('Nav:', e.message.substring(0, 50));
  }

  await page.waitForTimeout(2000);

  const devLoginButton = await page.locator('button:has-text("Dev Login")').first();
  if (await devLoginButton.isVisible({ timeout: 5000 })) {
    await devLoginButton.click();
    console.log('Logged in, waiting for graph...');
    await page.waitForTimeout(12000);
  }

  // Quick screenshot with shorter timeout
  try {
    await page.screenshot({ path: '/tmp/edges_fixed.png', timeout: 10000 });
    console.log('Screenshot saved: /tmp/edges_fixed.png');
  } catch (e) {
    console.log('Screenshot timeout, saving partial');
    await page.screenshot({ path: '/tmp/edges_fixed.png', timeout: 5000 }).catch(() => {});
  }

  await browser.close();
  console.log('Done');
})().catch(e => console.error('Error:', e.message.substring(0, 100)));
