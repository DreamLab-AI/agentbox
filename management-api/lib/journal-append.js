'use strict';

/**
 * journal-append — the one way a record reaches the events journal.
 *
 * A record is one complete line written with ONE `write(2)` call on a
 * descriptor opened `O_APPEND`. POSIX makes each such call land at the end of
 * the file as a unit, so two writers cannot interleave inside a line. Keeping the CHAIN linear
 * (read tail, hash, append) is a separate duty: the caller holds
 * lib/journal-lock.js around it.
 *
 * Two failure modes the plain `fs.appendFileSync` left open (2026-10-12
 * incident, boundaries entries for lines 35 and 64):
 *
 *   1. A crash mid-write leaves an unterminated fragment at the end of the
 *      file. The next process then appended straight onto it, fusing a good
 *      record into the bad line and hiding it from the verifier. This writer
 *      checks the final byte and, if the file does not end in `\n`, puts the
 *      newline in the SAME write, so a fragment stays a line of its own.
 *   2. A short write (disk full, signal) returned success to the caller. This
 *      writer checks the byte count, cuts the partial line back off, and
 *      throws, so the caller can leave the chain where it was.
 *
 * @see lib/audit-chain.js (verification, declared boundaries)
 */

const fs = require('fs');

/**
 * Append one complete, newline-terminated line to a journal file.
 *
 * @param {string} filePath
 * @param {string} line - exactly one line ending in `\n`, no other newline
 * @throws {Error} on an invalid line, an I/O error, or a short write (the
 *   partial line is truncated away before throwing)
 */
function appendLine(filePath, line) {
  if (typeof line !== 'string' || !line.endsWith('\n') || line.indexOf('\n') !== line.length - 1) {
    throw new Error('journal-append: a record must be exactly one newline-terminated line');
  }
  // 'a+' = O_RDWR | O_APPEND: reads (to see the last byte) and appends.
  const fd = fs.openSync(filePath, 'a+');
  try {
    const size = fs.fstatSync(fd).size;
    let needsNewline = false;
    if (size > 0) {
      const last = Buffer.alloc(1);
      fs.readSync(fd, last, 0, 1, size - 1);
      needsNewline = last[0] !== 0x0a;
    }
    const data = Buffer.from(needsNewline ? `\n${line}` : line, 'utf8');
    const written = fs.writeSync(fd, data, 0, data.length);
    if (written !== data.length) {
      try { fs.ftruncateSync(fd, size); } catch (_) { /* best effort; the error below still reports it */ }
      throw new Error(`journal-append: short write (${written} of ${data.length} bytes) to ${filePath}`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { appendLine };
