#!/usr/bin/env node

const http = require('http');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const services = [
  { name: 'MCP TCP Server', url: 'http://localhost:3000/health', optional: false },
  { name: 'MCP WS Bridge', url: 'ws://localhost:8765', optional: false },
  { name: 'Gemini Flow', url: 'http://localhost:8080/health', optional: true },
  { name: 'Claude Flow', url: 'http://localhost:8081/health', optional: true },
  { name: 'Playwright MCP', url: 'http://localhost:3003/health', optional: true }
];

async function checkService(service) {
  return new Promise((resolve) => {
    const protocol = service.url.startsWith('ws') ? require('ws') : http;
    
    if (service.url.startsWith('ws')) {
      const ws = new (require('ws'))(service.url);
      const timeout = setTimeout(() => {
        ws.close();
        resolve({ ...service, status: 'DOWN', error: 'Timeout' });
      }, 5000);
      
      ws.on('open', () => {
        clearTimeout(timeout);
        ws.close();
        resolve({ ...service, status: 'UP' });
      });
      
      ws.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ ...service, status: 'DOWN', error: err.message });
      });
    } else {
      const req = http.get(service.url, (res) => {
        if (res.statusCode === 200 || res.statusCode === 204) {
          resolve({ ...service, status: 'UP' });
        } else {
          resolve({ ...service, status: 'DOWN', error: `HTTP ${res.statusCode}` });
        }
      });
      
      req.on('error', (err) => {
        resolve({ ...service, status: 'DOWN', error: err.message });
      });
      
      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ ...service, status: 'DOWN', error: 'Timeout' });
      });
    }
  });
}

async function checkSupervisorStatus() {
  try {
    const { stdout } = await execPromise('supervisorctl status');
    return stdout.split('\n').filter(line => line.trim()).map(line => {
      const [name, status] = line.split(/\s+/);
      return { name, status };
    });
  } catch (error) {
    return [];
  }
}

async function runHealthCheck() {
  console.log(`[${new Date().toISOString()}] Running health check...`);
  
  // Check services
  const results = await Promise.all(services.map(checkService));
  
  // Check supervisor status
  const supervisorStatus = await checkSupervisorStatus();
  
  // Report results
  console.log('\n=== Service Health Status ===');
  results.forEach(result => {
    const status = result.status === 'UP' ? '✓' : '✗';
    const optional = result.optional ? ' (optional)' : '';
    console.log(`${status} ${result.name}${optional}: ${result.status} ${result.error ? `- ${result.error}` : ''}`);
  });
  
  if (supervisorStatus.length > 0) {
    console.log('\n=== Supervisor Status ===');
    supervisorStatus.forEach(({ name, status }) => {
      console.log(`${name}: ${status}`);
    });
  }
  
  // Return exit code based on required services
  const requiredDown = results.filter(r => !r.optional && r.status === 'DOWN');
  if (requiredDown.length > 0) {
    console.log(`\n⚠ ${requiredDown.length} required service(s) are down!`);
    process.exit(1);
  } else {
    console.log('\n✓ All required services are healthy');
    process.exit(0);
  }
}

// Run health check
if (require.main === module) {
  runHealthCheck().catch(console.error);
}

module.exports = { checkService, runHealthCheck };