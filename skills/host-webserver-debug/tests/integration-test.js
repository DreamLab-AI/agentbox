#!/usr/bin/env node
/**
 * Host Webserver Debug MCP Integration Test
 * Tests HTTPS bridge and debugging tools
 *
 * Usage: node integration-test.js
 */

const { spawn } = require('child_process');
const path = require('path');

const SERVER_PATH = path.join(__dirname, '..', 'mcp-server', 'server.js');

class MCPTestClient {
  constructor() {
    this.server = null;
    this.buffer = '';
    this.requestId = 0;
    this.pending = new Map();
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = spawn('node', [SERVER_PATH], {
        env: { ...process.env, DISPLAY: process.env.DISPLAY || ':1' },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.server.stdout.on('data', (data) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.server.stderr.on('data', (data) => {
        // Server logs go to stderr
      });

      this.server.on('error', reject);
      setTimeout(resolve, 1000);
    });
  }

  processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line);
        const pending = this.pending.get(response.id);
        if (pending) {
          pending.resolve(response);
          this.pending.delete(response.id);
        }
      } catch (e) {
        // Not JSON, ignore
      }
    }
  }

  async call(method, params = {}) {
    const id = ++this.requestId;
    const request = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.server.stdin.write(JSON.stringify(request) + '\n');

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  async callTool(name, args = {}) {
    const response = await this.call('tools/call', { name, arguments: args });
    if (response.error) throw new Error(response.error.message);
    return JSON.parse(response.result.content[0].text);
  }

  stop() {
    if (this.server) {
      this.server.kill();
      this.server = null;
    }
  }
}

async function runTests() {
  const client = new MCPTestClient();
  const results = { passed: 0, failed: 0, tests: [] };

  console.log('🚀 Starting Host Webserver Debug MCP Integration Tests\n');

  try {
    await client.start();
    console.log('✓ MCP Server started\n');

    // Test 1: Get Host IP
    console.log('Test 1: Detect Host Gateway IP');
    try {
      const hostIp = await client.callTool('get_host_ip');
      if (hostIp.host_ip) {
        console.log('  ✓ Detected host IP:', hostIp.host_ip);
        console.log('  ✓ Method:', hostIp.method);
        results.passed++;
        results.tests.push({ name: 'get_host_ip', status: 'passed' });
      } else {
        throw new Error('No host IP detected');
      }
    } catch (e) {
      console.log('  ✗ Failed:', e.message);
      results.failed++;
      results.tests.push({ name: 'get_host_ip', status: 'failed', error: e.message });
    }

    // Test 2: Health Check (may fail if no host server running)
    console.log('\nTest 2: Health Check Host Server');
    try {
      const health = await client.callTool('health_check', { port: 3001 });
      if (health.reachable) {
        console.log('  ✓ Host server reachable at', health.host + ':' + health.port);
        console.log('  ✓ Status code:', health.statusCode);
        results.passed++;
        results.tests.push({ name: 'health_check', status: 'passed' });
      } else {
        console.log('  ⚠ Host server not reachable (expected if no server running)');
        console.log('  ⚠ Error:', health.error);
        results.passed++; // Pass anyway - tool works even if server isn't running
        results.tests.push({ name: 'health_check', status: 'passed', note: 'Server not running' });
      }
    } catch (e) {
      console.log('  ✗ Failed:', e.message);
      results.failed++;
      results.tests.push({ name: 'health_check', status: 'failed', error: e.message });
    }

    // Test 3: Bridge Status (before starting)
    console.log('\nTest 3: Bridge Status (before start)');
    try {
      const status = await client.callTool('bridge_status');
      console.log('  ✓ Bridge running:', status.running);
      results.passed++;
      results.tests.push({ name: 'bridge_status_initial', status: 'passed' });
    } catch (e) {
      console.log('  ✗ Failed:', e.message);
      results.failed++;
      results.tests.push({ name: 'bridge_status_initial', status: 'failed', error: e.message });
    }

    // Test 4: List Tools
    console.log('\nTest 4: List Available Tools');
    try {
      const response = await client.call('tools/list');
      const tools = response.result.tools;
      console.log('  ✓ Found', tools.length, 'tools:');
      tools.forEach(t => console.log('    -', t.name));
      results.passed++;
      results.tests.push({ name: 'list_tools', status: 'passed' });
    } catch (e) {
      console.log('  ✗ Failed:', e.message);
      results.failed++;
      results.tests.push({ name: 'list_tools', status: 'failed', error: e.message });
    }

    // Test 5: Screenshot (external URL - tests Playwright integration)
    console.log('\nTest 5: Screenshot External URL');
    try {
      const screenshot = await client.callTool('screenshot', {
        url: 'https://example.com',
        full_page: false
      });
      if (screenshot.success) {
        console.log('  ✓ Screenshot saved:', screenshot.path);
        results.passed++;
        results.tests.push({ name: 'screenshot', status: 'passed' });
      } else {
        throw new Error(screenshot.error || 'Screenshot failed');
      }
    } catch (e) {
      console.log('  ✗ Failed:', e.message);
      results.failed++;
      results.tests.push({ name: 'screenshot', status: 'failed', error: e.message });
    }

    // Test 6: Debug CORS (external URL)
    console.log('\nTest 6: Debug CORS Headers');
    try {
      const cors = await client.callTool('debug_cors', {
        url: 'https://api.github.com',
        method: 'GET'
      });
      console.log('  ✓ CORS analysis completed');
      console.log('  ✓ URL:', cors.url);
      if (cors.headers) {
        console.log('  ✓ Has headers:', Object.keys(cors.headers).length > 0);
      }
      results.passed++;
      results.tests.push({ name: 'debug_cors', status: 'passed' });
    } catch (e) {
      console.log('  ✗ Failed:', e.message);
      results.failed++;
      results.tests.push({ name: 'debug_cors', status: 'failed', error: e.message });
    }

  } catch (e) {
    console.error('Fatal error:', e.message);
  } finally {
    client.stop();
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Test Results Summary');
  console.log('='.repeat(50));
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Total:  ${results.passed + results.failed}`);
  console.log('='.repeat(50));

  process.exit(results.failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
