const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/sbin/chromium',
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });
  
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  
  console.log('Testing channel stores fix...');
  
  // Test homepage  
  await page.goto('http://localhost:4176/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const homeContent = await page.content();
  await page.screenshot({ path: '/tmp/playwright-screenshots/fixed-home.png', fullPage: true });
  const homeOk = homeContent.indexOf('500') === -1 && homeContent.indexOf('Internal Error') === -1;
  console.log('Homepage:', homeOk ? 'OK' : 'ERROR');
  
  // Test chat page
  await page.goto('http://localhost:4176/chat', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const chatContent = await page.content();
  await page.screenshot({ path: '/tmp/playwright-screenshots/fixed-chat.png', fullPage: true });
  const chatOk = chatContent.indexOf('500') === -1 && chatContent.indexOf('Internal Error') === -1;
  console.log('Chat page:', chatOk ? 'OK' : 'ERROR');
  
  // Test admin page
  await page.goto('http://localhost:4176/admin', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const adminContent = await page.content();
  await page.screenshot({ path: '/tmp/playwright-screenshots/fixed-admin.png', fullPage: true });
  const adminOk = adminContent.indexOf('500') === -1 && adminContent.indexOf('Internal Error') === -1;
  console.log('Admin page:', adminOk ? 'OK' : 'ERROR');
  
  console.log('\n=== JS Errors ===');
  if (errors.length === 0) {
    console.log('No JS errors! SUCCESS!');
  } else {
    errors.forEach((e, i) => console.log((i+1) + '. ' + e.substring(0, 200)));
  }
  
  await browser.close();
})();
