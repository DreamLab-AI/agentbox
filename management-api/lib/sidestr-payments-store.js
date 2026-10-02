'use strict';

/**
 * sidestr-payments-store — the payer's record of sidestr payments, read by
 * GET /v1/chain/payments and used for the per-payer daily budget.
 *
 * One JSON file, rewritten atomically (temp file + rename) on every change.
 * Holds public facts only: DIDs, the payee address and spend key, amounts,
 * txids, block hashes, URNs, statuses. Never a key, never caller credentials.
 *
 * Path: `options.file`, else `$SIDESTR_PAYMENTS_FILE`, else
 * `/var/lib/agentbox/payments/sidestr-payments.json`.
 *
 * Statuses: pending-approval → paying → broadcast → settled, or failed /
 * denied. Everything but failed and denied counts against the daily budget.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COUNTED = new Set(['pending-approval', 'paying', 'broadcast', 'settled']);
const MAX_RECORDS = 5000;

function createPaymentsStore({ file } = {}) {
  const target = file || process.env.SIDESTR_PAYMENTS_FILE || '/var/lib/agentbox/payments/sidestr-payments.json';
  let records = null;

  function load() {
    if (records) return records;
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      records = Array.isArray(parsed.payments) ? parsed.payments : [];
    } catch {
      records = [];
    }
    return records;
  }

  function save() {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ schema: 'agentbox.sidestr-payments/1', payments: records }, null, 1)}\n`, { mode: 0o644 });
    fs.renameSync(tmp, target);
  }

  return {
    file: target,
    /** Create a record synchronously; returns it. */
    create(fields) {
      load();
      const now = new Date().toISOString();
      const rec = { id: crypto.randomUUID(), created_at: now, updated_at: now, settled: false, ...fields };
      records.push(rec);
      if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
      save();
      return { ...rec };
    },
    update(id, patch) {
      load();
      const rec = records.find((r) => r.id === id);
      if (!rec) return null;
      Object.assign(rec, patch, { updated_at: new Date().toISOString() });
      save();
      return { ...rec };
    },
    get(id) {
      const rec = load().find((r) => r.id === id);
      return rec ? { ...rec } : null;
    },
    /** Newest first. */
    list({ payer, limit = 100 } = {}) {
      return load()
        .filter((r) => !payer || r.payer_did === payer)
        .slice()
        .reverse()
        .slice(0, Math.max(1, Math.min(1000, limit)))
        .map((r) => ({ ...r }));
    },
    /** Sats committed today (UTC) by one payer on one chain. */
    spentToday(payerDid, chainId, now = new Date()) {
      const day = now.toISOString().slice(0, 10);
      return load()
        .filter((r) => r.payer_did === payerDid && r.chain_id === chainId && COUNTED.has(r.status) && String(r.created_at).slice(0, 10) === day)
        .reduce((a, r) => a + (Number(r.amount_sats) || 0), 0);
    },
  };
}

module.exports = { createPaymentsStore };
