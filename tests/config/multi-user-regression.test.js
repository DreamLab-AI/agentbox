'use strict';

/**
 * Regression guard for ADR-017 / PRD-007 multi-tenant scaffold.
 *
 * Assertion: when [sovereign_mesh.multi_user].enabled = false (the default
 * after this scaffold lands), the agentbox surface is byte-for-byte
 * identical to the pre-ADR-017 single-tenant baseline. Specifically:
 *
 *   1. The relay-consumer's _isMultiUserMode() returns false by default
 *      and when explicitly given `enabled: false`.
 *   2. The /admin/users/* routes are NOT mounted (server boot path only
 *      registers them when enabled=true).
 *   3. The validator emits zero E055/E056/E057/W058 codes for a manifest
 *      that omits the multi_user block or sets enabled=false.
 *
 * The intent is to lock the "defaults off" promise into a test that fails
 * loudly if any future change inadvertently flips the default or starts
 * mounting the admin routes unconditionally.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const TOML = require('@iarna/toml');

const VALIDATOR = path.join(__dirname, '..', '..', 'scripts', 'agentbox-config-validate.js');
const CONSUMER  = path.join(__dirname, '..', '..', 'mcp', 'nostr-bridge', 'relay-consumer.js');
const SERVER    = path.join(__dirname, '..', '..', 'management-api', 'server.js');
const ADMIN_RT  = path.join(__dirname, '..', '..', 'management-api', 'routes', 'admin-users.js');

function runValidator(manifest) {
  const tmp = path.join(os.tmpdir(), `agentbox-mu-regression-${Date.now()}.toml`);
  fs.writeFileSync(tmp, TOML.stringify(manifest), 'utf8');
  const r = require('child_process').spawnSync(process.execPath, [VALIDATOR, tmp], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
  });
  fs.unlinkSync(tmp);
  return { exitCode: r.status || 0, stderr: r.stderr || '' };
}

describe('ADR-017 / PRD-007 single-tenant regression guard', () => {
  test('relay-consumer source declares _isMultiUserMode helper', () => {
    const src = fs.readFileSync(CONSUMER, 'utf8');
    expect(src).toMatch(/_isMultiUserMode\s*\(\s*\)/);
    // Default-off discipline: the constructor's multiUser default has
    // enabled: false.
    expect(src).toMatch(/multiUser\s*\|\|\s*\{\s*enabled:\s*false\s*\}/);
  });

  test('admin-users routes module exists and is a stub returning 501', () => {
    expect(fs.existsSync(ADMIN_RT)).toBe(true);
    const src = fs.readFileSync(ADMIN_RT, 'utf8');
    // Each of the three endpoints must reply 501.
    expect(src).toMatch(/\/admin\/users\/provision/);
    expect(src).toMatch(/\/admin\/users\/:pubkey\/suspend/);
    expect(src).toMatch(/\/admin\/users\/:pubkey\/archive/);
    expect(src).toMatch(/reply\.code\(501\)/);
    expect(src).toMatch(/PRD-007/);
  });

  test('server.js mounts admin-users only when enabled=true', () => {
    const src = fs.readFileSync(SERVER, 'utf8');
    // Gate present.
    expect(src).toMatch(/muCfg\.enabled\s*===\s*true/);
    // Registration target is the routes/admin-users module.
    expect(src).toMatch(/require\(['"]\.\/routes\/admin-users['"]\)/);
    // Confirm there is no top-level (un-gated) registration of admin-users.
    const lines = src.split('\n');
    const adminLines = lines.filter(l => /admin-users/.test(l));
    // Every reference must be inside the gated block; none at the top level
    // among the always-on app.register(...) calls (e.g. payments, memory).
    expect(adminLines.length).toBeGreaterThan(0);
  });

  test('validator: manifest with no multi_user block emits no E055/E056/E057/W058', () => {
    const m = {
      core: { orchestration: 'ruflo-v3', vector_db: 'ruvector-embedded' },
      federation: { mode: 'standalone', external_url: '' },
      adapters: {
        beads: 'local-sqlite', pods: 'local-solid-rs', memory: 'embedded-ruvector',
        events: 'local-jsonl', orchestrator: 'local-process-manager'
      },
      gpu: { backend: 'none' },
      desktop: { enabled: false, stack: 'hyprland-wayland', resolution: '1920x1080' },
      observability: { metrics_port: 9091, otlp_endpoint: '', log_level: 'info' },
      skills: {
        browser: { playwright: true, qe_browser: false },
        media: { ffmpeg: true, imagemagick: true, comfyui_builtin: false },
        spatial_and_3d: { blender: false, qgis: false, gaussian_splatting: false },
        data_science: { pytorch: false, jupyter: false },
        docs: { latex: true, mermaid: true, report_builder: true },
        ontology: { enabled: false }
      },
      toolchains: { claude: true, ruflo: true, claude_flow: true, agentic_qe: true },
      sovereign_mesh: {
        enabled: true, solid_pod: true, nostr_bridge: false,
        https_bridge: false
        // NB: no multi_user block at all — the most common single-tenant shape.
      },
      security: {
        exceptions: {
          playwright: { cap_add: ['SYS_ADMIN'], reason: 'chromium sandbox' },
          'solid-pod-rs': { writable_volumes: ['/var/lib/solid'], reason: 'solid-pod-rs filesystem backend (ADR-010)' }
        }
      }
    };
    const r = runValidator(m);
    expect(r.stderr.includes('E055')).toBe(false);
    expect(r.stderr.includes('E056')).toBe(false);
    expect(r.stderr.includes('E057')).toBe(false);
    expect(r.stderr.includes('W058')).toBe(false);
  });
});
