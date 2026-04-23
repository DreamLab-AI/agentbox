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

  console.log('=== LOGIN WITH 12 WORDS TEST ===');

  // Go to setup page (login with existing mnemonic)
  await page.goto('http://localhost:4181/setup', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/playwright-screenshots/login-1-setup.png', fullPage: true });
  console.log('1. Setup (login) page loaded');

  // Should see the Login component with 'Paste Phrase' tab active
  const pasteTab = await page.$('button:has-text("Paste Phrase")');
  console.log('2. Paste Phrase tab:', pasteTab ? 'FOUND' : 'NOT FOUND');

  // Use a valid test mnemonic (from BIP39 word list)
  const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  // Type mnemonic into textarea
  const textarea = await page.$('textarea');
  if (textarea) {
    await textarea.fill(testMnemonic);
    console.log('3. Entered test mnemonic');
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/playwright-screenshots/login-2-filled.png', fullPage: true });
  }

  // Click Restore Account button
  const restoreBtn = await page.$('button:has-text("Restore Account")');
  if (restoreBtn) {
    await restoreBtn.click();
    console.log('4. Clicked Restore Account');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/playwright-screenshots/login-3-after-restore.png', fullPage: true });

    // Check current URL - should redirect to /chat if successful
    const currentUrl = page.url();
    console.log('5. Current URL:', currentUrl);

    if (currentUrl.includes('/chat')) {
      console.log('6. SUCCESS: Redirected to chat!');

      // Check for navbar and profile button
      const navbar = await page.$('.navbar');
      console.log('7. Navbar:', navbar ? 'FOUND' : 'NOT FOUND');

      const profileBtn = await page.$('button[title="Profile"]');
      if (profileBtn) {
        console.log('8. Profile button found!');
        await profileBtn.click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: '/tmp/playwright-screenshots/login-4-profile-modal.png', fullPage: true });

        // Check modal content
        const modalBox = await page.$('.modal-box');
        if (modalBox) {
          const text = await modalBox.textContent();
          console.log('9. Modal opened, has npub:', text.includes('npub') ? 'YES' : 'NO');
          console.log('10. Modal has nsec label:', text.includes('Private Key') ? 'YES' : 'NO');
        }
      } else {
        console.log('8. ERROR: Profile button not found');
        const buttons = await page.$$('button');
        console.log('   Available buttons:');
        for (let i = 0; i < buttons.length; i++) {
          const text = await buttons[i].textContent();
          const title = await buttons[i].getAttribute('title');
          console.log('   -', (text || '').trim().substring(0, 30) || '(empty)', title ? '[title=' + title + ']' : '');
        }
      }
    } else {
      console.log('6. ERROR: Still on setup page or error occurred');
      // Check for error messages
      const errorAlert = await page.$('.alert-error');
      if (errorAlert) {
        const errorText = await errorAlert.textContent();
        console.log('   Error message:', errorText);
      }
    }
  }

  console.log('');
  console.log('=== JS Errors ===');
  if (jsErrors.length === 0) {
    console.log('No JS errors!');
  } else {
    jsErrors.forEach((e, i) => console.log((i+1) + '. ' + e.substring(0, 200)));
  }

  await browser.close();
  console.log('\nDone! Check /tmp/playwright-screenshots/login-*.png');
})();
