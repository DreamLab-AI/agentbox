const { chromium } = require('playwright');

(async () => {
  console.log('Launching browser on Display :1...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Collect console messages
  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    // Log edge-related messages
    if (text.includes('edge') || text.includes('Edge') || text.includes('LineSegments') || text.includes('points')) {
      console.log('LOG:', text.substring(0, 300));
    }
  });

  console.log('Navigating to http://192.168.0.51:3001...');
  try {
    await page.goto('http://192.168.0.51:3001', { waitUntil: 'networkidle', timeout: 60000 });
  } catch (e) {
    console.log('Navigation warning:', e.message);
  }

  await page.waitForTimeout(2000);

  // Click Dev Login button
  console.log('Looking for Dev Login button...');
  const devLoginButton = await page.locator('button:has-text("Dev Login")').first();
  if (await devLoginButton.isVisible()) {
    console.log('Clicking Dev Login button...');
    await devLoginButton.click();
    await page.waitForTimeout(5000);
  }

  console.log('Waiting for graph to fully load...');
  await page.waitForTimeout(10000);

  // Inject debug code to inspect React state and THREE.js scene
  const debugInfo = await page.evaluate(() => {
    const result = {
      canvases: [],
      reactRoots: [],
      threeScenes: [],
      lineSegments: [],
      flowingEdgesComponents: [],
      zustandStores: []
    };

    // Find all canvases
    const canvases = document.querySelectorAll('canvas');
    result.canvases = Array.from(canvases).map((c, i) => ({
      index: i,
      width: c.width,
      height: c.height,
      hasR3F: !!c.__r3f,
      r3fStoreExists: !!(c.__r3f && c.__r3f.store)
    }));

    // Try to find R3F store and check scene
    for (const canvas of canvases) {
      if (canvas.__r3f && canvas.__r3f.store) {
        try {
          const state = canvas.__r3f.store.getState();
          const scene = state.scene;

          let objectCounts = {};
          let lineSegmentsDetails = [];

          scene.traverse((obj) => {
            objectCounts[obj.type] = (objectCounts[obj.type] || 0) + 1;

            // Detailed LineSegments inspection
            if (obj.type === 'LineSegments') {
              const geo = obj.geometry;
              const mat = obj.material;
              const posAttr = geo?.attributes?.position;

              lineSegmentsDetails.push({
                name: obj.name || 'unnamed',
                visible: obj.visible,
                renderOrder: obj.renderOrder,
                frustumCulled: obj.frustumCulled,
                layersMask: obj.layers?.mask,
                worldPosition: obj.getWorldPosition ? (() => {
                  const wp = new THREE.Vector3();
                  obj.getWorldPosition(wp);
                  return [wp.x, wp.y, wp.z];
                })() : null,
                geometry: {
                  type: geo?.type,
                  positionCount: posAttr?.count || 0,
                  positionItemSize: posAttr?.itemSize || 0,
                  boundingSphere: geo?.boundingSphere ? {
                    center: [geo.boundingSphere.center.x, geo.boundingSphere.center.y, geo.boundingSphere.center.z],
                    radius: geo.boundingSphere.radius
                  } : null,
                  // Sample first 10 vertices
                  samplePositions: posAttr?.array ? Array.from(posAttr.array.slice(0, 30)).map(v => Math.round(v * 100) / 100) : []
                },
                material: {
                  type: mat?.type,
                  color: mat?.color?.getHexString(),
                  opacity: mat?.opacity,
                  transparent: mat?.transparent,
                  visible: mat?.visible,
                  depthTest: mat?.depthTest,
                  depthWrite: mat?.depthWrite,
                  linewidth: mat?.linewidth
                }
              });
            }
          });

          result.threeScenes.push({
            childCount: scene.children.length,
            objectCounts,
            lineSegmentsDetails
          });
        } catch (e) {
          result.threeScenes.push({ error: e.message });
        }
      }
    }

    // Check for Zustand stores (edge state)
    if (window.__ZUSTAND_DEVTOOLS_EXTENSION__) {
      result.zustandStores.push('Zustand devtools detected');
    }

    // Try to find React fiber and component state
    const reactRoot = document.getElementById('root');
    if (reactRoot && reactRoot._reactRootContainer) {
      result.reactRoots.push('React root found');
    }

    return result;
  });

  console.log('\n=== DEBUG INFO ===');
  console.log(JSON.stringify(debugInfo, null, 2));

  // Screenshot
  await page.screenshot({ path: '/tmp/edge_debug_detailed.png', fullPage: false });
  console.log('\nScreenshot saved to /tmp/edge_debug_detailed.png');

  await browser.close();
})().catch(e => console.error('Fatal Error:', e.message));
