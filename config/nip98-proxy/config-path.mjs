// Which boot-config file the proxy may read (AB-36.1, ADR-2122).
//
// Flag off the proxy is devuser (uid 1000) and reads the workspace file as it
// always did. Under [security].role_isolation it is the ab-ingress role: the
// workspace directory is devuser-writable, and the proxy reloads whatever sits
// at its path, so a non-1000 uid may read ONLY a file inside its own secrets
// directory. That directory arrives as AGENTBOX_SECRETS_DIR, which the role
// render (role_accounts.rs) injects into the program's environment= at start,
// so the path is fixed from the first instant and does not depend on Stage B
// having created anything yet: until the entrypoint projects the file the door
// is simply PENDING.

import { posix } from 'node:path';

export const WORKSPACE_CONFIG = '/home/devuser/workspace/.agentbox/nip98-proxy-config.json';
const FILE_NAME = 'nip98-proxy-config.json';

/**
 * @param {{ env: Record<string,string|undefined>, uid: number }} args
 * @returns {{ file: string|null }} null means "no permitted file": pending.
 */
export function resolveConfigPath({ env, uid }) {
  if (uid === 1000) return { file: env.NIP98_PROXY_CONFIG_FILE || WORKSPACE_CONFIG };
  const dir = env.AGENTBOX_SECRETS_DIR;
  if (!dir || !posix.isAbsolute(dir)) return { file: null };
  const base = posix.normalize(dir).replace(/\/+$/, '');
  if (base === '') return { file: null };
  const want = env.NIP98_PROXY_CONFIG_FILE || posix.join(base, FILE_NAME);
  const norm = posix.normalize(want);
  // Textual `..` must not smuggle a path out of the directory.
  if (want.split('/').includes('..') || !norm.startsWith(`${base}/`)) return { file: null };
  return { file: norm };
}
