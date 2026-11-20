// ADR-2207 D1: one display, locked 16:9, managed by a minimal window manager.
//
// Properties under test:
//   - supervisord declares an openbox program between xvfb and chromium in start
//     order, as devuser, on DISPLAY :2, autorestarting, with the shipped config;
//   - every program that touches the X display agrees on :2 (and the image/compose
//     defaults do too);
//   - the shipped openbox config is well-formed XML (openbox silently falls back to
//     its defaults, key and mouse bindings included, on a parse error), has no key
//     or mouse bindings, one desktop, no decorations, maximises normal windows and
//     focuses new ones;
//   - display.js (Node side) accepts and rejects exactly what display-env.sh does;
//   - x11vnc keeps 5903 and gets no client-driven resize option;
//   - the Dockerfile installs openbox, ships every new file it references, and does
//     not pin a size that differs from the helper default.
// Run: node --test tests/browsercontainer/display-config.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../..');
const BC = path.join(REPO, 'browsercontainer');
const read = (f) => fs.readFileSync(path.join(BC, f), 'utf8');

function parseIni(text) {
  const sections = {};
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const m = line.match(/^\[(.+)\]$/);
    if (m) { cur = sections[m[1]] = {}; continue; }
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (kv && cur) cur[kv[1].trim()] = kv[2].trim();
  }
  return sections;
}
const sup = parseIni(read('supervisord.conf'));
const prog = (n) => sup[`program:${n}`];

test('openbox runs between xvfb and chromium, as devuser on :2, with the shipped config', () => {
  const ob = prog('openbox');
  assert.ok(ob, 'supervisord declares [program:openbox]');
  const p = Number(ob.priority);
  assert.ok(p > Number(prog('xvfb').priority) && p < Number(prog('chromium').priority),
    `openbox priority ${p} sits between xvfb and chromium`);
  assert.equal(ob.user, 'devuser');
  assert.equal(ob.autorestart, 'true');
  assert.match(ob.environment, /DISPLAY=":2"/);
  assert.match(ob.command, /openbox --config-file \/opt\/browsercontainer\/openbox-rc\.xml/);
  assert.doesNotMatch(ob.command, /openbox-session/, 'plain openbox, no session autostart');
});

test('every program using the display agrees on :2', () => {
  assert.match(prog('xvfb').command, /^\/opt\/browsercontainer\/start-xvfb\.sh$/);
  assert.match(read('start-xvfb.sh'), /exec "\$\{XVFB_BIN:-Xvfb\}" :2 /);
  assert.match(prog('x11vnc').command, /-display :2(\s|$)/);
  for (const n of ['chromium', 'openbox', 'mcp-server']) {
    assert.match(prog(n).environment, /DISPLAY=":2"/, `${n} DISPLAY`);
  }
  const displays = new Set();
  for (const [name, sec] of Object.entries(sup)) {
    for (const v of [sec.command || '', sec.environment || '']) {
      for (const m of v.matchAll(/(?:DISPLAY="|-display |Xvfb )(:\d+)/g)) displays.add(`${m[1]}`);
      void name;
    }
  }
  assert.deepEqual([...displays], [':2']);
  assert.match(read('Dockerfile'), /DISPLAY=:2/);
  assert.match(fs.readFileSync(path.join(REPO, 'docker-compose.browsercontainer.yml'), 'utf8'), /- DISPLAY=:2/);
});

test('x11vnc keeps 5903 and offers no client-driven resize', () => {
  const cmd = prog('x11vnc').command;
  assert.match(cmd, /-rfbport 5903/);
  assert.doesNotMatch(cmd, /-xrandr|-geometry|-scale|-clip|-padgeom/);
});

test('openbox config: valid XML, no bindings, one desktop, undecorated, maximised, focus new', () => {
  const file = path.join(BC, 'openbox-rc.xml');
  const xml = fs.readFileSync(file, 'utf8');
  const parse = spawnSync('python3', ['-I', '-c',
    'import sys, xml.dom.minidom as m; m.parse(sys.argv[1]); print("ok")', file], { encoding: 'utf8' });
  assert.equal(parse.status, 0, `openbox-rc.xml is well-formed XML: ${parse.stderr}`);
  assert.match(xml, /<openbox_config xmlns="http:\/\/openbox\.org\/3\.4\/rc"/);
  assert.doesNotMatch(xml, /<keybind\b/, 'no key bindings');
  assert.doesNotMatch(xml, /<mousebind\b/, 'no mouse bindings');
  assert.match(xml, /<desktops>[\s\S]*<number>1<\/number>[\s\S]*<\/desktops>/);
  assert.match(xml, /<focusNew>yes<\/focusNew>/);
  const normal = xml.match(/<application type="normal">([\s\S]*?)<\/application>/);
  assert.ok(normal, 'a rule for every normal window');
  assert.match(normal[1], /<decor>no<\/decor>/);
  assert.match(normal[1], /<maximized>yes<\/maximized>/);
  assert.match(normal[1], /<focus>yes<\/focus>/);
  const dialog = xml.match(/<application type="dialog">([\s\S]*?)<\/application>/);
  assert.ok(dialog, 'dialogs have a rule');
  assert.doesNotMatch(dialog[1], /<maximized>/, 'dialogs keep their own size');
  assert.match(dialog[1], /<monitor>1<\/monitor>/, 'dialogs stay on the one screen');
});

test('display.js and display-env.sh accept and reject the same sizes', () => {
  const { parseDisplaySize } = require(path.join(BC, 'display.js'));
  const cases = ['1920x1080', '1280x720', '3840x2160', '2560x1440', '1600x900',
    '1920x1200', '1024x576', '4096x2304', 'abc', '1920x', 'x1080', '01920x01080',
    '1920X1080', '-1920x-1080', '1920x1080x24', ' 1920x1080', '1280x720.5', '', '3856x2169'];
  for (const c of cases) {
    const sh = spawnSync('bash', ['-c', '. "$1/display-env.sh" && echo "$BROWSER_DISPLAY_W $BROWSER_DISPLAY_H"', '_', BC],
      { encoding: 'utf8', env: { ...process.env, BROWSER_DISPLAY_SIZE: c } });
    let js;
    try { const d = parseDisplaySize(c === '' ? undefined : c); js = `${d.width} ${d.height}`; } catch { js = null; }
    const shOut = sh.status === 0 ? sh.stdout.trim() : null;
    assert.equal(js, shOut, `size '${c}': display.js ${js} vs display-env.sh ${shOut}`);
  }
  assert.deepEqual(parseDisplaySize(undefined), { width: 1920, height: 1080, size: '1920x1080' });
});

test('Dockerfile installs openbox and ships every new display file', () => {
  const df = read('Dockerfile');
  assert.match(df, /^\s+openbox \\$/m, 'openbox in the pacman list');
  for (const f of ['display-env.sh', 'display.js', 'start-xvfb.sh', 'reset-view-state.js', 'openbox-rc.xml']) {
    assert.ok(fs.existsSync(path.join(BC, f)), `${f} exists in the build context`);
    assert.match(df, new RegExp(`COPY [^\\n]*\\b${f.replace('.', '\\.')} /opt/browsercontainer/${f.replace('.', '\\.')}`), `Dockerfile copies ${f}`);
  }
  assert.doesNotMatch(df, /BROWSER_DISPLAY_SIZE=(?!1920x1080\b)/, 'no image default that differs from the helper');
  void execFileSync;
});
