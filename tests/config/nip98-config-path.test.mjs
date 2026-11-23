// AB-36.1 (re-review item 2): which config file the proxy may read, as a function
// of uid and environment. Under role isolation the proxy is uid 962 and the
// workspace path is devuser-writable, so it must never be read there.
import assert from 'node:assert/strict';
import { resolveConfigPath } from '../../config/nip98-proxy/config-path.mjs';

const WS = '/home/devuser/workspace/.agentbox/nip98-proxy-config.json';
let n = 0; const ok = (name) => console.log(`ok ${++n} - ${name}`);

assert.deepEqual(resolveConfigPath({ env: {}, uid: 1000 }), { file: WS });
ok('devuser (1000), nothing set: the workspace default (flag-off behaviour unchanged)');
assert.deepEqual(resolveConfigPath({ env: { NIP98_PROXY_CONFIG_FILE: '/tmp/x.json' }, uid: 1000 }), { file: '/tmp/x.json' });
ok('devuser with an explicit path: that path');
assert.deepEqual(resolveConfigPath({ env: { AGENTBOX_SECRETS_DIR: '/run/secrets/ab-ingress' }, uid: 962 }),
  { file: '/run/secrets/ab-ingress/nip98-proxy-config.json' });
ok('role uid: the file in its own secrets dir, derived from the render-injected AGENTBOX_SECRETS_DIR');
assert.equal(resolveConfigPath({ env: {}, uid: 962 }).file, null);
ok('role uid with no secrets dir: no file (pending), never the workspace path');
assert.equal(resolveConfigPath({ env: { NIP98_PROXY_CONFIG_FILE: WS, AGENTBOX_SECRETS_DIR: '/run/secrets/ab-ingress' }, uid: 962 }).file, null);
ok('role uid pointed at the workspace path: refused');
assert.equal(resolveConfigPath({ env: { NIP98_PROXY_CONFIG_FILE: '/run/secrets/ab-ingress/../../home/x.json', AGENTBOX_SECRETS_DIR: '/run/secrets/ab-ingress' }, uid: 962 }).file, null);
ok('role uid: a path that only starts with the secrets dir textually (..) is refused');
assert.equal(resolveConfigPath({ env: { NIP98_PROXY_CONFIG_FILE: '/run/secrets/ab-ingress/c.json', AGENTBOX_SECRETS_DIR: '/run/secrets/ab-ingress' }, uid: 962 }).file, '/run/secrets/ab-ingress/c.json');
ok('role uid: an explicit path inside its secrets dir is allowed');
assert.equal(resolveConfigPath({ env: { AGENTBOX_SECRETS_DIR: '/run/secrets/ab-ingress/' }, uid: 962 }).file, '/run/secrets/ab-ingress/nip98-proxy-config.json');
ok('a trailing slash on AGENTBOX_SECRETS_DIR is normalised');
assert.equal(resolveConfigPath({ env: { NIP98_PROXY_CONFIG_FILE: '/run/secrets/ab-ingress/c.json', AGENTBOX_SECRETS_DIR: '/run/secrets/ab-ingress//' }, uid: 962 }).file, '/run/secrets/ab-ingress/c.json');
ok('an explicit in-dir path is still accepted when the dir has trailing slashes');
assert.equal(resolveConfigPath({ env: { NIP98_PROXY_CONFIG_FILE: '/run/secrets/ab-ingress-evil/c.json', AGENTBOX_SECRETS_DIR: '/run/secrets/ab-ingress/' }, uid: 962 }).file, null);
ok('a sibling directory sharing the name prefix is refused');
console.log(`1..${n}`);
