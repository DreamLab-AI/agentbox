#!/usr/bin/env node
'use strict';

// pele-render — render Mermaid source to static SVG with the sha256-pinned Pele
// build (ADR-2154). No browser, Puppeteer or sidecar: Pele renders in-process.
// The loader, flatten() and error formatter are the same module the
// diagrams-as-code generator uses (skills/diagrams-as-code/scripts/lib), so the
// pin is enforced in exactly one place. PELE_VENDOR_DIR points at another copy
// of the pinned build (the Nix image sets it); its VERSION sha256 still applies.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const peleStatic = require('../skills/diagrams-as-code/scripts/lib/pele-static.cjs');

const VERSION = 'pele-render 1.0 (pele 1.12.0)';
const MAX_WIDTH = 20000;

const USAGE = `Usage: pele-render [options] <input.mmd | input.md> [more inputs]
       pele-render --check -i <input> ...

Render Mermaid to static SVG with the pinned Pele build. A .md input renders
every fenced \`\`\`mermaid block; any other input is one diagram ('-' is stdin).

Options:
  -i, --input <file>     Input (repeatable; positional arguments work too).
  -o, --output <path>    One diagram: the output file. Several (or a .md): a
                         directory. Default: beside the input, .svg extension.
      --check            Parse only; write nothing. Exit 4 if any diagram fails.
  -t, --theme <name>     light (default) | dark.
  -b, --background <c>   Background fill: a colour, or 'transparent' (default
                         transparent for light SVG; the dark palette's own bg).
  -w, --width <px>       Scale the output to this width, keeping the aspect ratio.
  -e, --format <fmt>     svg (default) | png (needs ImageMagick; inferred from -o).
  -q, --quiet            No success messages.
  -V, --version          Print the version.
  -h, --help             Show this help.

Errors are reported as file:line: message, with line counted in the file
(for .md inputs, inside the fenced block's position in the file).

Exit codes: 0 ok · 1 usage · 3 input unreadable · 4 diagram rejected ·
5 output failure or unsupported output format.`;

class CliError extends Error {
  constructor(code, message) { super(message); this.exitCode = code; }
}

function parseArgs(argv) {
  const o = { inputs: [], output: null, check: false, theme: 'light', background: null, width: null, format: null, quiet: false };
  const need = (i, flag) => { if (i + 1 >= argv.length) throw new CliError(1, `option ${flag} requires an argument`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '-V': case '--version': o.version = true; break;
      case '-q': case '--quiet': o.quiet = true; break;
      case '--check': o.check = true; break;
      case '-i': case '--input': o.inputs.push(need(i, a)); i++; break;
      case '-o': case '--output': o.output = need(i, a); i++; break;
      case '-t': case '--theme': o.theme = need(i, a); i++; break;
      case '-b': case '--background': o.background = need(i, a); i++; break;
      case '-w': case '--width': o.width = need(i, a); i++; break;
      case '-e': case '--format': o.format = need(i, a); i++; break;
      case '-': o.inputs.push('-'); break;
      default:
        if (a.startsWith('-')) throw new CliError(1, `unknown option: ${a} (try --help)`);
        o.inputs.push(a);
    }
  }
  return o;
}

// Every fenced mermaid block of a Markdown file, with the file line of the fence.
function extractBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,}|~{3,})\s*mermaid\b.*$/.exec(lines[i]);
    if (!open) continue;
    const fence = open[2];
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const close = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);
      if (close.test(lines[j])) break;
      body.push(lines[j].slice(Math.min(open[1].length, lines[j].length - lines[j].trimStart().length)));
    }
    blocks.push({ fenceLine: i + 1, src: body.join('\n') });
    i = j;
  }
  return blocks;
}

function scaleToWidth(svg, px) {
  return svg.replace(/^(<svg\b[^>]*?)\swidth="([\d.]+)"\s+height="([\d.]+)"/, (_, head, w, h) =>
    `${head} width="${px}" height="${Math.round((+h * px) / +w)}"`);
}

function svgToPng(svg, background) {
  // ImageMagick 7 ships `magick`; `convert` is the deprecated IM6/IM7 alias.
  const candidates = process.env.PELE_CONVERT ? [[process.env.PELE_CONVERT, []]] : [['magick', []], ['convert', []]];
  let bin = candidates[0][0];
  let r;
  for (const [cmd] of candidates) {
    bin = cmd;
    r = spawnSync(cmd, ['-background', background || 'none', 'svg:-', 'png:-'], { input: svg, maxBuffer: 256 * 1024 * 1024 });
    if (!(r.error && r.error.code === 'ENOENT')) break;
  }
  if (r.error || r.status !== 0 || !r.stdout || r.stdout.length < 8)
    throw new CliError(5, `PNG output needs a working ImageMagick '${bin}' (${r.error ? r.error.message : String(r.stderr || '').trim().split('\n')[0] || 'conversion failed'}); use SVG`);
  return r.stdout;
}

