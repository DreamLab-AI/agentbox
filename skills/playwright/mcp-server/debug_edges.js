const { chromium } = require('playwright');

(async () => {
  console.log('Launching browser on Display :1...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Collect console errors
  const consoleErrors = [];
  const consoleWarnings = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
    if (msg.type() === 'warning') {
      consoleWarnings.push(msg.text());
    }
    // Log graph-related messages
    if (msg.text().includes('edge') || msg.text().includes('Edge') || msg.text().includes('Graph')) {
      console.log('GRAPH LOG:', msg.text());
    }
  });

  page.on('pageerror', error => {
    consoleErrors.push('PAGE ERROR: ' + error.message);
  });

  console.log('Navigating to http://192.168.0.51:3001...');
  try {
    await page.goto('http://192.168.0.51:3001', { waitUntil: 'networkidle', timeout: 60000 });
  } catch (e) {
    console.log('Navigation warning:', e.message);
  }

  // Wait for login screen
  await page.waitForTimeout(2000);

  // Click Dev Login button
  console.log('Looking for Dev Login button...');
  const devLoginButton = await page.locator('button:has-text("Dev Login")').first();
  if (await devLoginButton.isVisible()) {
    console.log('Clicking Dev Login button...');
    await devLoginButton.click();
    await page.waitForTimeout(3000);
  } else {
    console.log('Dev Login button not found, may already be logged in');
  }

  console.log('Waiting for graph to load...');
  await page.waitForTimeout(10000);

  console.log('Taking screenshot after login...');
  await page.screenshot({ path: '/tmp/edge_debug_01.png', fullPage: false });

  // Check THREE.js scene
  const sceneInfo = await page.evaluate(() => {
    // Find THREE.js scene
    const canvas = document.querySelector('canvas');
    if (!canvas) return { error: 'No canvas found' };

    // Try to access R3F store
    let r3fInfo = null;
    try {
      const fiber = canvas.__r3f;
      if (fiber && fiber.store) {
        const state = fiber.store.getState();
        const scene = state.scene;

        // Count all object types
        let objectCounts = {};
        let lineSegmentsInfo = [];

        scene.traverse((obj) => {
          objectCounts[obj.type] = (objectCounts[obj.type] || 0) + 1;

          if (obj.type === 'LineSegments') {
            const geo = obj.geometry;
            const mat = obj.material;
            lineSegmentsInfo.push({
              name: obj.name || 'unnamed',
              visible: obj.visible,
              renderOrder: obj.renderOrder,
              frustumCulled: obj.frustumCulled,
              layers: obj.layers?.mask,
              position: [obj.position.x, obj.position.y, obj.position.z],
              scale: [obj.scale.x, obj.scale.y, obj.scale.z],
              geometryType: geo?.type,
              positionCount: geo?.attributes?.position?.count || 0,
              positionArray: geo?.attributes?.position?.array ?
                Array.from(geo.attributes.position.array.slice(0, 12)) : [],
              materialType: mat?.type,
              materialColor: mat?.color?.getHexString(),
              materialOpacity: mat?.opacity,
              materialTransparent: mat?.transparent,
              materialVisible: mat?.visible,
              materialDepthTest: mat?.depthTest,
              materialDepthWrite: mat?.depthWrite
            });
          }
        });

        r3fInfo = {
          sceneChildren: scene.children.length,
          objectCounts,
          lineSegmentsInfo
        };
      } else {
        r3fInfo = { error: 'R3F fiber not found on canvas' };
      }
    } catch (e) {
      r3fInfo = { error: e.message };
    }

    return {
      canvasFound: true,
      canvasSize: { width: canvas.width, height: canvas.height },
      r3f: r3fInfo
    };
  });

  console.log('\n=== THREE.js Scene Info ===');
  console.log(JSON.stringify(sceneInfo, null, 2));

  console.log('\n=== Console Errors (' + consoleErrors.length + ') ===');
  consoleErrors.slice(0, 10).forEach(e => console.log('ERROR:', e.substring(0, 200)));

  // Take another screenshot
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/edge_debug_02.png', fullPage: false });

  await browser.close();
  console.log('\nDone. Screenshots saved to /tmp/edge_debug_*.png');
})().catch(e => console.error('Fatal Error:', e.message));
