'use strict';

const { test, expect, chromium } = require('@playwright/test');
const axePath = require.resolve('axe-core/axe.min.js');
const cdpUrl = process.env.BROWSER_CDP_URL || 'http://browsercontainer:9224';
const webHost = process.env.WEB_TEST_HOST || 'agentbox';

async function remotePage(viewport) {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = await browser.newContext({
    viewport,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  return { page, context };
}

async function assertAxe(page) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(async () => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  }));
  expect(result.violations, result.violations.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
}

async function mockCockpit(page) {
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/embed', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body style="margin:0;background:#020617;color:#94a3b8;font:14px system-ui;display:grid;place-items:center;height:100%">Voice controls connect when Unmute is available.</body></html>',
  }));
  await page.route('**/bridge/health', (route) => json(route, { ok: true, backend: 'ready', model: 'operator', turns: 3 }));
  await page.route('**/api/v1/health', (route) => json(route, { ok: true }));
  await page.route('**/bridge/nostr/status', (route) => json(route, { gateway: 'armed', mirrorKey: true }));
  await page.route('**/bridge/nostr/events**', (route) => json(route, { events: [] }));
  await page.route('**/aoe/api/sessions**', (route) => json(route, { sessions: [
    { id: 'tab0', title: 'tab0 coordinator', agent: 'claude', state: 'running', branch: 'main', updated_at: new Date().toISOString() },
    { id: 'codex-1', title: 'web hardening', agent: 'codex', state: 'waiting', branch: 'web-surfaces', updated_at: new Date().toISOString() },
  ], coordinator: 'tab0' }));
  await page.route('**/approvals/v1/approvals', (route) => json(route, { approvals: [
    { id: 'approval-1', title: 'Publish release manifest', priority: 'high', requester_pubkey: '0123456789abcdef', action_class: 'publish', target: 'release:v1' },
  ] }));
  await page.route('**/mgmt/v1/system', (route) => json(route, {
    surfaces: [
      { id: 'management-api', state: 'on' }, { id: 'linked-data-viewer', state: 'on' },
      { id: 'code-server', state: 'on' }, { id: 'jupyter', state: 'on' }, { id: 'desktop', state: 'on' },
    ], modules: [],
  }));
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`cockpit ${viewport.name}: accessible and visually stable`, async () => {
    const { page, context } = await remotePage(viewport);
    await mockCockpit(page);
    await page.goto(`http://${webHost}:18081/`);
    await expect(page.getByText('web hardening')).toBeVisible();
    await assertAxe(page);
    const bodyWidth = await page.evaluate(() => ({ scroll: document.body.scrollWidth, client: document.body.clientWidth }));
    expect(bodyWidth.scroll).toBeLessThanOrEqual(bodyWidth.client);
    await expect(page).toHaveScreenshot(`cockpit-${viewport.name}.png`, { animations: 'disabled' });
    await context.close();
  });
}

test('setup wizard: accessible, dashboard-free, and visually stable', async () => {
  const { page, context } = await remotePage({ width: 1440, height: 1000 });
  await page.goto(`http://${webHost}:18082/`);
  await expect(page.getByText('Open agentbox.toml')).toBeVisible();
  await expect(page.getByText('Dashboard', { exact: true })).toHaveCount(0);
  await assertAxe(page);
  await expect(page).toHaveScreenshot('setup-wizard.png', { animations: 'disabled' });
  await context.close();
});
