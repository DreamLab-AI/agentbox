const { chromium } = require('playwright');

(async () => {
  console.log('Starting browser on DISPLAY=' + process.env.DISPLAY);

  const browser = await chromium.launch({
    executablePath: '/usr/sbin/chromium',
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  const jsErrors = [];
  const consoleMessages = [];
  const networkRequests = [];

  page.on('pageerror', error => jsErrors.push(error.message));
  page.on('console', msg => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.text().includes('9021') || msg.text().includes('pending') || msg.text().includes('request')) {
      console.log('[Console]', msg.text());
    }
  });

  // Monitor WebSocket and relay traffic
  page.on('request', req => {
    if (req.url().includes('relay') || req.url().includes('nostr')) {
      networkRequests.push({ type: 'request', url: req.url(), method: req.method() });
    }
  });

  page.on('response', async res => {
    if (res.url().includes('relay') || res.url().includes('nostr')) {
      networkRequests.push({ type: 'response', url: res.url(), status: res.status() });
    }
  });

  console.log('Testing nostr-BBS Admin Page...\n');

  // Navigate to admin page
  const adminUrl = 'https://jjohare.github.io/nostr-BBS/admin';
  console.log('Navigating to:', adminUrl);

  await page.goto(adminUrl, { waitUntil: 'networkidle', timeout: 60000 });
  console.log('Page loaded, waiting for JS to execute...');

  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/playwright-screenshots/admin-initial.png', fullPage: true });
  console.log('Screenshot: /tmp/playwright-screenshots/admin-initial.png');

  // Check page title and content
  const title = await page.title();
  console.log('Page title:', title);

  // Check what's on the page
  const pageInfo = await page.evaluate(() => {
    const bodyText = document.body?.innerText || '';
    return {
      hasAdmin: bodyText.toLowerCase().includes('admin'),
      hasPending: bodyText.toLowerCase().includes('pending'),
      hasRequests: bodyText.toLowerCase().includes('request'),
      hasJoin: bodyText.toLowerCase().includes('join'),
      hasAuth: !!localStorage.getItem('nostr_bbs_keys'),
      authData: localStorage.getItem('nostr_bbs_keys'),
      bodyPreview: bodyText.substring(0, 1000),
    };
  });

  console.log('\n=== Page Analysis ===');
  console.log('Has "admin" text:', pageInfo.hasAdmin);
  console.log('Has "pending" text:', pageInfo.hasPending);
  console.log('Has "requests" text:', pageInfo.hasRequests);
  console.log('Has "join" text:', pageInfo.hasJoin);
  console.log('Is authenticated:', pageInfo.hasAuth);

  if (pageInfo.authData) {
    try {
      const auth = JSON.parse(pageInfo.authData);
      console.log('Logged in as pubkey:', auth.publicKey);
    } catch {}
  }

  console.log('\n=== Page Content Preview ===');
  console.log(pageInfo.bodyPreview);

  // Look for any elements related to requests
  const requestElements = await page.evaluate(() => {
    const elements = [];
    document.querySelectorAll('*').forEach(el => {
      const text = el.innerText || '';
      if (text.toLowerCase().includes('pending') ||
          text.toLowerCase().includes('request') ||
          text.toLowerCase().includes('join')) {
        if (el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE') {
          elements.push({
            tag: el.tagName,
            class: el.className,
            text: text.substring(0, 200)
          });
        }
      }
    });
    return elements.slice(0, 10);
  });

  console.log('\n=== Elements with request/pending/join ===');
  requestElements.forEach((el, i) => {
    console.log(`${i+1}. <${el.tag} class="${el.class}">: ${el.text.substring(0, 100)}...`);
  });

  // Check for any network errors
  console.log('\n=== Network Activity (relay) ===');
  networkRequests.forEach(req => {
    console.log(`${req.type}: ${req.url} ${req.status || req.method}`);
  });

  // Wait more and take final screenshot
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/playwright-screenshots/admin-final.png', fullPage: true });
  console.log('\nFinal screenshot: /tmp/playwright-screenshots/admin-final.png');

  console.log('\n=== JS Errors ===');
  if (jsErrors.length === 0) {
    console.log('No JavaScript errors');
  } else {
    jsErrors.forEach((e, i) => console.log(`${i+1}. ${e.substring(0, 300)}`));
  }

  await browser.close();
  console.log('\nDone!');
})();
