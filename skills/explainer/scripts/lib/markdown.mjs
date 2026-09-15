// A small, dependency-free Markdown renderer for the explainer's own build scripts.
//
// Why not a library. These scripts run over client material, often on a harness with no
// network and no install step, and a Markdown dependency would have to be audited to earn a
// place there. The subset below is exactly what a diagrams-as-code corpus and the prose
// around it use: ATX headings, fenced code, GFM tables, lists, blockquotes, rules,
// paragraphs, and inline emphasis, code, links and images. Anything it does not know how to
// mark up survives as escaped text rather than disappearing.
//
// Two rules that are not arbitrary:
//
//   Heading ids follow GitHub's slug, where punctuation is *deleted* rather than turned into
//   a hyphen. A generated register links to `#cp-146-...` for a heading "CP-14.6 ...", so a
//   renderer that produced `cp-14-6-...` would break every cross-reference in the corpus
//   while looking perfectly reasonable.
//
//   Fenced code is handed to the caller through `onFence`, because a mermaid block is not
//   code to a reader: it is a picture whose source is worth keeping one click away, and only
//   the caller knows what art it has for this block.
//
// Exports: render(markdown, options) -> html, slug(text), escapeHtml(text), frontMatter(text).

export const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// GitHub's heading slug: lowercase, strip everything that is not a word character, space or
// hyphen, then spaces to hyphens. `CP-14.6 Verify, twice` -> `cp-146-verify-twice`.
export const slug = (text) => String(text)
  .replace(/<[^>]+>/g, '')
  .trim()
  .toLowerCase()
  .replace(/[^\w\- ]+/g, '')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '');

const unquote = (s) => s.replace(/^["']|["']$/g, '');

// A deliberately small YAML reader: scalars, block lists and inline [a, b] lists. Corpus
// front matter uses nothing else.
export function frontMatter(text) {
  if (!text.startsWith('---\n')) return [{}, text];
  const end = text.indexOf('\n---', 4);
  if (end < 0) return [{}, text];
  const meta = {};
  let key = null;
  for (const line of text.slice(4, end).split('\n')) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) { (meta[key] = Array.isArray(meta[key]) ? meta[key] : []).push(unquote(item[1].trim())); continue; }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    const raw = kv[2].trim();
    if (!raw) { meta[key] = []; continue; }
    meta[key] = raw.startsWith('[')
      ? raw.replace(/^\[|\]$/g, '').split(',').map((s) => unquote(s.trim())).filter(Boolean)
      : unquote(raw);
  }
  return [meta, text.slice(text.indexOf('\n', end + 1) + 1)];
}

// ---------------------------------------------------------------- inline
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'");

