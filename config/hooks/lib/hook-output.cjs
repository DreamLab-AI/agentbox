'use strict';

/**
 * hook-output.cjs — the one place that knows the stdout shape Claude Code honours
 * for context-injecting hooks.
 *
 * Claude Code reads injected context ONLY from
 *
 *   {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "…"}}
 *
 * A top-level `additionalContext` key (and the `result: "continue"` that used to
 * accompany it) is silently ignored — which is how three UserPromptSubmit hooks
 * injected nothing at all for their whole lives while looking healthy. Nothing to
 * inject means no stdout and exit 0: an empty stdout is the harness's "continue".
 *
 * `emitContext` resolves only once the bytes are flushed to the pipe, so a caller
 * that has a side effect contingent on delivery (dream-inbox marking an item as
 * surfaced) can order it strictly after a successful write.
 */

/** Serialise the honoured shape; `null` when there is nothing to inject. */
function contextPayload(additionalContext, hookEventName = 'UserPromptSubmit') {
  const ctx = typeof additionalContext === 'string' ? additionalContext.trim() : '';
  if (!ctx) return null;
  return JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: ctx } }) + '\n';
}

/**
 * Write the payload to `stream` (default stdout). Resolves `true` once flushed,
 * `false` when there was nothing to write or the write failed. Never rejects.
 */
function emitContext(additionalContext, { hookEventName = 'UserPromptSubmit', stream = process.stdout } = {}) {
  const payload = contextPayload(additionalContext, hookEventName);
  if (!payload) return Promise.resolve(false);
  return new Promise((resolve) => {
    // A reader that has gone away (EPIPE) is a failed delivery, not a crash.
    if (typeof stream.on === 'function' && !stream.listenerCount('error')) stream.on('error', () => resolve(false));
    try {
      stream.write(payload, (err) => resolve(!err));
    } catch {
      resolve(false);
    }
  });
}

module.exports = { contextPayload, emitContext };
