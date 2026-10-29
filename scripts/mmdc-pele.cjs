#!/usr/bin/env node
'use strict';

// mmdc compatibility shim (ADR-2154). Existing skills and validators call
// `mmdc -i in.mmd -o out.svg`; this maps the flags the former sidecar client
// accepted onto pele-render and refuses, by name, the ones Pele cannot honour.

const { CliError, run } = require('./pele-render.cjs');

const USAGE = `Usage: mmdc -i <input.mmd|input.md> -o <output> [options]

Compatibility shim over pele-render (Pele renders; no browser is involved).

  -i, --input <file>            Input Mermaid file. Required ('-' reads stdin).
  -o, --output <file>           Output file. Required. Format inferred from the
                                extension unless -e is given.
  -e, --outputFormat <fmt>      svg | png (png needs ImageMagick). pdf is refused.
  -t, --theme <name>            default | dark. forest and neutral are refused.
  -w, --width <px>              Scale the SVG to this width.
  -b, --backgroundColor <c>     Background colour (default white; 'transparent').
  -q, --quiet                   No success message.
  -V, --version                 Print the version.
  -h, --help                    Show this help.

Refused with exit 1 because Pele has no equivalent: -H/--height, -s/--scale,
-c/--configFile, -C/--cssFile, -I/--svgId, -p/--puppeteerConfigFile, -f/--pdfFit.

Exit codes: 0 ok · 1 usage / refused option · 3 input unreadable ·
4 diagram rejected · 5 output failure.`;

const REFUSED = {
  '-H': 'height', '--height': 'height', '-s': 'scale', '--scale': 'scale', '-c': 'configFile', '--configFile': 'configFile',
  '-C': 'cssFile', '--cssFile': 'cssFile', '-I': 'svgId', '--svgId': 'svgId', '-p': 'puppeteerConfigFile',
  '--puppeteerConfigFile': 'puppeteerConfigFile', '-f': 'pdfFit', '--pdfFit': 'pdfFit',
};

function translate(argv) {
  const o = { inputs: [], output: null, check: false, theme: 'light', background: 'white', width: null, format: null, quiet: false };
  const need = (i, flag) => { if (i + 1 >= argv.length) throw new CliError(1, `option ${flag} requires an argument`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (REFUSED[a]) throw new CliError(1, `option ${a} (${REFUSED[a]}) has no Pele equivalent; the mmdc shim refuses it`);
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '-V': case '--version': o.version = true; break;
      case '-q': case '--quiet': o.quiet = true; break;
      case '-i': case '--input': o.inputs.push(need(i, a)); i++; break;
      case '-o': case '--output': o.output = need(i, a); i++; break;
      case '-e': case '--outputFormat': o.format = need(i, a); i++; break;
      case '-w': case '--width': o.width = need(i, a); i++; break;
      case '-b': case '--backgroundColor': o.background = need(i, a); i++; break;
      case '-t': case '--theme': {
        const t = need(i, a); i++;
        if (t === 'default') o.theme = 'light';
        else if (t === 'dark') o.theme = 'dark';
        else throw new CliError(1, `theme '${t}' has no Pele equivalent (default | dark)`);
        break;
      }
      default:
        if (a.startsWith('-')) throw new CliError(1, `unknown option: ${a} (try --help)`);
        throw new CliError(1, `unexpected argument: ${a} (try --help)`);
    }
  }
  return o;
}

async function main(argv) {
  try {
    const o = translate(argv);
    if (o.help) { process.stdout.write(`${USAGE}\n`); return 0; }
    if (o.version) { process.stdout.write('mmdc-pele 1.0 (pele-render shim, pele 1.12.0)\n'); return 0; }
    if (!o.inputs.length) throw new CliError(1, 'missing required -i <input> (try --help)');
    if (!o.output) throw new CliError(1, 'missing required -o <output> (try --help)');
    if (o.inputs.length > 1) throw new CliError(1, 'mmdc takes exactly one -i');
    return await run(o);
  } catch (e) {
    if (e instanceof CliError) { process.stderr.write(`mmdc: ${e.message}\n`); return e.exitCode; }
    process.stderr.write(`mmdc: ${e && e.stack || e}\n`);
    return 5;
  }
}

main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
