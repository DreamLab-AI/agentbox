// redact.mjs — strip credential-shaped values from what is SENT to Jev (ADR-2093,
// amendment 2026-10-01). Applied to the request's state and questions only, after
// the library has built them; the engine's messages and the local transcript are
// never touched, so the "never rewrite text" invariant holds.
//
// Deliberately narrow: every rule is a recognisable credential shape or a named
// credential slot. Entropy guesses ("any 32+ char mixed string") are left out on
// purpose — they hit tool_use ids, content hashes and base64 payloads that Jev
// needs to correlate its questions with the state. Every pattern is linear in
// the input (bounded quantifiers, no nested repetition).

export const REDACTED = '[REDACTED]';

/** Credential shapes replaced whole. Lower bounds are short where the prefix is distinctive,
 * because the library truncates tool inputs to 1,000 / 200 / 60 chars and a cut token
 * still must not leak its head. */
const TOKENS = [
  /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----|$)/g, // PEM, also truncated
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g, // Anthropic
  /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, // OpenAI (and OpenAI-compatible)
  /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})/g, // GitHub
  /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, // AWS access key id
  /\bnsec1[02-9ac-hj-np-z]{20,}/g, // Nostr secret key (bech32)
  /\bxox[abeprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g, // Stripe secret / restricted
  /\b(?:npm_|hf_|glpat-)[A-Za-z0-9_-]{20,}/g, // npm, Hugging Face, GitLab
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
];

/** `Authorization: Bearer x`, `curl -H "Bearer x"`: keep the scheme, drop the credential. */
const AUTH_SCHEME = /\b(Bearer|Basic|Token)([ \t]{1,4})([A-Za-z0-9._~+/=-]{8,})/g;

/** `scheme://user:password@host`: keep the user, drop the password. */
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s/@:]{1,64}:)([^\s@/]{1,128})(@)/gi;

/** `AWS_SECRET_ACCESS_KEY=…`, `"apiKey": "…"`, `password: …`: keep the name, drop the value. */
const NAMED =
  /(\b[A-Za-z0-9_-]{0,40}(?:api[_-]?key|secret|token|passw(?:or)?d|private[_-]?key|access[_-]?key)[A-Za-z0-9_-]{0,20}["']?[ \t]{0,3}[:=][ \t]{0,3}["']?)([^\s"'`<>{}()[\],;\\]{8,})/gi;

/** `--token value`, `--api-key=value` on a command line. */
const FLAG =
  /(--[A-Za-z0-9-]{0,30}(?:api-?key|secret|token|passw(?:or)?d)[A-Za-z0-9-]{0,20}(?:=|[ \t]{1,3})["']?)([^\s"'`<>{}()[\],;\\]{8,})/gi;

/** A value after a credential name that is a reference or code, not a secret. */
function notASecret(value) {
  return (
    value.startsWith(REDACTED) ||
    /^[$%]/.test(value) || // $VAR, ${VAR}, %VAR%
    /^[/~.]/.test(value) || // a path
    /^(?:true|false|null|undefined|none|required|optional|string|number)$/i.test(value) ||
    /^[A-Za-z_][A-Za-z_.]*$/.test(value) // an identifier or member access: no digits, no symbols
  );
}

/**
 * Replace every credential-shaped substring of `text`.
 * @param {string} text
 * @param {readonly string[]} [known] exact values to remove wherever they appear (the plugin's own key)
 * @returns {{ text: string, count: number }}
 */
export function redactSecrets(text, known = []) {
  let count = 0;
  let out = text;
  for (const secret of known) {
    if (typeof secret !== 'string' || secret.length < 8) continue;
    const parts = out.split(secret);
    if (parts.length > 1) { count += parts.length - 1; out = parts.join(REDACTED); }
  }
  for (const pattern of TOKENS) out = out.replace(pattern, () => { count += 1; return REDACTED; });
  out = out.replace(AUTH_SCHEME, (m, scheme, gap, value) => {
    if (/^[A-Za-z]+$/.test(value)) return m; // prose: "Bearer authentication"
    count += 1;
    return `${scheme}${gap}${REDACTED}`;
  });
  out = out.replace(URL_CREDENTIALS, (m, head, value, at) => {
    if (value.includes(REDACTED)) return m;
    count += 1;
    return `${head}${REDACTED}${at}`;
  });
  for (const pattern of [NAMED, FLAG]) {
    out = out.replace(pattern, (m, name, value) => {
      if (notASecret(value)) return m;
      count += 1;
      return `${name}${REDACTED}`;
    });
  }
  return { text: out, count };
}

/**
 * Redact every string inside a JSON-shaped value (object keys untouched). Returns a copy.
 * @template T
 * @param {T} value
 * @param {readonly string[]} [known]
 * @returns {{ value: T, count: number }}
 */
export function redactDeep(value, known = []) {
  let count = 0;
  const walk = (v) => {
    if (typeof v === 'string') { const r = redactSecrets(v, known); count += r.count; return r.text; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  return { value: walk(value), count };
}
