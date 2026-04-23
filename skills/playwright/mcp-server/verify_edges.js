const { chromium } = require('playwright');

(async () => {
  console.log('Launching browser to verify edge rendering...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Capture edge-related messages
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('FlowingEdges') || text.includes('Edge points') ||
        text.includes('EdgeDebug') || text.includes('LineSegments')) {
      console.log(`[${msg.type()}] ${text.substring(0, 250)}`);
    }
  });

  console.log('Navigating to http://192.168.0.51:3001...');
  try {
    await page.goto('http://192.168.0.51:3001', { waitUntil: 'networkidle', timeout: 60000 });
  } catch (e) {
    console.log('Navigation warning:', e.message.substring(0, 100));
  }

  await page.waitForTimeout(2000);

  // Click Dev Login
  console.log('Looking for Dev Login button...');
  const devLoginButton = await page.locator('button:has-text("Dev Login")').first();
  if (await devLoginButton.isVisible()) {
    console.log('Clicking Dev Login button...');
    await devLoginButton.click();
    await page.waitForTimeout(10000);
  }

  // Check THREE.js scene for LineSegments
  const sceneInfo = await page.evaluate(() => {
    const result = { lineSegments: [], edgeCounts: {} };

    const canvases = document.querySelectorAll('canvas');
    for (const canvas of canvases) {
      if (canvas.__r3f && canvas.__r3f.store) {
        try {
          const state = canvas.__r3f.store.getState();
          const scene = state.scene;

          scene.traverse((obj) => {
            if (obj.type === 'LineSegments') {
              const geo = obj.geometry;
              const posAttr = geo?.attributes?.position;
              result.lineSegments.push({
                name: obj.name || 'unnamed',
                visible: obj.visible,
                positionCount: posAttr?.count || 0,
                vertexCount: posAttr?.array?.length || 0,
                edgeCount: Math.floor((posAttr?.count || 0) / 2)
              });
            }
          });
        } catch (e) {
          result.error = e.message;
        }
      }
    }
    return result;
  });

  console.log('\n=== LineSegments Analysis ===');
  console.log(JSON.stringify(sceneInfo, null, 2));

  // Take screenshot
  await page.screenshot({ path: '/tmp/edge_verify.png', fullPage: false });
  console.log('\nScreenshot saved to /tmp/edge_verify.png');

  await browser.close();
})().catch(e => console.error('Fatal Error:', e.message));
