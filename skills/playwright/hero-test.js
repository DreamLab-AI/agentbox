const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  
  const baseUrl = 'https://dreamlab-ai.github.io/fairfield';
  const screenshotDir = '/tmp/hero-screenshots';
  
  require('fs').mkdirSync(screenshotDir, { recursive: true });
  
  // 1. Homepage
  console.log('1. Going to homepage...');
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  
  // 2. Click Create Account link
  console.log('2. Clicking Create Account...');
  await page.click('a:has-text("Create Account")');
  await page.waitForTimeout(2000);
  
  // 3. Look for the generate keys button
  console.log('3. Looking for Generate Keys button...');
  const generateBtn = await page.$('button:has-text("Generate Keys")');
  if (generateBtn) {
    console.log('   Found Generate Keys, clicking...');
    await generateBtn.click();
    await page.waitForTimeout(3000);
  }
  
  // 4. Skip tutorial if present
  console.log('4. Checking for tutorial...');
  let skipBtn = await page.$('button:has-text("Skip Tutorial")');
  if (!skipBtn) skipBtn = await page.$('text=Skip Tutorial');
  if (skipBtn) {
    console.log('   Found Skip Tutorial, clicking...');
    await skipBtn.click();
    await page.waitForTimeout(1000);
  }
  
  // Check current URL and localStorage
  console.log('5. Checking auth state...');
  const currentUrl = page.url();
  console.log('   Current URL:', currentUrl);
  
  // Check localStorage for auth
  const authData = await page.evaluate(() => {
    return {
      keys: localStorage.getItem('nostr_keys'),
      auth: localStorage.getItem('auth'),
      allKeys: Object.keys(localStorage)
    };
  });
  console.log('   localStorage keys:', authData.allKeys);
  console.log('   Auth data exists:', !!authData.keys || !!authData.auth);
  
  // Take screenshot of what we see after auth
  await page.screenshot({ path: `${screenshotDir}/00-after-auth.png`, fullPage: true });
  
  // Navigate to Family zone (should redirect to homepage if not authenticated)
  console.log('6. Going to Family zone...');
  await page.goto(`${baseUrl}/family`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  const newUrl = page.url();
  console.log('   After navigation URL:', newUrl);
  
  await page.screenshot({ path: `${screenshotDir}/01-family-attempt.png`, fullPage: true });
  
  await browser.close();
})();
