#!/usr/bin/env node
/**
 * FossFLOW Playwright Screenshot Verification
 * Uses Playwright to render diagrams and capture screenshots
 */

const fs = require('fs');
const path = require('path');

// Minimal HTML template for rendering FossFLOW diagrams
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>FossFLOW Diagram Preview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      background: #16213e;
      padding: 16px 24px;
      border-bottom: 1px solid #0f3460;
    }
    .header h1 {
      font-size: 20px;
      font-weight: 500;
    }
    .header p {
      color: #888;
      font-size: 14px;
      margin-top: 4px;
    }
    .canvas-container {
      flex: 1;
      position: relative;
      overflow: hidden;
    }
    #diagram-canvas {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }
    .node {
      position: absolute;
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .node:hover {
      transform: scale(1.05);
    }
    .node-icon {
      width: 80px;
      height: 80px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      border-radius: 8px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .node-label {
      margin-top: 8px;
      font-size: 12px;
      font-weight: 500;
      text-align: center;
      max-width: 100px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .connector {
      position: absolute;
      pointer-events: none;
    }
    .connector-line {
      stroke-width: 2;
      fill: none;
    }
    .connector-arrow {
      fill: currentColor;
    }
    .stats {
      position: fixed;
      bottom: 16px;
      right: 16px;
      background: rgba(22, 33, 62, 0.9);
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 12px;
      color: #888;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1 id="title">FossFLOW Diagram</h1>
    <p id="description"></p>
  </div>
  <div class="canvas-container">
    <svg id="diagram-canvas"></svg>
    <div id="nodes-container"></div>
  </div>
  <div class="stats" id="stats"></div>

  <script>
    // Icon emoji mapping
    const ICON_MAP = {
      'isoflow__server': '🖥️',
      'isoflow__database': '🗄️',
      'isoflow__redis': '⚡',
      'isoflow__backup': '💾',
      'isoflow__api': '🔌',
      'isoflow__microservice': '📦',
      'isoflow__authentication': '🔐',
      'isoflow__gateway': '🚪',
      'isoflow__load_balancer': '⚖️',
      'isoflow__cdn': '🌐',
      'isoflow__queue': '📋',
      'isoflow__logs': '📝',
      'isoflow__person': '👤',
      'isoflow__mobile': '📱',
      'isoflow__web_app': '💻',
      'isoflow__monitoring': '📊',
      'isoflow__analytics': '📈',
      'isoflow__notification': '🔔',
      'isoflow__shield': '🛡️'
    };

    // Isometric projection constants
    const TILE_WIDTH = 100;
    const TILE_HEIGHT = 50;
    const OFFSET_X = 400;
    const OFFSET_Y = 100;

    function isoProject(x, y) {
      return {
        x: OFFSET_X + (x - y) * (TILE_WIDTH / 2),
        y: OFFSET_Y + (x + y) * (TILE_HEIGHT / 2)
      };
    }

    function renderDiagram(diagram) {
      // Update header
      document.getElementById('title').textContent = diagram.title || 'Untitled Diagram';
      document.getElementById('description').textContent = diagram.description || '';

      const canvas = document.getElementById('diagram-canvas');
      const nodesContainer = document.getElementById('nodes-container');

      // Build color map
      const colorMap = {};
      (diagram.colors || []).forEach(c => {
        colorMap[c.id] = c.value;
      });

      // Build item position map
      const itemPositions = {};

      // Render nodes
      (diagram.items || []).forEach(item => {
        const pos = isoProject(item.position.x, item.position.y);
        itemPositions[item.id] = { x: pos.x, y: pos.y };

        const node = document.createElement('div');
        node.className = 'node';
        node.style.left = (pos.x - 40) + 'px';
        node.style.top = (pos.y - 40) + 'px';

        const icon = ICON_MAP[item.icon] || '📦';
        node.innerHTML = \`
          <div class="node-icon">\${icon}</div>
          <div class="node-label">\${item.name}</div>
        \`;

        nodesContainer.appendChild(node);
      });

      // Render connectors
      (diagram.connectors || []).forEach(conn => {
        const from = itemPositions[conn.from];
        const to = itemPositions[conn.to];

        if (!from || !to) return;

        const color = colorMap[conn.color] || conn.customColor || '#4A90D9';

        // Create SVG path
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = \`M \${from.x} \${from.y} L \${to.x} \${to.y}\`;
        path.setAttribute('d', d);
        path.setAttribute('class', 'connector-line');
        path.setAttribute('stroke', color);

        if (conn.style === 'DASHED') {
          path.setAttribute('stroke-dasharray', '8,4');
        } else if (conn.style === 'DOTTED') {
          path.setAttribute('stroke-dasharray', '2,2');
        }

        canvas.appendChild(path);

        // Arrow head
        if (conn.showArrow !== false) {
          const angle = Math.atan2(to.y - from.y, to.x - from.x);
          const arrowSize = 10;
          const arrowX = to.x - Math.cos(angle) * 40;
          const arrowY = to.y - Math.sin(angle) * 40;

          const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          const points = [
            [arrowX, arrowY],
            [arrowX - arrowSize * Math.cos(angle - Math.PI/6), arrowY - arrowSize * Math.sin(angle - Math.PI/6)],
            [arrowX - arrowSize * Math.cos(angle + Math.PI/6), arrowY - arrowSize * Math.sin(angle + Math.PI/6)]
          ].map(p => p.join(',')).join(' ');

          arrow.setAttribute('points', points);
          arrow.setAttribute('fill', color);
          canvas.appendChild(arrow);
        }
      });

      // Update stats
      document.getElementById('stats').innerHTML = \`
        Items: \${diagram.items?.length || 0} |
        Connectors: \${diagram.connectors?.length || 0} |
        Colors: \${diagram.colors?.length || 0}
      \`;
    }

    // Load diagram from URL parameter or embedded data
    const urlParams = new URLSearchParams(window.location.search);
    const diagramUrl = urlParams.get('diagram');

    if (diagramUrl) {
      fetch(diagramUrl)
        .then(r => r.json())
        .then(renderDiagram)
        .catch(e => {
          document.getElementById('title').textContent = 'Error loading diagram';
          document.getElementById('description').textContent = e.message;
        });
    } else if (window.DIAGRAM_DATA) {
      renderDiagram(window.DIAGRAM_DATA);
    }
  </script>
</body>
</html>
`;

/**
 * Generate standalone HTML preview for a diagram
 */
function generatePreviewHtml(diagram) {
  return HTML_TEMPLATE.replace(
    'window.DIAGRAM_DATA',
    `window.DIAGRAM_DATA = ${JSON.stringify(diagram, null, 2)}`
  );
}

/**
 * Create a preview HTML file
 */
function createPreview(diagramPath, outputPath) {
  const diagram = JSON.parse(fs.readFileSync(diagramPath, 'utf-8'));
  const html = generatePreviewHtml(diagram);
  fs.writeFileSync(outputPath, html);
  console.log(`Preview created: ${outputPath}`);
  return outputPath;
}

/**
 * Capture screenshot using Playwright
 */
async function captureScreenshot(htmlPath, outputPath, options = {}) {
  let playwright;

  try {
    playwright = require('playwright');
  } catch (e) {
    console.error('Playwright not installed. Install with: npm install playwright');
    console.log('\nAlternative: Use the generated HTML file directly in a browser.');
    return null;
  }

  const browser = await playwright.chromium.launch({
    headless: true,
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: options.width || 1280, height: options.height || 720 });

  const fileUrl = `file://${path.resolve(htmlPath)}`;
  await page.goto(fileUrl, { waitUntil: 'networkidle' });

  // Wait for rendering
  await page.waitForTimeout(500);

  await page.screenshot({ path: outputPath, fullPage: options.fullPage || false });
  await browser.close();

  console.log(`Screenshot saved: ${outputPath}`);
  return outputPath;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log(`
FossFLOW Playwright Verification

Usage:
  node playwright-verify.js preview <diagram.json> [output.html]
  node playwright-verify.js screenshot <diagram.json> [output.png]
  node playwright-verify.js html-template > template.html

Commands:
  preview     Generate standalone HTML preview
  screenshot  Capture screenshot (requires playwright)
  html-template   Output blank HTML template

Examples:
  node playwright-verify.js preview my-diagram.json preview.html
  node playwright-verify.js screenshot my-diagram.json screenshot.png
`);
    process.exit(0);
  }

  const command = args[0];
  const input = args[1];
  const output = args[2];

  switch (command) {
    case 'preview':
      if (!input) {
        console.error('Error: diagram.json path required');
        process.exit(1);
      }
      const htmlOutput = output || input.replace('.json', '-preview.html');
      createPreview(input, htmlOutput);
      break;

    case 'screenshot':
      if (!input) {
        console.error('Error: diagram.json path required');
        process.exit(1);
      }
      const tempHtml = `/tmp/fossflow-preview-${Date.now()}.html`;
      const pngOutput = output || input.replace('.json', '-screenshot.png');
      createPreview(input, tempHtml);
      captureScreenshot(tempHtml, pngOutput)
        .then(() => fs.unlinkSync(tempHtml))
        .catch(console.error);
      break;

    case 'html-template':
      console.log(HTML_TEMPLATE);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

module.exports = { generatePreviewHtml, createPreview, captureScreenshot };
