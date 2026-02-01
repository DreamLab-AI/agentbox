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
  
  console.log('Testing SIGNUP FLOW on deployed site...\n');
  
  // Go to signup page
  await page.goto('https://jjohare.github.io/fairfield-nostr/signup', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/playwright-screenshots/signup-1-initial.png', fullPage: true });
  console.log('1. Signup page loaded');
  
  // Click "Create Account" button
  const createButton = await page.$('button:has-text("Create Account")');
  if (createButton) {
    await createButton.click();
    console.log('2. Clicked Create Account');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/playwright-screenshots/signup-2-after-create.png', fullPage: true });
    
    // Check if mnemonic was generated (look for word display)
    const content = await page.content();
    if (content.includes('recovery') || content.includes('mnemonic') || content.includes('Word 1')) {
      console.log('3. Recovery phrase appears to be generated');
    } else {
      console.log('3. Recovery phrase UI not detected (may need login check)');
    }
  } else {
    console.log('2. ERROR: Create Account button not found');
  }

  console.log('\n=== JS Runtime Errors ===');
  if (jsErrors.length === 0) {
    console.log('SUCCESS! No JavaScript errors during signup flow!');
  } else {
    console.log('ERRORS FOUND:');
    jsErrors.forEach((e, i) => console.log((i+1) + '. ' + e.substring(0, 300)));
  }
  
  await browser.close();
  
  process.exit(jsErrors.length > 0 ? 1 : 0);
})();
