'use strict';
/**
 * dm-parts — size caps without silent truncation, for every path that moves an
 * agent's text over Nostr or into another agent's session.
 *
 * Until 2026-11-18 those paths sliced with `.slice(0, N)` and said nothing: a
 * 500-char cap on instructions sent into a session, 3,500-char caps on DMs out,
 * and a peek that kept the oldest lines of a tail. Here a cut is always marked
 * with how much went, a tail keeps its newest end, and a long message is split
 * into numbered parts. NIP-59 gift wraps carry randomised timestamps, so parts
 * of one message can arrive in any order; the `(i/n)` prefix is how a reader
 * puts them back.
 *
 * Lengths are JavaScript string lengths (UTF-16 units), as the callers' caps
 * always were. No cut ever separates a surrogate pair.
 */

const isHigh = (c) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c) => c >= 0xdc00 && c <= 0xdfff;

/** An end index <= i that does not split a surrogate pair. */
function safeEnd(s, i) {
  return i > 0 && i < s.length && isHigh(s.charCodeAt(i - 1)) ? i - 1 : i;
}

/** A start index >= i that does not split a surrogate pair. */
function safeStart(s, i) {
  return i > 0 && i < s.length && isLow(s.charCodeAt(i)) ? i + 1 : i;
}

/** `text` within `max`, keeping the start; a cut ends in `…[+N chars cut]`. */
function clip(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  // The marker's own length depends on N; size it for the worst case.
  let keep = max - `…[+${s.length} chars cut]`.length;
  keep = safeEnd(s, Math.max(0, keep));
  return `${s.slice(0, keep)}…[+${s.length - keep} chars cut]`;
}

/** `text` within `max`, keeping the end (a log or pane tail); a cut starts with `…[N chars cut]`. */
function clipTail(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  const room = Math.max(0, max - `…[${s.length} chars cut]\n`.length);
  const from = safeStart(s, s.length - room);
  return `…[${from} chars cut]\n${s.slice(from)}`;
}

/**
 * `text` as messages of at most `max` each. One part is the text unchanged;
 * more are prefixed `(i/n) ` and rejoin exactly once the prefixes are removed.
 * Past `maxParts` the text is clipped (marked) before it is split. Breaks
 * prefer a newline, then a space, in the last fifth of a part.
 */
function splitParts(text, max, maxParts = 6) {
  const s = String(text ?? '');
  if (s.length <= max) return [s];
  const prefix = `(${maxParts}/${maxParts}) `.length;
  const size = Math.max(1, max - prefix);
  const body = s.length > size * maxParts ? clip(s, size * maxParts) : s;
  const chunk = (soft) => {
    const out = [];
    for (let at = 0; at < body.length;) {
      let end = Math.min(body.length, at + size);
      if (end < body.length) {
        if (soft) {
          const floor = at + Math.floor(size * 0.8);
          const nl = body.lastIndexOf('\n', end - 1);
          const sp = body.lastIndexOf(' ', end - 1);
          if (nl >= floor) end = nl + 1;
          else if (sp >= floor) end = sp + 1;
        }
        end = safeEnd(body, end);
        if (end <= at) end = Math.min(body.length, at + size);
      }
      out.push(body.slice(at, end));
      at = end;
    }
    return out;
  };
  // Soft breaks shorten parts; if that would exceed the cap, cut hard instead.
  let chunks = chunk(true);
  if (chunks.length > maxParts) chunks = chunk(false);
  return chunks.map((c, i) => `(${i + 1}/${chunks.length}) ${c}`);
}

module.exports = { clip, clipTail, splitParts };
