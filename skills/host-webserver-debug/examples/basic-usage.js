#!/usr/bin/env node
/**
 * Basic Usage Example for Host Webserver Debug Skill
 *
 * This example demonstrates:
 * 1. Starting the HTTPS bridge
 * 2. Taking screenshots
 * 3. Debugging CORS issues
 */

const { spawn, execSync } = require('child_process');
const path = require('path');

// Paths
const TOOLS_DIR = path.join(__dirname, '..', 'tools');
const SCREENSHOT_DIR = '/tmp/screenshots';

async function main() {
  console.log('='.repeat(60));
  console.log('Host Webserver Debug - Basic Usage Example');
  console.log('='.repeat(60));

  // Step 1: Detect host IP
  console.log('\n1. Detecting host gateway IP...');
  let hostIp;
  try {
    hostIp = execSync("ip route | grep default | awk '{print $3}'", { encoding: 'utf8' }).trim();
    console.log(`   Host IP: ${hostIp}`);
  } catch {
    hostIp = '192.168.0.51';
    console.log(`   Using default: ${hostIp}`);
  }

  // Step 2: Check host reachability
  console.log('\n2. Checking host server...');
  const http = require('http');
  const reachable = await new Promise((resolve) => {
    const req = http.request({
      hostname: hostIp,
      port: 3001,
      path: '/',
      method: 'HEAD',
      timeout: 5000
    }, (res) => {
      console.log(`   Host server responding: ${res.statusCode}`);
      resolve(true);
    });
    req.on('error', (err) => {
      console.log(`   Host server not reachable: ${err.message}`);
      resolve(false);
    });
    req.end();
  });

  if (!reachable) {
    console.log('\n   Please start a web server on the host at port 3001');
    console.log('   Example: cd your-app && npm run dev');
    process.exit(1);
  }

  // Step 3: Start HTTPS bridge
  console.log('\n3. Starting HTTPS bridge...');
  const bridgeProcess = spawn('node', [path.join(TOOLS_DIR, 'https-proxy.js')], {
    env: {
      ...process.env,
      HOST_IP: hostIp,
      HTTPS_PORT: '3001',
      TARGET_PORT: '3001',
      CERT_DIR: TOOLS_DIR
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  bridgeProcess.stdout.on('data', (data) => {
    console.log(`   ${data.toString().trim()}`);
  });

  // Wait for bridge to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 4: Test HTTPS connection
  console.log('\n4. Testing HTTPS bridge...');
  const https = require('https');
  const testResult = await new Promise((resolve) => {
    const req = https.request({
      hostname: 'localhost',
      port: 3001,
      path: '/',
      method: 'GET',
      rejectUnauthorized: false
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`   Bridge responding: ${res.statusCode}`);
        console.log(`   Content length: ${body.length} bytes`);
        resolve(true);
      });
    });
    req.on('error', (err) => {
      console.log(`   Bridge error: ${err.message}`);
      resolve(false);
    });
    req.end();
  });

  if (!testResult) {
    console.log('\n   Bridge failed to start');
    bridgeProcess.kill();
    process.exit(1);
  }

  // Step 5: Take screenshot
  console.log('\n5. Taking screenshot...');
  try {
    const { takeScreenshot } = require('../tools/screenshot.js');
    const result = await takeScreenshot({
      url: 'https://localhost:3001',
      outputDir: SCREENSHOT_DIR,
      fullPage: true
    });
    console.log(`   Screenshot saved: ${result.path}`);
    console.log(`   Page title: ${result.title}`);
  } catch (err) {
    console.log(`   Screenshot failed: ${err.message}`);
  }

  // Step 6: Debug CORS
  console.log('\n6. Debugging CORS...');
  try {
    const { debugCors } = require('../tools/debug-cors.js');
    const corsResult = await debugCors({
      url: 'https://localhost:3001',
      verbose: false
    });
    console.log(`   CORS enabled: ${corsResult.corsEnabled}`);
    if (corsResult.issues.length > 0) {
      console.log(`   Issues found: ${corsResult.issues.length}`);
      corsResult.issues.forEach(issue => console.log(`   - ${issue}`));
    }
  } catch (err) {
    console.log(`   CORS check failed: ${err.message}`);
  }

  // Cleanup
  console.log('\n7. Cleaning up...');
  bridgeProcess.kill();
  console.log('   Bridge stopped');

  console.log('\n' + '='.repeat(60));
  console.log('Example complete!');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
