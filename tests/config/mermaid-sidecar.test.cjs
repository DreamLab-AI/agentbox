const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const repo = path.resolve(__dirname, '../..');
const client = path.join(repo, 'scripts/mmdc-sidecar.sh');
const batch = path.join(repo, 'skills/mermaid-diagrams/scripts/render.sh');

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('mmdc client forwards render options and removes exchange scratch', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbox-mermaid-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const exchange = path.join(dir, 'exchange');
  fs.mkdirSync(exchange);
  const input = path.join(dir, 'diagram.mmd');
  const config = path.join(dir, 'theme.json');
  fs.writeFileSync(input, 'flowchart TD; A-->B;\n');
  fs.writeFileSync(config, '{"theme":"dark","themeVariables":{"primaryColor":"#123456"}}');
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      assert.equal(req.url, '/render-mermaid');
      const options = JSON.parse(body);
      requests.push(options);
      const filename = `mermaid-123-${String(requests.length).padStart(8, '0')}.${options.format}`;
      fs.writeFileSync(path.join(exchange, filename), '<svg/>');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, filename }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const env = { ...process.env,
    MERMAID_SIDECAR_URL: `http://127.0.0.1:${server.address().port}/render-mermaid`,
    MERMAID_EXCHANGE_DIR: exchange };

  const output = path.join(dir, 'diagram.svg');
  const rendered = await run(client, ['-i', input, '-o', output, '-w', '2000', '-H', '1200',
    '-t', 'dark', '-b', 'transparent', '-c', config, '--quiet'], env);
  assert.equal(rendered.code, 0, rendered.stderr);
  assert.equal(rendered.stdout, '');
  assert.equal(fs.readFileSync(output, 'utf8'), '<svg/>');
  assert.deepEqual(fs.readdirSync(exchange), []);
  assert.deepEqual(requests[0], {
    definition: 'flowchart TD; A-->B;\n', format: 'svg', theme: 'dark',
    width: 2000, height: 1200, background: 'transparent',
    config: { theme: 'dark', themeVariables: { primaryColor: '#123456' } },
  });

  const bad = await run(client, ['-i', input, '-o', output, '-w', '0'], env);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /between 1 and 6000/);
  assert.equal(requests.length, 1);

  const unsupported = await run(client, ['-i', input, '-o', output, '-p', config], env);
  assert.equal(unsupported.code, 1);
  assert.match(unsupported.stderr, /unknown option/);
  assert.equal(requests.length, 1);

  const version = await run(client, ['--version'], env);
  assert.equal(version.code, 0);
  assert.match(version.stdout, /mmdc-sidecar/);

  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.symlinkSync(client, path.join(bin, 'mmdc'));
  const inputDir = path.join(dir, 'input');
  const outputDir = path.join(dir, 'output');
  fs.mkdirSync(inputDir);
  fs.writeFileSync(path.join(inputDir, 'flow.mmd'), 'flowchart TD; A-->B;\n');
  const batchResult = await run('bash', [batch, inputDir, outputDir, 'light'],
    { ...env, PATH: `${bin}:${process.env.PATH}` });
  assert.equal(batchResult.code, 0, batchResult.stderr);
  assert.equal(fs.readFileSync(path.join(outputDir, 'flow.png'), 'utf8'), '<svg/>');
  assert.equal(fs.readFileSync(path.join(outputDir, 'flow.pdf'), 'utf8'), '<svg/>');
  assert.equal(requests[1].theme, 'default');
  assert.equal(requests[1].config.theme, 'default');
  assert.equal(requests[1].width, 2000);
  assert.equal(requests[1].height, 1200);
  assert.deepEqual(fs.readdirSync(exchange), []);
});

test('browsercontainer renderer forwards options to mmdc and rejects bad input', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbox-mermaid-server-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  const exchange = path.join(dir, 'exchange');
  fs.mkdirSync(bin);
  const argsFile = path.join(dir, 'args.json');
  fs.writeFileSync(path.join(bin, 'mmdc'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(args[args.indexOf('-c') + 1], 'utf8'));
fs.writeFileSync(process.env.MERMAID_TEST_ARGS, JSON.stringify({args, config}));
fs.writeFileSync(args[args.indexOf('-o') + 1], '<svg/>');
`, { mode: 0o755 });
  const previous = {
    PATH: process.env.PATH,
    EXCHANGE_DIR: process.env.EXCHANGE_DIR,
    MERMAID_TEST_ARGS: process.env.MERMAID_TEST_ARGS,
  };
  process.env.PATH = `${bin}:${process.env.PATH}`;
  process.env.EXCHANGE_DIR = exchange;
  process.env.MERMAID_TEST_ARGS = argsFile;
  const serverPath = path.join(repo, 'browsercontainer/server.js');
  delete require.cache[require.resolve(serverPath)];
  const { renderMermaid } = require(serverPath);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve(serverPath)];
  });

  const result = await renderMermaid({ definition: 'flowchart TD; A-->B;',
    format: 'svg', theme: 'forest', width: 1234, height: 876,
    background: 'transparent', config: { theme: 'forest' } });
  assert.equal(result.ok, true, result.error);
  assert.equal(fs.readFileSync(result.path, 'utf8'), '<svg/>');
  const call = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
  const { args } = call;
  assert.equal(args[args.indexOf('-w') + 1], '1234');
  assert.equal(args[args.indexOf('-H') + 1], '876');
  assert.equal(args[args.indexOf('-b') + 1], 'transparent');
  assert.deepEqual(call.config, { theme: 'forest' });
  assert.deepEqual(await renderMermaid({ definition: 'A-->B', width: 0 }),
    { ok: false, error: 'width and height must be integers from 1 to 6000' });
});
