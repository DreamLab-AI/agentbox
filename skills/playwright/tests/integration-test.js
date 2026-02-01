#!/usr/bin/env node
/**
 * Playwright MCP Integration Test
 * Tests all MCP tools against real websites
 *
 * Usage: DISPLAY=:1 node integration-test.js
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

      // Give server time to start
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

      // Timeout after 30s
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

  console.log('🚀 Starting Playwright MCP Integration Tests\n');

  try {
    await client.start();
    console.log('✓ MCP Server started\n');

    // Test 1: Health Check
    console.log('Test 1: Health Check');
    try {
      const health = await client.callTool('health_check');
      if (health.success && health.browserConnected) {
        console.log('  ✓ Browser connected on display', health.display);
        results.passed++;
        results.tests.push({ name: 'health_check', status: 'passed' });
      } else {
        throw new Error('Browser not connected');
      }
    } catch (e) {
      console.log('  ✗ Failed:', e.message);
      results.failed++;
      results.tests.push({ name: 'health_check', status: 'failed', error: e.message });
    }

    // Test 2: Navigate to GitHub
    console.log('\nTest 2: Navigate to GitHub');
    try {
      const nav = await client.callTool('navigate', { url: 'https://github.com' });
      if (nav.success && nav.url.includes('github.com')) {
        console.log('  ✓ Navigated to:', nav.url);
        console.log('  ✓ Title:', nav.title);
        results.passed++;
        results.tests.push({ name: 'navigate_github', status: 'passed' });
      } else {
        throw new Error('Navigation failed');
      }
    } catch (e) {
      console.log('  ✗ Failed:', e.message);
      results.failed++;
      results.tests.push({ name: 'navigate_github', status: 'failed', error: e.message });
    }

    // Test 3: Screenshot
    console.log('\nTest 3: Screenshot Capture');
    try {
      const screenshot = await client.callTool('screenshot', {
        filename: 'test-github.png',
        fullPage: false
      });
      if (screenshot.success && screenshot.path) {
        console.log('  ✓ Screenshot saved:', screenshot.path);
        console.log('  ✓ Viewport:', screenshot.viewport.width, 'x', screenshot.viewport.height);
        results.passed++;
        results.tests.push({ name: 'screenshot', status: 'passed' });
      } else {
        throw new Error('Screenshot failed');
      }
    } catch (e) {
      console.log('  ✗ Failed:', e.message);
      results.failed++;
      results.tests.push({ name: 'screenshot', status: 'failed', error: e.message });
    }

    // Test 4: JavaScript Evaluation
    console.log('\nTest 4: JavaScript Evaluation');
    try {
      const evalResult = await client.callTool('evaluate', {
        script: 'document.querySelectorAll("a").length'
      });
      if (evalResult.success && typeof evalResult.result === 'number') {
        console.log('  ✓ Found', evalResult.result, 'links on page');
        results.passed++;
        results.tests.push({ name: 'evaluate', status: 'passed' });
      } else {
        throw new Error('Evaluation failed');
      }
    } catch (e) {
      console.log('  ✗ Failed:', e.message);
      results.failed++;
      results.tests.push({ name: 'evaluate', status: 'failed', error: e.message });
    }

    // Test 5: Navigate to search engine
    console.log('\nTest 5: Navigate to DuckDuckGo');
    try {
      const nav = await client.callTool('navigate', { url: 'https://duckduckgo.com' });
      if (nav.success) {
        console.log('  ✓ Navigated to:', nav.url);
        results.passed++;
        results.tests.push({ name: 'navigate_ddg', status: 'passed' });
      } else {
        throw new Error('Navigation failed');
      }
    } catch (e) {
      console.log('  ✗ Failed:', e.message);
      results.failed++;
      results.tests.push({ name: 'navigate_ddg', status: 'failed', error: e.message });
    }

    // Test 6: Type in search box
    console.log('\nTest 6: Type Text');
    try {
      const typeResult = await client.callTool('type', {
        selector: 'input[name="q"]',
        text: 'Playwright testing'
      });
      if (typeResult.success) {
        console.log('  ✓ Typed', typeResult.textLength, 'characters');
        results.passed++;
        results.tests.push({ name: 'type', status: 'passed' });
      } else {
        throw new Error('Type failed');
      }
    } catch (e) {
      console.log('  ✗ Failed:', e.message);
      results.failed++;
      results.tests.push({ name: 'type', status: 'failed', error: e.message });
    }

    // Test 7: Click search button
    console.log('\nTest 7: Click Button');
    try {
      const clickResult = await client.callTool('click', {
        selector: 'button[type="submit"]'
      });
      if (clickResult.success) {
        console.log('  ✓ Clicked button');
        results.passed++;
        results.tests.push({ name: 'click', status: 'passed' });
      } else {
        throw new Error('Click failed');
      }
    } catch (e) {
      console.log('  ✗ Failed:', e.message);
      results.failed++;
      results.tests.push({ name: 'click', status: 'failed', error: e.message });
    }

    // Test 8: Wait for results
    console.log('\nTest 8: Wait for Selector');
    try {
      const waitResult = await client.callTool('wait_for_selector', {
        selector: '[data-testid="result"]',
        timeout: 10000
      });
      if (waitResult.success) {
        console.log('  ✓ Search results loaded');
        results.passed++;
        results.tests.push({ name: 'wait_for_selector', status: 'passed' });
      } else {
        throw new Error('Wait failed');
      }
    } catch (e) {
      console.log('  ✗ Failed:', e.message);
      results.failed++;
      results.tests.push({ name: 'wait_for_selector', status: 'failed', error: e.message });
    }

    // Test 9: Get URL
    console.log('\nTest 9: Get URL');
    try {
      const urlResult = await client.callTool('get_url');
      if (urlResult.success && urlResult.url.includes('duckduckgo')) {
        console.log('  ✓ Current URL:', urlResult.url);
        console.log('  ✓ Page title:', urlResult.title);
        results.passed++;
        results.tests.push({ name: 'get_url', status: 'passed' });
      } else {
        throw new Error('Get URL failed');
      }
    } catch (e) {
      console.log('  ✗ Failed:', e.message);
      results.failed++;
      results.tests.push({ name: 'get_url', status: 'failed', error: e.message });
    }

    // Test 10: Get Content
    console.log('\nTest 10: Get Page Content');
    try {
      const contentResult = await client.callTool('get_content');
      const htmlLength = contentResult.html?.length ||
                         (typeof contentResult === 'string' ? contentResult.length : 0) ||
                         (contentResult.content?.length || 0);
      if (contentResult.success || htmlLength > 0) {
        console.log('  ✓ Got page content successfully');
        console.log('  ✓ Content length:', htmlLength > 0 ? htmlLength : 'returned as object');
        results.passed++;
        results.tests.push({ name: 'get_content', status: 'passed' });
      } else {
        throw new Error('Get content failed');
      }
    } catch (e) {
      console.log('  ✗ Failed:', e.message);
      results.failed++;
      results.tests.push({ name: 'get_content', status: 'failed', error: e.message });
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

  // Exit with error code if any tests failed
  process.exit(results.failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
