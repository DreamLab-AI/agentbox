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

const HOST_IP = process.env.HOST_IP || process.env.HOST_GATEWAY_IP || detectGatewayIP();
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '3001', 10);
const TARGET_PORT = parseInt(process.env.TARGET_PORT || '3001', 10);
const CERT_DIR = process.env.CERT_DIR || __dirname;

const keyPath = path.join(CERT_DIR, 'server.key');
const certPath = path.join(CERT_DIR, 'server.crt');

// Generate self-signed certificate if not exists
function ensureCertificates() {
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.log('Generating self-signed certificate...');
    try {
      execSync(`openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -subj "/CN=localhost"`, {
        stdio: 'inherit'
      });
      console.log('Certificate generated successfully');
    } catch (err) {
      console.error('Failed to generate certificate:', err.message);
      process.exit(1);
    }
  }
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
      'x-forwarded-host': `localhost:${HTTPS_PORT}`,
      'x-forwarded-for': req.socket.remoteAddress
    }
  };

  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    console.log(`OPTIONS ${req.url} -> 204 (preflight)`);
    return;
  }

  const proxyReq = http.request(proxyOptions, (proxyRes) => {
    // Add CORS headers for browser compatibility
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, X-Total-Count'
    };

    // Merge headers, preferring CORS overrides
    const responseHeaders = { ...proxyRes.headers };
    Object.keys(corsHeaders).forEach(key => {
      responseHeaders[key.toLowerCase()] = corsHeaders[key];
    });

    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);

    proxyRes.on('end', () => {
      const duration = Date.now() - startTime;
      console.log(`${req.method} ${req.url} -> ${proxyRes.statusCode} (${duration}ms)`);
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`Proxy error for ${req.url}: ${err.message}`);
    res.writeHead(502, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      error: 'Bad Gateway',
      message: err.message,
      target: `http://${HOST_IP}:${TARGET_PORT}`,
      timestamp: new Date().toISOString()
    }));
  });

  req.pipe(proxyReq);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${HTTPS_PORT} is already in use`);
    process.exit(1);
  }
  console.error('Server error:', err);
});

server.listen(HTTPS_PORT, '0.0.0.0', () => {
  console.log('='.repeat(60));
  console.log('HTTPS Bridge Proxy Started');
  console.log('='.repeat(60));
  console.log(`  Local:  https://localhost:${HTTPS_PORT}`);
  console.log(`  Target: http://${HOST_IP}:${TARGET_PORT}`);
  console.log(`  Certs:  ${CERT_DIR}`);
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

// Export for programmatic use
module.exports = { server, detectGatewayIP, HOST_IP, HTTPS_PORT, TARGET_PORT };
