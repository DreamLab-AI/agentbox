'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('owned web-interface contracts', () => {
  const cockpitHtml = read('voice/console/site/index.html');
  const cockpitJs = read('voice/console/site/app.js');
  const cockpitCss = read('voice/console/site/styles.css');
  const caddy = read('voice/console/Caddyfile');
  const setupHtml = read('setup/frontend/dist/index.html');
  const setupJs = read('setup/frontend/dist/app.js');
  const setupCss = read('setup/frontend/dist/style.css');
  const server = read('management-api/server.js');

  test('cockpit is the navigable home for retained browser surfaces', () => {
    expect(cockpitHtml).toContain('aria-label="Agentbox interfaces"');
    expect(cockpitHtml).toContain('href="/lo/"');
    expect(cockpitHtml).toContain('href="/docs/"');
    expect(cockpitHtml).toContain('data-surface="code-server"');
    expect(cockpitHtml).toContain('data-surface="jupyter"');
    expect(caddy).toMatch(/handle \/lo\*/);
    expect(caddy).toMatch(/handle \/docs\*/);
    expect(caddy).toMatch(/handle_path \/mgmt\/\*/);
  });

  test('cockpit has keyboard-complete tabs, labelled composers, and safe approvals', () => {
    expect(cockpitHtml).toMatch(/role="tab"[^>]+aria-selected="true"[^>]+aria-controls="term"/);
    expect(cockpitHtml).toContain('role="tabpanel" aria-labelledby="tab-term"');
    expect(cockpitHtml).toContain('for="detail-text"');
    expect(cockpitHtml).toContain('for="nostr-text"');
    expect(cockpitJs).toContain("['ArrowLeft', 'ArrowRight', 'Home', 'End']");
    expect(cockpitJs).toContain('window.confirm(consequence)');
    expect(cockpitJs).toContain("el('summary', '', 'Review scope')");
  });

  test('cockpit polling is cancellable, visibility-aware, and backs off', () => {
    expect(cockpitJs).toContain('new AbortController()');
    expect(cockpitJs).toContain("document.addEventListener('visibilitychange'");
    expect(cockpitJs).toContain('Math.min(30000, 1000 * (2 ** feedRetry))');
    expect(cockpitJs).not.toMatch(/setInterval\(poll(?:Health|Sessions|Approvals|NostrEvents)/);
  });

  test('setup is a pre-boot wizard with no operations dashboard implementation', () => {
    expect(setupHtml).not.toContain('data-mode="dashboard"');
    expect(setupHtml).not.toContain('dashboard-grid');
    expect(setupHtml).not.toContain('Pending Approvals');
    expect(setupJs).not.toMatch(/startDashboard|pollDashboard|renderServiceGrid|dashboardBaseUrl/);
  });

  test('OpenAPI identifies Agentbox and advertises the real auth schemes', () => {
    expect(server).toContain("title: 'Agentbox Management API'");
    expect(server).toContain('bearerAuth:');
    expect(server).toContain('nip98:');
    expect(server).not.toContain("name: 'X-API-Key'");
    expect(server).not.toContain("title: 'Agentic Flow Management API'");
  });

  test('owned interfaces implement the shared semantic token contract', () => {
    for (const css of [cockpitCss, setupCss]) {
      for (const token of ['accent', 'focus', 'surface', 'foreground', 'muted', 'success', 'warning', 'danger', 'radius']) {
        expect(css).toContain(`--agentbox-${token}:`);
      }
    }
  });
});
