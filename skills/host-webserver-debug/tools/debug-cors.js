#!/usr/bin/env node
/**
 * CORS Debugging Tool for Host Webserver Debug Skill
 * Analyzes CORS headers and identifies issues
 */

const http = require('http');
const https = require('https');

async function debugCors(options = {}) {
  const {
    url = 'https://localhost:3001',
    origin = 'https://localhost:3001',
    method = 'GET',
    verbose = false
  } = options;

  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === 'https:';
  const client = isHttps ? https : http;

  const results = {
    url,
    origin,
    timestamp: new Date().toISOString(),
    preflight: null,
    actual: null,
    issues: [],
    recommendations: []
  };

  // Test preflight OPTIONS request
  try {
    const preflightResult = await new Promise((resolve, reject) => {
      const req = client.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'OPTIONS',
        rejectUnauthorized: false,
        headers: {
          'Origin': origin,
          'Access-Control-Request-Method': method,
          'Access-Control-Request-Headers': 'Content-Type, Authorization'
        }
      }, (res) => {
        const headers = {};
        Object.keys(res.headers).forEach(key => {
          if (key.toLowerCase().startsWith('access-control-')) {
            headers[key] = res.headers[key];
          }
        });
        resolve({
          statusCode: res.statusCode,
          headers
        });
      });

      req.on('error', reject);
      req.end();
    });

    results.preflight = preflightResult;

    // Analyze preflight response
    if (preflightResult.statusCode >= 400) {
      results.issues.push(`Preflight request failed with status ${preflightResult.statusCode}`);
    }

    const corsHeaders = preflightResult.headers;

    if (!corsHeaders['access-control-allow-origin']) {
      results.issues.push('Missing Access-Control-Allow-Origin header');
      results.recommendations.push('Add "Access-Control-Allow-Origin: *" or specific origin');
    } else if (corsHeaders['access-control-allow-origin'] !== '*' &&
               corsHeaders['access-control-allow-origin'] !== origin) {
      results.issues.push(`Origin mismatch: expected "${origin}", got "${corsHeaders['access-control-allow-origin']}"`);
    }

    if (!corsHeaders['access-control-allow-methods']) {
      results.issues.push('Missing Access-Control-Allow-Methods header');
      results.recommendations.push('Add "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS"');
    }

    if (!corsHeaders['access-control-allow-headers']) {
      results.issues.push('Missing Access-Control-Allow-Headers header');
      results.recommendations.push('Add "Access-Control-Allow-Headers: Content-Type, Authorization"');
    }

  } catch (err) {
    results.preflight = { error: err.message };
    results.issues.push(`Preflight request failed: ${err.message}`);
  }

  // Test actual request
  try {
    const actualResult = await new Promise((resolve, reject) => {
      const req = client.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: method,
        rejectUnauthorized: false,
        headers: {
          'Origin': origin,
          'Accept': 'application/json, text/plain, */*'
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          const headers = {};
          Object.keys(res.headers).forEach(key => {
            if (key.toLowerCase().startsWith('access-control-') ||
                key.toLowerCase() === 'content-type') {
              headers[key] = res.headers[key];
            }
          });
          resolve({
            statusCode: res.statusCode,
            headers,
            bodyLength: body.length
          });
        });
      });

      req.on('error', reject);
      req.end();
    });

    results.actual = actualResult;

  } catch (err) {
    results.actual = { error: err.message };
    results.issues.push(`Actual request failed: ${err.message}`);
  }

  // Summary
  results.corsEnabled = results.issues.length === 0;

  if (results.corsEnabled) {
    results.summary = 'CORS is properly configured';
  } else {
    results.summary = `Found ${results.issues.length} CORS issue(s)`;
  }

  if (verbose) {
    console.log(JSON.stringify(results, null, 2));
  }

  return results;
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const url = args[0] || 'https://localhost:3001';

  debugCors({ url, verbose: true })
    .then(result => {
      process.exit(result.corsEnabled ? 0 : 1);
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = { debugCors };
