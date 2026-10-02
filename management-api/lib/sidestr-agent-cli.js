'use strict';

/**
 * sidestr-agent-cli — the one place management-api runs the baked
 * `sidestr-agent` binary (lib/sidestr-agent.nix, 0.3.2 @ d68880bf).
 *
 * Interface used (sidestr-agent 0.3.2, `sidestr-agent <cmd> --help`):
 *
 *   sidestr-agent --url <producer> address <hex|npub|did>
 *     → {"npub","pubkey","did","script","address"}
 *   sidestr-agent --url <producer> --key-file <k_spend file> --relays <csv> \
 *       send <to> <sats> --post
 *     → {"cmd":"send","chain","txid","event","amount","fee","change","vsize",
 *        "note","posted":{"txid","fee","dup"},"relaysOk","relays"}
 *   sidestr-agent --url <producer> --key-file <file> balance
 *     → {"did","script","tip","coins","balance","spendable"}
 *
 * `send` builds and signs a taproot key-path spend with the key in --key-file,
 * POSTs it to the producer (`--post`) and publishes the kind-23500 event. The
 * key is only ever passed as a file path; the binary refuses a key on the
 * command line and prints none. Errors come back on stderr with exit 1.
 *
 * 0.3.2 has no memo field on `send` and no transaction lookup, so the memo
 * travels in the receipt (not on chain) and inclusion is found through the
 * producer's /coins and /blocks.json (lib/sidestr-rail.js). Both are listed
 * as S2 asks in ADR-2097's acceptance section.
 */

const { execFile } = require('child_process');

const DEFAULT_BIN = process.env.SIDESTR_AGENT_BIN || 'sidestr-agent';
const MAX_STDERR = 400;

/**
 * @param {object} [opts]
 * @param {string} [opts.bin]        - binary path (default `sidestr-agent` on PATH)
 * @param {number} [opts.timeoutMs]  - per-call timeout (default 60 s)
 * @param {function} [opts.exec]     - execFile-compatible (tests)
 */
function createSidestrAgent({ bin = DEFAULT_BIN, timeoutMs = 60000, exec = execFile } = {}) {
  function run(args) {
    return new Promise((resolve, reject) => {
      exec(bin, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME } },
        (err, stdout, stderr) => {
          if (err) {
            const msg = String(stderr || err.message || 'sidestr-agent failed').trim().slice(0, MAX_STDERR);
            const e = new Error(msg);
            e.code = 'sidestr-agent-failed';
            return reject(e);
          }
          try {
            resolve(JSON.parse(String(stdout).trim()));
          } catch {
            const e = new Error('sidestr-agent printed no JSON');
            e.code = 'sidestr-agent-bad-output';
            reject(e);
          }
        });
    });
  }

  return {
    /** Every name of a public key on the producer's chain. */
    address({ url, who }) {
      return run(['--url', url, 'address', who]);
    },
    /** Build, sign with the spend key, POST /tx and publish kind 23500. */
    send({ url, keyFile, relays, to, amountSats }) {
      const args = ['--url', url, '--key-file', keyFile];
      if (Array.isArray(relays) && relays.length) args.push('--relays', relays.join(','));
      args.push('send', to, String(amountSats), '--post');
      return run(args);
    },
    /** Coins and balance of the spend key at the producer's tip. */
    balance({ url, keyFile }) {
      return run(['--url', url, '--key-file', keyFile, 'balance']);
    },
  };
}

module.exports = { createSidestrAgent };
