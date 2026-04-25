'use strict';

/**
 * Semantic rule tests for agentbox config validate (E001-E016).
 * Each rule has one invalid fixture (triggers the error) and one valid fixture.
 * The validator is called as a module function to avoid subprocess overhead.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const VALIDATOR = path.join(__dirname, '..', '..', 'scripts', 'agentbox-config-validate.js');
const SCHEMA_PATH = path.join(__dirname, '..', '..', 'schema', 'agentbox.toml.schema.json');

const TOML = require('@iarna/toml');
const fs = require('fs');
const os = require('os');

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Write a TOML fixture to a temp file, run the validator on it, capture stderr.
 * Returns { exitCode, stderr }.
 */
function runValidator(manifest, envOverrides = {}) {
  const tmp = path.join(os.tmpdir(), `agentbox-test-${Date.now()}-${Math.random().toString(36).slice(2)}.toml`);
  fs.writeFileSync(tmp, TOML.stringify(manifest), 'utf8');
  try {
    const result = execFileSync(process.execPath, [VALIDATOR, tmp], {
      env: { ...process.env, ...envOverrides },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    fs.unlinkSync(tmp);
    return { exitCode: 0, stderr: '', stdout: result };
  } catch (err) {
    fs.unlinkSync(tmp);
    return { exitCode: err.status || 1, stderr: err.stderr || '', stdout: err.stdout || '' };
  }
}

function stderrContains(result, code) {
  return result.stderr.includes(code);
}

// ─── baseline valid manifest ───────────────────────────────────────────────────

function baseValid() {
  return {
    core: { orchestration: 'ruflo-v3', vector_db: 'ruvector-embedded' },
    federation: { mode: 'standalone', external_url: '' },
    adapters: {
      beads: 'local-sqlite',
      pods: 'local-solid-rs',
      memory: 'embedded-ruvector',
      events: 'local-jsonl',
      orchestrator: 'local-process-manager'
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
      enabled: true,
      solid_pod: false,
      nostr_bridge: false,
      https_bridge: false,
      telegram_mirror: false
    },
    // playwright=true and pods=local-solid-rs both require security
    // exception blocks (W021); declare both so the baseline is silent.
    security: {
      exceptions: {
        playwright: {
          cap_add: ['SYS_ADMIN'],
          reason: 'chromium sandbox'
        },
        'solid-pod-rs': {
          writable_volumes: ['/var/lib/solid'],
          reason: 'solid-pod-rs filesystem backend (ADR-010)'
        }
      }
    }
  };
}

// ─── E001 ─────────────────────────────────────────────────────────────────────
describe('E001: external adapter requires federation.mode=client + external_url', () => {
  test('invalid: beads=external without federation.mode=client', () => {
    const m = baseValid();
    m.adapters.beads = 'external';
    // federation.mode remains standalone, no external_url
    const r = runValidator(m);
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E001')).toBe(true);
  });

  test('valid: beads=external with federation.mode=client and external_url set', () => {
    const m = baseValid();
    m.adapters.beads = 'external';
    m.federation.mode = 'client';
    m.federation.external_url = 'http://host-mesh:9090';
    // no providers enabled, no env vars needed
    const r = runValidator(m);
    // E012 warning expected (client + local-* adapters for other slots), but not E001
    expect(stderrContains(r, 'E001')).toBe(false);
  });
});

// ─── E002 ─────────────────────────────────────────────────────────────────────
describe('E002: memory=external-pg requires integrations.ruvector_external.conninfo', () => {
  test('invalid: memory=external-pg without conninfo', () => {
    const m = baseValid();
    m.adapters.memory = 'external-pg';
    m.federation.mode = 'client';
    m.federation.external_url = 'http://host:9090';
    const r = runValidator(m);
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E002')).toBe(true);
  });

  test('valid: memory=external-pg with conninfo', () => {
    const m = baseValid();
    m.adapters.memory = 'external-pg';
    m.federation.mode = 'client';
    m.federation.external_url = 'http://host:9090';
    m.integrations = { ruvector_external: { enabled: true, conninfo: 'postgresql://user:pass@ruvector:5432/ruvector' } };
    const r = runValidator(m);
    expect(stderrContains(r, 'E002')).toBe(false);
  });
});

// ─── E003 ─────────────────────────────────────────────────────────────────────
describe('E003: orchestrator=stdio-bridge must not also bind an HTTP port', () => {
  test('invalid: orchestrator=stdio-bridge with external_orchestrator.protocol=http', () => {
    const m = baseValid();
    m.adapters.orchestrator = 'stdio-bridge';
    m.federation.mode = 'client';
    m.federation.external_url = 'http://host:9090';
    m.integrations = { external_orchestrator: { enabled: true, protocol: 'http' } };
    const r = runValidator(m);
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E003')).toBe(true);
  });

  test('valid: orchestrator=stdio-bridge with protocol=stdio', () => {
    const m = baseValid();
    m.adapters.orchestrator = 'stdio-bridge';
    m.federation.mode = 'client';
    m.federation.external_url = 'http://host:9090';
    m.integrations = { external_orchestrator: { enabled: true, protocol: 'stdio' } };
    const r = runValidator(m);
    expect(stderrContains(r, 'E003')).toBe(false);
  });
});

// ─── E004 ─────────────────────────────────────────────────────────────────────
describe('E004: all-off adapters require federation.mode=standalone', () => {
  test('invalid: all adapters off without federation.mode=standalone', () => {
    const m = baseValid();
    m.adapters = { beads: 'off', pods: 'off', memory: 'off', events: 'off', orchestrator: 'off' };
    m.federation.mode = 'client';
    m.federation.external_url = 'http://host:9090';
    const r = runValidator(m);
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E004')).toBe(true);
  });

  test('valid: all adapters off with federation.mode=standalone', () => {
    const m = baseValid();
    m.adapters = { beads: 'off', pods: 'off', memory: 'off', events: 'off', orchestrator: 'off' };
    m.federation.mode = 'standalone';
    const r = runValidator(m);
    expect(stderrContains(r, 'E004')).toBe(false);
  });
});

// ─── E005 ─────────────────────────────────────────────────────────────────────
describe('E005: events=external requires integrations.external_events with an endpoint', () => {
  test('invalid: events=external without external_events section', () => {
    const m = baseValid();
    m.adapters.events = 'external';
    m.federation.mode = 'client';
    m.federation.external_url = 'http://host:9090';
    const r = runValidator(m);
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E005')).toBe(true);
  });

  test('valid: events=external with url in external_events', () => {
    const m = baseValid();
    m.adapters.events = 'external';
    m.federation.mode = 'client';
    m.federation.external_url = 'http://host:9090';
    m.integrations = { external_events: { enabled: true, url: 'http://events-bus:4000' } };
    const r = runValidator(m);
    expect(stderrContains(r, 'E005')).toBe(false);
  });
});

// ─── E006 ─────────────────────────────────────────────────────────────────────
describe('E006: gaussian_splatting requires gpu.backend=local-cuda', () => {
  test('invalid: gaussian_splatting=true with gpu.backend=none', () => {
    const m = baseValid();
    m.skills.spatial_and_3d.gaussian_splatting = true;
    m.gpu.backend = 'none';
    const r = runValidator(m);
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E006')).toBe(true);
  });

  test('valid: gaussian_splatting=true with gpu.backend=local-cuda (x86_64)', () => {
    const m = baseValid();
    m.skills.spatial_and_3d.gaussian_splatting = true;
    m.gpu.backend = 'local-cuda';
    const r = runValidator(m);
    // E008 may fire on non-x86_64, but E006 must not fire
    expect(stderrContains(r, 'E006')).toBe(false);
  });
});

// ─── E007 ─────────────────────────────────────────────────────────────────────
describe('E007: comfyui_builtin and comfyui_external cannot both be true', () => {
  test('invalid: both comfyui_builtin and comfyui_external true', () => {
    const m = baseValid();
    m.skills.media.comfyui_builtin = true;
    m.integrations = { comfyui_external: { enabled: true, url: 'http://comfyui:8188' } };
    const r = runValidator(m);
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E007')).toBe(true);
  });

  test('valid: only comfyui_builtin true', () => {
    const m = baseValid();
    m.skills.media.comfyui_builtin = true;
    m.integrations = { comfyui_external: { enabled: false, url: 'http://comfyui:8188' } };
    const r = runValidator(m);
    expect(stderrContains(r, 'E007')).toBe(false);
  });
});

// ─── E008 ─────────────────────────────────────────────────────────────────────
describe('E008: gpu.backend=local-cuda is x86_64 only', () => {
  test('valid: gpu.backend=local-cuda on current arch (no error on x86_64)', () => {
    const m = baseValid();
    m.gpu.backend = 'local-cuda';
    const r = runValidator(m);
    const arch = process.arch;
    if (arch === 'x64') {
      expect(stderrContains(r, 'E008')).toBe(false);
    } else {
      // On non-x86_64, E008 must fire
      expect(stderrContains(r, 'E008')).toBe(true);
    }
  });

  test('valid: gpu.backend=none — no E008', () => {
    const m = baseValid();
    m.gpu.backend = 'none';
    const r = runValidator(m);
    expect(stderrContains(r, 'E008')).toBe(false);
  });
});

// ─── E009 (deprecated alias → E017) ──────────────────────────────────────────
// Resolution: E009 and E017 describe the same rule ("every enabled provider must
// have its env_var present"). E009 was the original code used during the initial
// provider-credential design; it was superseded and renumbered to E017 when the
// provider loop was reimplemented (see validator line 186 comment).
// Canonical code: E017. E009 is a deprecated alias — the validator emits E017.
// Tests below assert the canonical E017 behaviour under the E009 semantic label.
describe('E009 (→ E017 canonical): every enabled provider must have env_var present', () => {
  test('invalid: enabled provider, env var unset in environment → E017 error contains provider name', () => {
    const m = baseValid();
    m.providers = { anthropic: { enabled: true, env_var: 'ANTHROPIC_API_KEY_TEST_E009', optional_env_vars: [] } };
    // Pass empty string so the env var is present-but-empty (falsy → E017 fires).
    const r = runValidator(m, { ANTHROPIC_API_KEY_TEST_E009: '' });
    expect(r.exitCode).not.toBe(0);
    // Canonical error code is E017 (E009 is the deprecated alias).
    expect(stderrContains(r, 'E017')).toBe(true);
    expect(r.stderr).toMatch(/anthropic/);
    expect(r.stderr).toMatch(/ANTHROPIC_API_KEY_TEST_E009/);
  });

  test('valid: enabled provider, env var set to non-empty value → no E017 error', () => {
    const m = baseValid();
    m.providers = { anthropic: { enabled: true, env_var: 'ANTHROPIC_API_KEY_TEST_E009', optional_env_vars: [] } };
    const r = runValidator(m, { ANTHROPIC_API_KEY_TEST_E009: 'sk-ant-real-key-value' });
    expect(stderrContains(r, 'E017')).toBe(false);
  });
});

// ─── E017 ─────────────────────────────────────────────────────────────────────
describe('E017: enabled provider requires its env_var to be present in the environment', () => {
  test('invalid: provider enabled but env var missing (empty string)', () => {
    const m = baseValid();
    m.providers = { anthropic: { enabled: true, env_var: 'ANTHROPIC_API_KEY_TEST_E017', optional_env_vars: [] } };
    const r = runValidator(m, { ANTHROPIC_API_KEY_TEST_E017: '' });
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E017')).toBe(true);
    expect(r.stderr).toMatch(/anthropic/);
    expect(r.stderr).toMatch(/ANTHROPIC_API_KEY_TEST_E017/);
  });

  test('valid: provider enabled and env var is non-empty', () => {
    const m = baseValid();
    m.providers = { openai: { enabled: true, env_var: 'OPENAI_API_KEY_TEST_E017', optional_env_vars: ['OPENAI_BASE_URL'] } };
    const r = runValidator(m, { OPENAI_API_KEY_TEST_E017: 'sk-test-real-looking-value' });
    expect(stderrContains(r, 'E017')).toBe(false);
  });
});

// ─── E018 ─────────────────────────────────────────────────────────────────────
describe('E018: enabled provider env_var must not contain a placeholder value', () => {
  test('invalid: env var set to placeholder "change-this"', () => {
    const m = baseValid();
    m.providers = { gemini: { enabled: true, env_var: 'GEMINI_KEY_TEST_E018', optional_env_vars: [] } };
    const r = runValidator(m, { GEMINI_KEY_TEST_E018: 'change-this' });
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E018')).toBe(true);
    expect(r.stderr).toMatch(/gemini/);
  });

  test('valid: env var set to a non-placeholder value', () => {
    const m = baseValid();
    m.providers = { perplexity: { enabled: true, env_var: 'PERPLEXITY_KEY_TEST_E018', optional_env_vars: [] } };
    const r = runValidator(m, { PERPLEXITY_KEY_TEST_E018: 'pplx-abc123realkey' });
    expect(stderrContains(r, 'E018')).toBe(false);
  });
});

// ─── E010 ─────────────────────────────────────────────────────────────────────
describe('E010: desktop.enabled=true forbids headless_only profiles', () => {
  // This rule reads /workspace/profiles/*/profile.toml at runtime.
  // On test machines that directory likely does not exist, so we test only
  // the negative path (no profiles dir → no E010 error).
  test('valid: desktop.enabled=true with no profiles directory present', () => {
    const m = baseValid();
    m.desktop.enabled = true;
    // /workspace/profiles is not present on CI, so E010 cannot fire
    const r = runValidator(m);
    expect(stderrContains(r, 'E010')).toBe(false);
  });

  test('valid: desktop.enabled=false — E010 never fires', () => {
    const m = baseValid();
    m.desktop.enabled = false;
    const r = runValidator(m);
    expect(stderrContains(r, 'E010')).toBe(false);
  });
});

// ─── E011 ─────────────────────────────────────────────────────────────────────
describe('E011: every enabled skill must exist in the skills-corpus', () => {
  test('invalid: unknown skill flag set to true', () => {
    const m = baseValid();
    // skills.browser.phantom_browser is not in KNOWN_SKILLS
    m.skills.browser.phantom_browser = true;
    const r = runValidator(m);
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E011')).toBe(true);
  });

  test('valid: only known skills enabled', () => {
    const m = baseValid();
    m.skills.browser.playwright = true;
    const r = runValidator(m);
    expect(stderrContains(r, 'E011')).toBe(false);
  });
});

// ─── E012 ─────────────────────────────────────────────────────────────────────
describe('E012: federation.mode=client with local-* adapter raises warning', () => {
  test('invalid: client mode with local-sqlite beads', () => {
    const m = baseValid();
    m.federation.mode = 'client';
    m.federation.external_url = 'http://host:9090';
    m.adapters.beads = 'local-sqlite';
    const r = runValidator(m);
    // E012 is a warning that produces an error code output
    expect(stderrContains(r, 'E012')).toBe(true);
  });

  test('valid: client mode with all external or off adapters', () => {
    const m = baseValid();
    m.federation.mode = 'client';
    m.federation.external_url = 'http://host:9090';
    m.adapters = {
      beads: 'external',
      pods: 'external',
      memory: 'external-pg',
      events: 'external',
      orchestrator: 'off'
    };
    m.integrations = {
      ruvector_external: { enabled: true, conninfo: 'postgresql://user:pass@pg:5432/rv' },
      external_events: { enabled: true, url: 'http://events:4000' }
    };
    const r = runValidator(m);
    expect(stderrContains(r, 'E012')).toBe(false);
  });
});

// ─── E013 ─────────────────────────────────────────────────────────────────────
describe('E013: observability.metrics_port must not collide with reserved ports', () => {
  test('invalid: metrics_port=9090 collides with management-api', () => {
    const m = baseValid();
    m.observability.metrics_port = 9090;
    const r = runValidator(m);
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E013')).toBe(true);
  });

  test('valid: metrics_port=9091 (default, no collision)', () => {
    const m = baseValid();
    m.observability.metrics_port = 9091;
    const r = runValidator(m);
    expect(stderrContains(r, 'E013')).toBe(false);
  });
});

// ─── E014 ─────────────────────────────────────────────────────────────────────
describe('E014: sovereign_mesh.telegram_mirror requires CTM env vars', () => {
  test('invalid: telegram_mirror=true without CTM_BOT_TOKEN', () => {
    const m = baseValid();
    m.sovereign_mesh.telegram_mirror = true;
    const r = runValidator(m, { CTM_BOT_TOKEN: '', CTM_TELEGRAM_CHAT_ID: '' });
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E014')).toBe(true);
  });

  test('valid: telegram_mirror=true with both CTM env vars set', () => {
    const m = baseValid();
    m.sovereign_mesh.telegram_mirror = true;
    const r = runValidator(m, { CTM_BOT_TOKEN: 'bot123:abc', CTM_TELEGRAM_CHAT_ID: '-1001234567890' });
    expect(stderrContains(r, 'E014')).toBe(false);
  });
});

// ─── E015 retired 2026-04-25 ──────────────────────────────────────────────────
// Was: `sovereign_mesh.jss_rust_backend = true` requires the `jss-rust` Nix
// flake input pinned in flake.lock. The flake input was never declared and
// the field had no consumer; the Rust pod adoption shipped as `solid-pod-rs`
// (ADR-010) instead. Schema property dropped, validator rule removed.

// ─── E019 ─────────────────────────────────────────────────────────────────────
describe('E019: [toolchains.cuda]=true requires [gpu.backend]="local-cuda"', () => {
  test('invalid: toolchains.cuda=true with gpu.backend=none', () => {
    const m = baseValid();
    m.toolchains.cuda = true;
    m.gpu.backend = 'none';
    const r = runValidator(m);
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E019')).toBe(true);
    expect(r.stderr).toMatch(/E019 \[toolchains\.cuda\]=true requires \[gpu\.backend\]="local-cuda"/);
  });

  test('valid: toolchains.cuda=true with gpu.backend=local-cuda', () => {
    const m = baseValid();
    m.toolchains.cuda = true;
    m.gpu.backend = 'local-cuda';
    const r = runValidator(m);
    // E008 may fire on non-x86_64 but E019 must not fire
    expect(stderrContains(r, 'E019')).toBe(false);
  });
});

// ─── E020 ─────────────────────────────────────────────────────────────────────
describe('E020: security exception block declared but feature gate not enabled', () => {
  test('invalid: security.exceptions.desktop declared but desktop.enabled=false', () => {
    const m = baseValid();
    m.desktop = { enabled: false, stack: 'x11-openbox', resolution: '1920x1080' };
    m.security = {
      exceptions: {
        desktop: { tmpfs: ['/tmp/.X11-unix', '/run/user/1000'] }
      }
    };
    const r = runValidator(m);
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E020')).toBe(true);
    expect(r.stderr).toMatch(/security\.exceptions\.desktop/);
  });

  test('valid: security.exceptions.playwright declared and skills.browser.playwright=true', () => {
    const m = baseValid();
    m.skills.browser.playwright = true;
    m.security = {
      exceptions: {
        playwright: { cap_add: ['SYS_ADMIN'], reason: 'chromium sandbox' }
      }
    };
    const r = runValidator(m);
    expect(stderrContains(r, 'E020')).toBe(false);
  });
});

// ─── W021 ─────────────────────────────────────────────────────────────────────
describe('W021: feature enabled but security exception block is missing', () => {
  test('invalid: desktop.enabled=true but no security.exceptions.desktop block', () => {
    const m = baseValid();
    m.desktop = { enabled: true, stack: 'x11-openbox', resolution: '1920x1080' };
    // No security.exceptions.desktop declared
    m.security = { exceptions: {} };
    const r = runValidator(m);
    expect(stderrContains(r, 'W021')).toBe(true);
    expect(r.stderr).toMatch(/security\.exceptions\.desktop/);
  });

  test('valid: desktop.enabled=true and security.exceptions.desktop is declared', () => {
    const m = baseValid();
    m.desktop = { enabled: true, stack: 'x11-openbox', resolution: '1920x1080' };
    // Carry the baseValid exceptions (playwright, solid-pod-rs) and add desktop.
    m.security.exceptions.desktop = { tmpfs: ['/tmp/.X11-unix', '/run/user/1000'] };
    const r = runValidator(m);
    expect(stderrContains(r, 'W021')).toBe(false);
  });
});

// ─── E020 / W021 hardening exception edge cases ───────────────────────────────

// Edge case 1 (QE): key typo in security.exceptions creates a silent non-match.
// [security.exceptions.playwrigt] (typo) with skills.browser.playwright=true:
// E020 does NOT fire (the typo'd key "playwrigt" is unknown — not a documented
// exception name — so isFeatureActive("playwrigt") returns false → E020 fires
// for the orphaned typo'd block). W021 also fires because playwright is enabled
// but its correct exception key is missing.
describe('E020/W021 edge case: typo in exception key creates silent non-match', () => {
  test('W021 fires for the correctly-spelled feature; E020 fires for the typo\'d orphan key', () => {
    const m = baseValid();
    m.skills.browser.playwright = true;
    // Typo: "playwrigt" instead of "playwright"
    m.security = {
      exceptions: {
        playwrigt: { cap_add: ['SYS_ADMIN'], reason: 'chromium sandbox (typo)' }
      }
    };
    const r = runValidator(m);
    expect(r.exitCode).not.toBe(0);
    // W021 must fire: playwright is enabled but no correctly-spelled exception block exists.
    expect(stderrContains(r, 'W021')).toBe(true);
    expect(r.stderr).toMatch(/security\.exceptions\.playwright/);
    // E020 must fire: the typo'd block "playwrigt" has no matching enabled feature.
    expect(stderrContains(r, 'E020')).toBe(true);
    expect(r.stderr).toMatch(/security\.exceptions\.playwrigt/);
  });
});

// Edge case 2 (QE): multi-feature cap_add deduplication.
// Both desktop and playwright exceptions are active. If both declare SYS_ADMIN
// in cap_add, the validator must accept the manifest without flagging duplicates
// (union is monotone; the compose generator deduplicates at emit time).
// This test asserts only the validator acceptance — the Nix eval step is skipped.
describe('E020/W021 edge case: multi-feature with overlapping cap_add accepted by validator', () => {
  test.skip('validator accepts manifest with SYS_ADMIN in both desktop and playwright cap_add (Nix eval skipped)', () => {
    // Skipped: compose deduplication assertion requires a real Nix eval step.
    // Validator-only assertion is covered by the non-skipped sibling below.
  });

  test('validator accepts manifest where both desktop and playwright exceptions declare SYS_ADMIN', () => {
    const m = baseValid();
    m.desktop = { enabled: true, stack: 'x11-openbox', resolution: '1920x1080' };
    m.skills.browser.playwright = true;
    // Replace the desktop+playwright entries; keep the solid-pod-rs entry from baseValid.
    m.security.exceptions.desktop = { cap_add: ['SYS_ADMIN'], tmpfs: ['/tmp/.X11-unix:mode=1777,rw'], reason: 'test injection — desktop+playwright overlap' };
    m.security.exceptions.playwright = { cap_add: ['SYS_ADMIN'], reason: 'chromium sandbox' };
    const r = runValidator(m);
    // Neither E020 (orphaned block) nor W021 (missing block) should fire.
    expect(stderrContains(r, 'E020')).toBe(false);
    expect(stderrContains(r, 'W021')).toBe(false);
  });
});

// Edge case 3 (QE): all 7 known exception keys fire E020 when their feature is disabled.
// Parametrised loop over the full known-exception set.
describe('E020 edge case: all 7 exception keys fire E020 when parent feature is disabled', () => {
  const EXCEPTION_FIXTURES = [
    {
      exceptionKey: 'desktop',
      featureName: 'desktop',
      manifestPatch: (m) => { m.desktop = { enabled: false, stack: 'x11-openbox', resolution: '1920x1080' }; },
      exceptionBlock: { tmpfs: ['/tmp/.X11-unix:mode=1777,rw'], reason: 'test' }
    },
    {
      exceptionKey: 'gpu-rocm',
      featureName: 'gpu-rocm',
      manifestPatch: (m) => { m.gpu.backend = 'none'; },
      exceptionBlock: { devices: ['/dev/kfd:/dev/kfd'], reason: 'test' }
    },
    {
      exceptionKey: 'gpu-cuda',
      featureName: 'gpu-cuda',
      manifestPatch: (m) => { m.gpu.backend = 'none'; },
      exceptionBlock: { runtime_override: 'nvidia', reason: 'test' }
    },
    {
      exceptionKey: 'gaussian-splatting',
      featureName: 'gaussian-splatting',
      manifestPatch: (m) => { m.skills.spatial_and_3d.gaussian_splatting = false; },
      exceptionBlock: { cap_add: [], reason: 'test' }
    },
    {
      exceptionKey: 'playwright',
      featureName: 'playwright',
      // Override baseValid which has playwright=true — disable it here.
      manifestPatch: (m) => { m.skills.browser.playwright = false; },
      exceptionBlock: { cap_add: ['SYS_ADMIN'], reason: 'test' }
    },
    {
      exceptionKey: 'code-server',
      featureName: 'code-server',
      manifestPatch: (m) => {
        if (!m.toolchains) m.toolchains = {};
        m.toolchains.code_server = false;
      },
      exceptionBlock: { writable_volumes: ['/workspace/.local/share/code-server'], reason: 'test' }
    },
    {
      exceptionKey: 'telegram-mirror',
      featureName: 'telegram-mirror',
      manifestPatch: (m) => { m.sovereign_mesh.telegram_mirror = false; },
      exceptionBlock: { writable_volumes: ['/workspace/.config/claude-telegram-mirror'], reason: 'test' }
    }
  ];

  for (const { exceptionKey, featureName, manifestPatch, exceptionBlock } of EXCEPTION_FIXTURES) {
    test(`E020 fires for [security.exceptions.${exceptionKey}] when ${featureName} is disabled`, () => {
      const m = baseValid();
      // Disable the parent feature.
      manifestPatch(m);
      // Declare the exception block with the feature disabled.
      m.security = {
        exceptions: {
          // playwright must also be handled since baseValid enables it.
          // Keep the playwright block from baseValid unless we're testing playwright itself.
          ...(exceptionKey !== 'playwright' ? { playwright: { cap_add: ['SYS_ADMIN'], reason: 'chromium sandbox' } } : {}),
          [exceptionKey]: exceptionBlock
        }
      };
      const r = runValidator(m);
      expect(r.exitCode).not.toBe(0);
      expect(stderrContains(r, 'E020')).toBe(true);
      expect(r.stderr).toMatch(new RegExp(`security\\.exceptions\\.${exceptionKey.replace('-', '\\-')}`));
    });
  }
});

// ─── skills.ontology gate ─────────────────────────────────────────────────────
describe('skills.ontology gate: enabled defaults to false and parses cleanly', () => {
  test('valid: skills.ontology.enabled=false (default off)', () => {
    const m = baseValid();
    m.skills.ontology = { enabled: false };
    const r = runValidator(m);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('valid: skills.ontology.enabled=true parses without errors', () => {
    const m = baseValid();
    m.skills.ontology = { enabled: true };
    const r = runValidator(m);
    expect(stderrContains(r, 'E016')).toBe(false);
  });

  test('invalid: unknown key inside skills.ontology triggers E016', () => {
    const m = baseValid();
    m.skills.ontology = { enabled: false, unknown_key: true };
    const r = runValidator(m);
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E016')).toBe(true);
  });
});

// ─── E016 ─────────────────────────────────────────────────────────────────────
describe('E016: unknown manifest keys are rejected (UnknownManifestKey)', () => {
  test('invalid: unknown top-level key', () => {
    const m = baseValid();
    m.typo_section = { foo: true };
    const r = runValidator(m);
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E016')).toBe(true);
  });

  test('invalid: unknown key inside known section (skills.brower)', () => {
    const m = baseValid();
    // Add an unknown key inside a known section
    m.skills.brower = { chromium: true };
    const r = runValidator(m);
    expect(r.exitCode).not.toBe(0);
    expect(stderrContains(r, 'E016')).toBe(true);
  });

  test('valid: no unknown keys', () => {
    const m = baseValid();
    const r = runValidator(m);
    expect(r.exitCode).toBe(0);
    expect(stderrContains(r, 'E016')).toBe(false);
  });
});
