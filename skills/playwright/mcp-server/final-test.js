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
  page.on('console', msg => {
    if (msg.type() === 'error') jsErrors.push(msg.text());
  });

  console.log('=== FINAL DEPLOYMENT TEST ===');
  console.log('Testing https://jjohare.github.io/fairfield-nostr/');
  console.log('');

  // 1. Test signup page
  await page.goto('https://jjohare.github.io/fairfield-nostr/signup', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/playwright-screenshots/final-1-signup.png', fullPage: true });
  console.log('1. Signup page loaded');

  // 2. Click Create Account
  const createButton = await page.$('button:has-text("Create Account")');
  if (createButton) {
    await createButton.click();
    console.log('2. Clicked Create Account');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: '/tmp/playwright-screenshots/final-2-create.png', fullPage: true });

    const content = await page.content();
    if (content.includes('Buffer is not defined')) {
      console.log('3. FAIL: Buffer is not defined error');
    } else if (content.includes('Recovery Phrase') || content.includes('12-word') || content.includes('Write this down')) {
      console.log('3. SUCCESS: Recovery phrase generated!');
    } else {
      console.log('3. Unknown state - check screenshot');
    }
  }

  // 4. Test navigation to other pages
  await page.goto('https://jjohare.github.io/fairfield-nostr/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/playwright-screenshots/final-3-home.png', fullPage: true });
  console.log('4. Homepage loaded');

  await page.goto('https://jjohare.github.io/fairfield-nostr/chat', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/playwright-screenshots/final-4-chat.png', fullPage: true });
  const chatContent = await page.content();
  const chatOk = chatContent.indexOf('500') === -1 && chatContent.indexOf('Internal Error') === -1;
  console.log('5. Chat page:', chatOk ? 'OK' : 'ERROR');

  console.log('');
  console.log('=== JS Runtime Errors ===');
  if (jsErrors.length === 0) {
    console.log('SUCCESS! No JavaScript errors!');
  } else {
    console.log('Errors:');
    jsErrors.forEach((e, i) => console.log((i+1) + '. ' + e.substring(0, 150)));
  }

  await browser.close();
})();
