const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  console.log("Navigating with stats enabled...");
  await page.goto("http://localhost:5173/?skipAuth=true", { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(5000);

  // Check WebGL renderer info
  const glInfo = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return null;
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return null;
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : "N/A",
      renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : "N/A",
      version: gl.getParameter(gl.VERSION)
    };
  });
  console.log("WebGL Info:", JSON.stringify(glInfo, null, 2));

  // Screenshot
  await page.screenshot({ path: "/tmp/playwright-screenshots/visionflow-final.png", fullPage: false });

  // Interact with scene - rotate
  await page.mouse.move(960, 540);
  await page.mouse.down();
  await page.mouse.move(1100, 600, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(1000);

  await page.screenshot({ path: "/tmp/playwright-screenshots/visionflow-rotated.png", fullPage: false });
  console.log("Screenshots saved");

  await browser.close();
})();