function inline(src, opts) {
  // Code spans are lifted out first and put back last, so a path inside backticks is never
  // mistaken for emphasis and an underscore in an identifier stays an underscore. The
  // placeholder is delimited by control characters: escapeHtml leaves them alone, and no
  // prose contains them, so a literal number in the text can never be restored as a span.
  const spans = [];
  let text = String(src).replace(/(`+)([\s\S]*?)\1/g, (_m, _ticks, code) => {
    spans.push('<code>' + escapeHtml(code.replace(/^ | $/g, '')) + '</code>');
    return '' + (spans.length - 1) + '';
  });

  text = escapeHtml(text);

  // Images before links: the syntax differs by one leading character.
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_m, alt, href) => {
    const target = opts.resolveImage ? opts.resolveImage(unesc(href)) : unesc(href);
    if (!target) return '<span class="unlinked">' + alt + '</span>';
    return '<img src="' + escapeHtml(target) + '" alt="' + alt + '" loading="lazy">';
  });

  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_m, label, href, title) => {
    const target = opts.resolveLink ? opts.resolveLink(unesc(href)) : unesc(href);
    if (target === null || target === undefined) {
      // A path this build does not publish is text, not a link that fails when clicked.
      return '<span class="unlinked" title="not published in this pack">' + label + '</span>';
    }
    return '<a href="' + escapeHtml(target) + '"' + (title ? ' title="' + title + '"' : '') + '>' + label + '</a>';
  });

  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s.,;:)!?])/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  text = text.replace(/&lt;br\s*\/?&gt;/gi, '<br>');

  return text.replace(/(\d+)/g, (_m, n) => spans[Number(n)]);
}

// ---------------------------------------------------------------- block
/**
 * @param {string} md            markdown source, front matter already removed
 * @param {object} [opts]
 * @param {(lang:string, code:string, heading:string|null)=>string} [opts.onFence]
 *        called for every fenced block; returns the HTML to emit. Default: a <pre>.
 * @param {(href:string)=>string|null} [opts.resolveLink]  null means "do not link this"
 * @param {(href:string)=>string|null} [opts.resolveImage]
 * @param {(level:number, text:string, id:string)=>string|null} [opts.onHeading]
 *        returns HTML to emit for a heading, or null to take the default.
 * @param {number} [opts.headingShift] added to every heading level.
 */
export function render(md, opts = {}) {
  // An HTML comment is an instruction to whoever edits the file, not to whoever reads it. A
  // generated document opens with one, and showing it would be the first thing on the page.
  const lines = String(md).replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const shift = opts.headingShift ?? 0;
  let lastHeading = null;
  let i = 0;
  const para = [];

  const flushParagraph = () => {
    if (!para.length) return;
    const text = para.join('\n').trim();
    if (text) out.push('<p>' + inline(text, opts) + '</p>');
    para.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^(\s*)(`{3,}|~{3,})\s*([^\s`~]*)/);
    if (fence) {
      flushParagraph();
      const ch = fence[2][0] === '`' ? '`' : '~';
      const len = fence[2].length;
      const lang = (fence[3] || '').toLowerCase();
      const closer = new RegExp('^\\s*' + ch + '{' + len + ',}\\s*$');
      const body = [];
      i++;
      while (i < lines.length && !closer.test(lines[i])) { body.push(lines[i]); i++; }
      i++;
      const code = body.join('\n');
      out.push(opts.onFence
        ? opts.onFence(lang, code, lastHeading)
        : '<pre><code>' + escapeHtml(code) + '</code></pre>');
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      flushParagraph();
      const level = Math.min(6, h[1].length + shift);
      const raw = h[2];
      lastHeading = raw;
      const id = slug(raw);
      const custom = opts.onHeading ? opts.onHeading(h[1].length, raw, id) : null;
      // An alias lets a document that slugs headings by a different rule still reach this one.
      const alias = opts.headingAlias ? opts.headingAlias(raw) : null;
      const aliasTag = alias && alias !== id ? '<span class="anchor-alias" id="' + escapeHtml(alias) + '"></span>' : '';
      out.push(custom ?? (aliasTag + '<h' + level + ' id="' + escapeHtml(id) + '">' + inline(raw, opts) + '</h' + level + '>'));
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { flushParagraph(); out.push('<hr>'); i++; continue; }

    // GFM table: a row of pipes, then a delimiter row
    if (/\|/.test(line) && i + 1 < lines.length
        && /\|/.test(lines[i + 1]) && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1])) {
      flushParagraph();
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
      const head = cells(line);
      const aligns = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? ' style="text-align:center"' : /-+:$/.test(c) ? ' style="text-align:right"' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { rows.push(cells(lines[i])); i++; }
      // Wrapped, because a table wide enough to push the page sideways makes every paragraph
      // on it scroll too. Wide content scrolls inside its own box; the page never does.
      out.push('<div class="table-wrap"><table><thead><tr>'
        + head.map((c, n) => '<th' + (aligns[n] ?? '') + '>' + inline(c, opts) + '</th>').join('')
        + '</tr></thead><tbody>'
        + rows.map((r) => '<tr>' + head.map((_c, n) => '<td' + (aligns[n] ?? '') + '>' + inline(r[n] ?? '', opts) + '</td>').join('') + '</tr>').join('')
        + '</tbody></table></div>');
      continue;
    }

    // blockquote
    if (/^\s*>/.test(line)) {
      flushParagraph();
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { body.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push('<blockquote>' + render(body.join('\n'), opts) + '</blockquote>');
      continue;
    }

    // list
    const bullet = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      const ordered = /\d/.test(bullet[2]);
      const baseIndent = bullet[1].length;
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m && m[1].length <= baseIndent + 1) { items.push([m[3]]); i++; continue; }
        if (!items.length) break;
        if (m) { items[items.length - 1].push(lines[i].slice(baseIndent + 2)); i++; continue; }
        if (lines[i].trim() && /^\s{2,}/.test(lines[i])) { items[items.length - 1].push(lines[i].trim()); i++; continue; }
        if (!lines[i].trim() && i + 1 < lines.length && /^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i + 1])) { i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push('<' + tag + '>' + items.map((parts) => {
        const rest = parts.slice(1);
        const nested = rest.some((r) => /^\s*([-*+]|\d+[.)])\s+/.test(r))
          ? render(rest.join('\n'), opts)
          : (rest.length ? ' ' + inline(rest.join(' '), opts) : '');
        return '<li>' + inline(parts[0], opts) + nested + '</li>';
      }).join('') + '</' + tag + '>');
      continue;
    }

    if (!line.trim()) { flushParagraph(); i++; continue; }
    para.push(line);
    i++;
  }
  flushParagraph();
  return out.join('\n');
}

// Inline markup on its own, for a caller that assembles its own headings or captions and
// still wants `code`, **bold** and links handled the same way as the body text.
export const renderInline = (text, opts = {}) => inline(text, opts);

export default { render, renderInline, slug, escapeHtml, frontMatter };
