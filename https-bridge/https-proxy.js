#!/usr/bin/env node
/**
 * HTTPS to HTTP Bridge Proxy
 * Bridges https://localhost:<HTTPS_PORT> -> http://<HOST_IP>:<TARGET_PORT>
 * Solves cross-origin security issues for local development
 *
 * Environment Variables:
 *   HOST_IP       - Target host IP (default: gateway IP or 192.168.0.51)
 *   HTTPS_PORT    - Local HTTPS port to listen on (default: 3001)
 *   TARGET_PORT   - Remote HTTP port to proxy to (default: 3001)
 *   CERT_DIR      - Directory containing server.key and server.crt
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Try to detect gateway IP if HOST_IP not set
function detectGatewayIP() {
  try {
    const result = execSync("ip route | grep default | awk '{print $3}'", { encoding: 'utf8' });
    return result.trim() || '192.168.0.51';
  } catch {
    return '192.168.0.51';
  }
}

const HOST_IP = process.env.HOST_IP || detectGatewayIP();
// R-003: listen bind defaults to 0.0.0.0 because Docker port publishing requires
// the in-container listener to accept the bridge interface. It is exposed only on
// host-loopback via the compose `127.0.0.1:` publish mapping.
const HTTPS_HOST = process.env.HTTPS_BRIDGE_HOST || '0.0.0.0';
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '3001', 10);
const TARGET_PORT = parseInt(process.env.TARGET_PORT || '3001', 10);
const CERT_DIR = process.env.CERT_DIR || __dirname;

const keyPath = path.join(CERT_DIR, 'server.key');
const certPath = path.join(CERT_DIR, 'server.crt');

// Generate self-signed certificate via Node's built-in crypto.
// Previously this shelled out to `openssl req -x509 ...`, but devuser's
// PATH inside the agentbox container does not include openssl by default
// (it's only available at the absolute Nix store path the bootstrap uses
// for pre-generation). Node 19+ has all the primitives we need natively,
// so we drop the external dependency entirely.
function ensureCertificates() {
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) return;

  console.log('Generating self-signed certificate via node:crypto...');
  try {
    const crypto = require('crypto');

    // RSA-2048 keypair, PEM encoded.
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Build a minimal X.509v1 self-signed cert. CN=localhost; valid 365d.
    // We use the DER-encoded subject + signature ourselves rather than
    // pulling in `selfsigned` or `node-forge` so the dependency surface
    // stays at zero. Node has no high-level cert builder, so this is the
    // smallest correct implementation.
    const cert = buildSelfSignedX509(privateKey, publicKey, 'localhost', 365);

    fs.writeFileSync(keyPath,  privateKey, { mode: 0o600 });
    fs.writeFileSync(certPath, cert,       { mode: 0o644 });
    console.log('Certificate generated successfully');
  } catch (err) {
    console.error('Failed to generate certificate:', err.message);
    process.exit(1);
  }
}

// Minimal X.509v1 self-signed cert builder. Returns a PEM string.
function buildSelfSignedX509(privateKeyPem, publicKeyPem, commonName, validDays) {
  const crypto = require('crypto');

  // Helpers for ASN.1 DER encoding.
  const der = (() => {
    function len(n) {
      if (n < 0x80) return Buffer.from([n]);
      const b = []; let v = n;
      while (v) { b.unshift(v & 0xff); v >>= 8; }
      return Buffer.concat([Buffer.from([0x80 | b.length]), Buffer.from(b)]);
    }
    function tlv(tag, value) {
      return Buffer.concat([Buffer.from([tag]), len(value.length), value]);
    }
    return {
      seq: (parts) => tlv(0x30, Buffer.concat(parts)),
      set: (parts) => tlv(0x31, Buffer.concat(parts)),
      int: (n) => {
        // Positive integer; pad if high bit is set.
        const bytes = [];
        do { bytes.unshift(n & 0xff); n >>= 8; } while (n);
        if (bytes[0] & 0x80) bytes.unshift(0x00);
        return tlv(0x02, Buffer.from(bytes));
      },
      bigInt: (buf) => {
        if (buf[0] & 0x80) return tlv(0x02, Buffer.concat([Buffer.from([0]), buf]));
        return tlv(0x02, buf);
      },
      oid: (parts) => {
        const out = [parts[0] * 40 + parts[1]];
        for (let i = 2; i < parts.length; i++) {
          const p = parts[i]; const stack = [];
          let v = p; do { stack.unshift(v & 0x7f); v >>= 7; } while (v);
          for (let j = 0; j < stack.length - 1; j++) stack[j] |= 0x80;
          out.push(...stack);
        }
        return tlv(0x06, Buffer.from(out));
      },
      utf8: (s) => tlv(0x0c, Buffer.from(s, 'utf8')),
      utc:  (d) => {
        // YYMMDDHHMMSSZ
        const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mi = String(d.getUTCMinutes()).padStart(2, '0');
        const ss = String(d.getUTCSeconds()).padStart(2, '0');
        return tlv(0x17, Buffer.from(yy + mm + dd + hh + mi + ss + 'Z'));
      },
      null: () => Buffer.from([0x05, 0x00]),
      bitstring: (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf])),
    };
  })();

  // OIDs we need.
  const OID_RSA           = der.oid([1, 2, 840, 113549, 1, 1, 1]);
  const OID_SHA256_RSA    = der.oid([1, 2, 840, 113549, 1, 1, 11]);
  const OID_CN            = der.oid([2, 5, 4, 3]);

  // Extract SPKI bytes from PEM-encoded public key.
  const publicKeyDer = pemToDer(publicKeyPem);

  const subject = der.seq([
    der.set([
      der.seq([OID_CN, der.utf8(commonName)]),
    ]),
  ]);

  const now      = new Date();
  const notAfter = new Date(now.getTime() + validDays * 86400 * 1000);

  const tbs = der.seq([
    der.int(1),                                          // serialNumber
    der.seq([OID_SHA256_RSA, der.null()]),               // signature alg
    subject,                                             // issuer (= subject; self-signed)
    der.seq([der.utc(now), der.utc(notAfter)]),          // validity
    subject,                                             // subject
    publicKeyDer,                                        // SPKI
  ]);

  const sig = crypto.createSign('sha256').update(tbs).sign(privateKeyPem);

  const cert = der.seq([
    tbs,
    der.seq([OID_SHA256_RSA, der.null()]),               // signature alg
    der.bitstring(sig),                                  // signature
  ]);

  return derToPem(cert, 'CERTIFICATE');
}

function pemToDer(pem) {
  const m = pem.match(/-----BEGIN [^-]+-----([\s\S]+?)-----END [^-]+-----/);
  if (!m) throw new Error('pemToDer: not a PEM block');
  return Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
}

function derToPem(der, label) {
  const b64 = der.toString('base64');
  const lines = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

ensureCertificates();

const options = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath)
};

const server = https.createServer(options, (req, res) => {
  const startTime = Date.now();

  const proxyOptions = {
    hostname: HOST_IP,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${HOST_IP}:${TARGET_PORT}`,
      'x-forwarded-proto': 'https',
      'x-forwarded-host': `localhost:${HTTPS_PORT}`
    }
  };

  const proxyReq = http.request(proxyOptions, (proxyRes) => {
    // Add CORS headers for browser compatibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Copy response headers (except CORS-related which we override)
    Object.keys(proxyRes.headers).forEach(key => {
      if (!key.toLowerCase().startsWith('access-control-')) {
        res.setHeader(key, proxyRes.headers[key]);
      }
    });

    res.writeHead(proxyRes.statusCode);
    proxyRes.pipe(res);

    proxyRes.on('end', () => {
      const duration = Date.now() - startTime;
      console.log(`${req.method} ${req.url} -> ${proxyRes.statusCode} (${duration}ms)`);
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`Proxy error for ${req.url}: ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Bad Gateway',
      message: err.message,
      target: `http://${HOST_IP}:${TARGET_PORT}`
    }));
  });

  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  req.pipe(proxyReq);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${HTTPS_PORT} is already in use`);
    process.exit(1);
  }
  console.error('Server error:', err);
});

server.listen(HTTPS_PORT, HTTPS_HOST, () => {
  console.log('='.repeat(60));
  console.log('HTTPS Bridge Proxy Started');
  console.log('='.repeat(60));
  console.log(`  Local:  https://localhost:${HTTPS_PORT}`);
  console.log(`  Target: http://${HOST_IP}:${TARGET_PORT}`);
  console.log('='.repeat(60));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down HTTPS bridge...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('\nShutting down HTTPS bridge...');
  server.close(() => process.exit(0));
});
