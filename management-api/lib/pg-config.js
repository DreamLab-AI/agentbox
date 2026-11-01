'use strict';

/**
 * pg-config — the one place a RuVector Postgres connection is assembled.
 *
 * The connection is the public parts (host, port, database, user) plus the
 * password read from ONE 0600 file. Nothing else carries the password: not an
 * environment variable, not a conninfo string, not a hook command, not an
 * MCP/Codex config. Every database client (the ruvector memory MCP server, the
 * management-api memory adapter, the maintenance scripts, the hooks) builds its
 * pool config here, so there is no second path to keep in step.
 *
 *   RUVECTOR_PG_HOST / _PORT / _DATABASE / _USER   public parts (defaults are
 *                                                  the compose service names)
 *   RUVECTOR_PG_PASSWORD_FILE                      path of the password file;
 *                                                  DEFAULT_PASSWORD_FILE when unset
 *
 * There is NO default password. A missing, empty or non-regular file throws an
 * error that names the path and never a value, so the caller fails closed.
 * The reader is role-secret's `readSecretFile` (bounded, regular files only),
 * not its resolver: the resolver's flag-off fallback to a plain env variable
 * would be exactly the parallel path this module exists to remove.
 */

const { readSecretFile } = require('./role-secret');

/** Where the entrypoint writes the password (devuser-owned, 0600, on the /run tmpfs). */
const DEFAULT_PASSWORD_FILE = '/run/secrets/ruvector-pg/password';

/** The manifest-time placeholder the shipped `conninfo` URL used to carry. */
const LEGACY_PLACEHOLDER = '@@RUVECTOR_PG_PASSWORD@@';

const DEFAULT_PARTS = Object.freeze({
  host: 'ruvector-postgres',
  port: 5432,
  database: 'ruvector',
  user: 'ruvector',
});

function passwordFileOf(env) {
  return String(env.RUVECTOR_PG_PASSWORD_FILE || '').trim() || DEFAULT_PASSWORD_FILE;
}

/**
 * The password, read from the one file.
 *
 * @param {object} [env=process.env]
 * @param {object} [opts]
 * @param {object} [opts.fsImpl] - injectable fs (tests)
 * @returns {string}
 * @throws {Error} naming the file path when it is absent, unreadable, not a
 *   regular file, oversized or empty
 */
function readPgPassword(env = process.env, opts = {}) {
  const file = passwordFileOf(env);
  let value;
  try {
    value = readSecretFile(file, opts.fsImpl);
  } catch (err) {
    throw new Error(`ruvector-postgres password unavailable: ${err.message} (set RUVECTOR_PG_PASSWORD_FILE or let the entrypoint write ${DEFAULT_PASSWORD_FILE})`);
  }
  if (!value) throw new Error(`ruvector-postgres password file ${file} is empty`);
  return value;
}

/**
 * The public parts of the connection, with the compose-service defaults.
 *
 * @param {object} [env=process.env]
 * @returns {{host:string, port:number, database:string, user:string}}
 */
function pgParts(env = process.env) {
  const port = parseInt(env.RUVECTOR_PG_PORT || String(DEFAULT_PARTS.port), 10);
  return {
    host: env.RUVECTOR_PG_HOST || DEFAULT_PARTS.host,
    port: Number.isFinite(port) ? port : DEFAULT_PARTS.port,
    database: env.RUVECTOR_PG_DATABASE || DEFAULT_PARTS.database,
    user: env.RUVECTOR_PG_USER || DEFAULT_PARTS.user,
  };
}

/**
 * A `pg` Pool/Client config: the parts plus the password from the file.
 * Callers spread their own pool options (`max`, timeouts) over the result.
 *
 * @param {object} [env=process.env]
 * @param {object} [opts] - see readPgPassword
 * @returns {{host:string, port:number, database:string, user:string, password:string}}
 */
function pgPoolConfig(env = process.env, opts = {}) {
  return { ...pgParts(env), password: readPgPassword(env, opts) };
}

/**
 * The management-api memory slot's pool config from the manifest's
 * `[integrations.ruvector_external].conninfo`. Only the host, port, database
 * and user are taken from the URL. A real password in it is refused: the
 * password has one source. The old `@@RUVECTOR_PG_PASSWORD@@` placeholder (or
 * no password) is accepted so an existing manifest keeps working.
 *
 * @param {string} conninfo - `postgresql://user[:placeholder]@host[:port]/db`
 * @param {object} [env=process.env]
 * @param {object} [opts] - see readPgPassword
 * @returns {{host:string, port:number, database:string, user:string, password:string}}
 */
function pgPoolConfigFromManifestConninfo(conninfo, env = process.env, opts = {}) {
  let url;
  try {
    url = new URL(String(conninfo));
  } catch (_) {
    throw new Error('integrations.ruvector_external.conninfo must be a postgresql://user@host:port/db URL');
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new Error('integrations.ruvector_external.conninfo must be a postgresql:// URL');
  }
  const pw = decodeURIComponent(url.password || '');
  if (pw && pw !== LEGACY_PLACEHOLDER) {
    throw new Error('integrations.ruvector_external.conninfo must not carry a password; the password comes only from RUVECTOR_PG_PASSWORD_FILE');
  }
  const base = pgParts(env);
  const port = url.port ? parseInt(url.port, 10) : base.port;
  return {
    host: url.hostname || base.host,
    port,
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || base.database,
    user: decodeURIComponent(url.username) || base.user,
    password: readPgPassword(env, opts),
  };
}

module.exports = {
  DEFAULT_PASSWORD_FILE,
  LEGACY_PLACEHOLDER,
  pgParts,
  readPgPassword,
  pgPoolConfig,
  pgPoolConfigFromManifestConninfo,
};