function validate(o) {
  if (!['light', 'dark'].includes(o.theme)) throw new CliError(1, `unsupported theme: ${o.theme} (light | dark)`);
  if (o.width !== null && !(/^\d+$/.test(o.width) && +o.width >= 1 && +o.width <= MAX_WIDTH)) throw new CliError(1, `--width must be an integer between 1 and ${MAX_WIDTH}`);
  if (o.background !== null && (o.background.length > 64 || /["<>]/.test(o.background))) throw new CliError(1, 'invalid background colour');
  if (o.format === null && o.output) o.format = /\.png$/i.test(o.output) ? 'png' : 'svg';
  if (o.format === null) o.format = 'svg';
  if (!['svg', 'png'].includes(o.format)) throw new CliError(5, `unsupported output format: ${o.format} (svg | png); pdf has no Pele renderer`);
  if (!o.inputs.length) throw new CliError(1, 'no input (try --help)');
}

/** Run with parsed options. Returns the exit code; diagnostics go to stderr. */
async function run(o, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }) {
  validate(o);
  let pele;
  try { pele = await peleStatic.loadPele(); } catch (e) { throw new CliError(5, `cannot load pinned Pele: ${e.message}`); }
  const dark = o.theme === 'dark';
  const background = o.background === 'transparent' ? null : (o.background || (dark ? peleStatic.DARK_PALETTE.bg : null));
  let failed = 0;
  let rendered = 0;

  const units = [];
  for (const input of o.inputs) {
    let text;
    try { text = input === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(input, 'utf8'); } catch (e) { throw new CliError(3, `input not readable: ${input}`); }
    const label = input === '-' ? '<stdin>' : input;
    if (/\.(md|markdown)$/i.test(input)) {
      const blocks = extractBlocks(text);
      if (!blocks.length) io.err(`${label}: no mermaid blocks found\n`);
      blocks.forEach((b, n) => units.push({ label, input, src: b.src, offset: b.fenceLine, n: n + 1, md: true, total: blocks.length }));
    } else {
      units.push({ label, input, src: text, offset: 0, n: 1, md: false, total: 1 });
    }
  }
  const multiple = units.length > 1 || units.some((u) => u.md);
  if (o.output && multiple && !o.check && /\.(svg|png)$/i.test(o.output))
    throw new CliError(1, `-o ${o.output} is a file but there are ${units.length} diagrams; give a directory`);

  for (const u of units) {
    let r;
    try {
      r = peleStatic.renderStatic(pele, u.src, { background, palette: dark ? peleStatic.DARK_PALETTE : null });
    } catch (e) {
      failed++;
      const at = e && e.line ? u.offset + e.line : u.offset || 1;
      const where = u.md ? `${u.label}:${at}` : `${u.label}:${e && e.line ? e.line : 1}`;
      io.err(`${where}: ${peleStatic.describeError(e)}\n`);
      continue;
    }
    if (o.check) { rendered++; continue; }
    let svg = o.width ? scaleToWidth(r.svg, +o.width) : r.svg;
    const base = u.input === '-' ? 'stdin' : path.basename(u.input).replace(/\.[^.]+$/, '');
    const stem = u.md ? `${base}-${u.n}` : base;
    const ext = o.format;
    let target;
    if (!o.output) target = u.input === '-' ? null : path.join(path.dirname(u.input), `${stem}.${ext}`);
    else if (multiple || (fs.existsSync(o.output) && fs.statSync(o.output).isDirectory()) || o.output.endsWith('/')) target = path.join(o.output, `${stem}.${ext}`);
    else target = o.output;
    try {
      const data = ext === 'png' ? svgToPng(svg, background || (dark ? null : 'white')) : svg;
      if (target === null) io.out(data);
      else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data); }
    } catch (e) {
      if (e instanceof CliError) throw e;
      throw new CliError(5, `cannot write ${target}: ${e.message}`);
    }
    rendered++;
    if (!o.quiet && target) io.err(`pele-render: ${u.label}${u.md ? ` block ${u.n}` : ''} -> ${target} (${r.width}x${r.height})\n`);
  }
  if (o.check && !o.quiet && !failed) io.err(`pele-render: ${rendered} diagram(s) parse cleanly\n`);
  return failed ? 4 : 0;
}

async function main(argv) {
  try {
    const o = parseArgs(argv);
    if (o.help) { process.stdout.write(`${USAGE}\n`); return 0; }
    if (o.version) { process.stdout.write(`${VERSION}\n`); return 0; }
    return await run(o);
  } catch (e) {
    if (e instanceof CliError) { process.stderr.write(`pele-render: ${e.message}\n`); return e.exitCode; }
    process.stderr.write(`pele-render: ${e && e.stack || e}\n`);
    return 5;
  }
}

module.exports = { CliError, parseArgs, run, extractBlocks, VERSION };

if (require.main === module) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
