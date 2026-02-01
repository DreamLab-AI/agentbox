const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/sbin/chromium',
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });
  
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  
  const jsErrors = [];
  page.on('pageerror', error => jsErrors.push(error.message));
  
  console.log('Testing DEPLOYED GitHub Pages site...\n');
  
  // Test homepage  
  await page.goto('https://jjohare.github.io/fairfield-nostr/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/playwright-screenshots/deployed-home.png', fullPage: true });
  console.log('Homepage loaded: OK');
  
  // Test chat page
  await page.goto('https://jjohare.github.io/fairfield-nostr/chat', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/playwright-screenshots/deployed-chat.png', fullPage: true });
  console.log('Chat route loaded: OK');
  
  // Test signup page
  await page.goto('https://jjohare.github.io/fairfield-nostr/signup', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/playwright-screenshots/deployed-signup.png', fullPage: true });
  console.log('Signup route loaded: OK');
  
  // Test admin page
  await page.goto('https://jjohare.github.io/fairfield-nostr/admin', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/playwright-screenshots/deployed-admin.png', fullPage: true });
  console.log('Admin route loaded: OK');

  console.log('\n=== JS Runtime Errors ===');
  if (jsErrors.length === 0) {
    console.log('SUCCESS! No JavaScript runtime errors on deployed site!');
  } else {
    console.log('ERRORS FOUND:');
    jsErrors.forEach((e, i) => console.log((i+1) + '. ' + e.substring(0, 300)));
  }
  
  await browser.close();
  
  process.exit(jsErrors.length > 0 ? 1 : 0);
})();
