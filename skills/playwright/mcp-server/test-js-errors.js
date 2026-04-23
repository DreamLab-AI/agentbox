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
  
  console.log('Testing for JS runtime errors...\n');
  
  // Test homepage  
  await page.goto('http://localhost:4176/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/playwright-screenshots/final-home.png', fullPage: true });
  console.log('Homepage loaded: OK');
  
  // Test chat page (will redirect to home if not logged in, but should not error)
  await page.goto('http://localhost:4176/chat', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/playwright-screenshots/final-chat.png', fullPage: true });
  console.log('Chat route loaded: OK');
  
  // Test admin page
  await page.goto('http://localhost:4176/admin', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/playwright-screenshots/final-admin.png', fullPage: true });
  console.log('Admin route loaded: OK');
  
  // Test signup page
  await page.goto('http://localhost:4176/signup', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/playwright-screenshots/final-signup.png', fullPage: true });
  console.log('Signup route loaded: OK');

  console.log('\n=== JS Runtime Errors ===');
  if (jsErrors.length === 0) {
    console.log('SUCCESS! No JavaScript runtime errors detected!');
  } else {
    console.log('ERRORS FOUND:');
    jsErrors.forEach((e, i) => console.log((i+1) + '. ' + e.substring(0, 300)));
  }
  
  await browser.close();
  
  // Exit with error code if there were JS errors
  process.exit(jsErrors.length > 0 ? 1 : 0);
})();
