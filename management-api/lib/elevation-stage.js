'use strict';

/**
 * elevation-stage — the page an elevation proposes, staged, validated on its
 * own, and handed to `vault propose --diff` (ADR-2116 / contract C2).
 *
 * `vault propose` requires `--diff`: the proposed page in full, or a directory
 * of them. An elevation candidate is not yet a page — it is a working note or a
 * memory record — so before the governed gate can run, this module writes the
 * candidate's PROMOTED FORM as a knowledge page:
 *
 *   type: Class, resource from the vocabulary slug rule (C1, the same
 *   `slugify` the apply path resolves with), status: draft, public: false,
 *   the extracted relations as frontmatter wikilinks, and
 *   `sources[id=origin]` pointing back at where it came from (the working
 *   page when there is one).
 *
 * The staged page must pass `vault validate --strict` ON ITS OWN, in a scratch
 * repository holding only the governed vocabulary, the manifest and the staged
 * page(s), before `propose` runs. A staged page that fails is reported as not
 * proposable, with the vault's own reasons, and never reaches the gate.
 *
 * One exception, and why: `DANGLING_LINK`. In a repository of one page every
 * relation target is dangling by construction; whether `is-a: [[Lidar]]`
 * points at a real class is a question for the REAL corpus, which `propose`
 * answers with its conflict detector and blockers. Everything else —
 * unknown keys, a missing required key, a bad status — is a property of the
 * page alone and is judged here.
 *
 * Every staging directory lives under `os.tmpdir()` ($TMPDIR) and is removed
 * in a `finally`, whatever the outcome. Nothing is kept: on approval, apply
 * writes the page the proposal's SIGNED diff adds — the bytes the human's
 * signature covers — not anything staged here.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { runVaultCommand, resolveVaultRepo, resolveIriToPage, slugify } = require('./ontology-apply');
const { runVaultPropose, IRI_NAMESPACE } = require('./ontology-propose');

/** The actor stamped as `generated.by` on every staged page. */
const STAGE_ACTOR = 'process:agentbox-kg-elevation/1.0';

/** Validation codes that are a property of the corpus, not of the page alone. */
const CORPUS_RELATIVE_CODES = new Set(['DANGLING_LINK']);

/** The frontmatter key the vocabulary maps `is_subclass_of` onto (`rdfs:subClassOf`). */
const SUBCLASS_KEY = 'is-a';

/**
 * A page id (filename stem) for a term. Page ids are vault-relative paths, so
 * a `/` would nest the page and a control character would not survive the
 * filesystem; both are replaced. `title` is always written on a staged page
 * (it names the file `vault create` writes).
 */
function pageIdFor(term) {
  const id = String(term)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!id || id === '.' || id === '..') {
    throw new Error(`elevation-stage: term ${JSON.stringify(term)} yields no usable page id`);
  }
  return id;
}

/**
 * A relation target as a frontmatter wikilink. The vault resolves links by
 * page id/title, so a target must already BE a page id here: IRIs are
 * resolved to ids against the real corpus first ({@link resolveRelationTargets}).
 */
function wikilink(target) {
  return `[[${String(target).trim()}]]`;
}

/**
 * Replace every `urn:ngm:class:` relation target with the id of the page that
 * answers to it in the REAL corpus — the same exact-slug resolver the apply
 * path uses. A slug is not a link target (`[[rgb-d-camera]]` dangles; the page
 * is `RGB-D Camera`), and a relation to a class the corpus does not hold is a
 * candidate that is not ready to propose.
 *
 * @returns {Promise<object>} a copy of the descriptor with resolved targets
 * @throws when an IRI resolves to zero or several pages
 */
async function resolveRelationTargets(p, { runVault = runVaultCommand } = {}) {
  const proposal = (p.propose_command && p.propose_command.proposal) || {};
  const resolve = async (t) => (String(t).trim().startsWith(IRI_NAMESPACE)
    ? resolveIriToPage(String(t).trim(), { runVault })
    : t);
  const isSubclassOf = await Promise.all((proposal.is_subclass_of || []).map(resolve));
  const relationships = {};
  for (const [key, targets] of Object.entries(proposal.relationships || {})) {
    relationships[key] = await Promise.all((Array.isArray(targets) ? targets : [targets]).map(resolve));
  }
  return {
    ...p,
    propose_command: {
      ...p.propose_command,
      proposal: { ...proposal, is_subclass_of: isSubclassOf, relationships },
    },
  };
}

/**
 * Where the candidate came from, as a `sources[id=origin].resource`: the
 * working page when the record names one, else the distilled lesson URN, else
 * the agentbox proposal URN.
 */
function originOf(p) {
  const raw = (p.candidate && p.candidate.raw) || {};
  const workingPage = raw.working_page || raw.source_page || raw.page || null;
  if (workingPage) return wikilink(workingPage);
  return p.source_lesson_urn || (p.candidate && p.candidate.lesson_urn) || p.proposal_urn || null;
}

/** A YAML scalar that is always safe: JSON strings are valid YAML. */
const q = (v) => JSON.stringify(String(v));

/**
 * Render the promoted form of one candidate as a knowledge page.
 *
 * @param {object} p        an extractor descriptor (`propose_command`, `candidate`, …)
 * @param {object} [opts]
 * @param {Date}   [opts.now]
 * @returns {{ id:string, iri:string, markdown:string }}
 */
function renderStagedPage(p, { now = new Date() } = {}) {
  const proposal = (p.propose_command && p.propose_command.proposal) || {};
  const term = proposal.preferred_term || (p.candidate && p.candidate.term);
  if (!term) throw new Error('elevation-stage: the candidate carries no term');
  const id = pageIdFor(term);
  const slug = slugify(term);
  if (!slug) throw new Error(`elevation-stage: ${JSON.stringify(term)} slugs to the empty string`);
  const iri = IRI_NAMESPACE + slug;

  // `title` is always declared: `vault create` names the file from it and
  // `vault propose` recognises a create by a title no page has.
  // The title IS the page id; a term that had to be sanitised to become one
  // survives as an alias rather than as a title the filesystem cannot hold.
  const lines = ['---', 'type: Class', `title: ${q(id)}`];
  lines.push(
    `resource: ${q(iri)}`,
    'public: false',
    'status: draft',
    `domain: ${q(proposal.domain || (p.candidate && p.candidate.domain) || 'personal')}`,
    'generated:',
    `  by: ${q(STAGE_ACTOR)}`,
    `  at: ${q(now.toISOString())}`,
  );
  const aliases = [...(id !== term ? [term] : []), ...(Array.isArray(proposal.alt_terms) ? proposal.alt_terms : [])];
  if (aliases.length) lines.push('aliases:', ...aliases.map(a => `- ${q(a)}`));

  // Relations: `is_subclass_of` is the vocabulary's `is-a`; every other
  // extracted relation keeps its own key. An unknown key is NOT filtered out
  // here — the standalone validation reports it, which is the point of it.
  const relations = {};
  if (Array.isArray(proposal.is_subclass_of) && proposal.is_subclass_of.length) {
    relations[SUBCLASS_KEY] = proposal.is_subclass_of;
  }
  for (const [key, targets] of Object.entries(proposal.relationships || {})) {
    const list = Array.isArray(targets) ? targets : [targets];
    if (list.length) relations[key] = (relations[key] || []).concat(list);
  }
  for (const key of Object.keys(relations).sort()) {
    lines.push(`${key}:`, ...relations[key].map(t => `- ${q(wikilink(t))}`));
  }

  const origin = originOf(p);
  if (origin) lines.push('sources:', '- id: origin', `  resource: ${q(origin)}`);
  lines.push('---');

  const body = proposal.definition || (p.candidate && p.candidate.definition) || '';
  return { id, iri, markdown: `${lines.join('\n')}\n${body.trim()}\n` };
}

/**
 * Validate staged pages on their own: a scratch repository with the governed
 * vocabulary and manifest from `repo`, and nothing in `knowledge/pages` but
 * the staged pages.
 *
 * @returns {Promise<{ ok:boolean, issues:object[] }>} issues that disqualify
 */
async function validateStandalone(pages, { repo, stageRoot, runVault = runVaultCommand }) {
  const scratch = path.join(stageRoot, 'validate-repo');
  fs.mkdirSync(path.join(scratch, 'ontology'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'knowledge', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'working', 'pages'), { recursive: true });
  fs.copyFileSync(path.join(repo, 'ontology', 'vocabulary.yaml'),
    path.join(scratch, 'ontology', 'vocabulary.yaml'));
  const manifest = path.join(repo, 'vault.toml');
  if (fs.existsSync(manifest)) fs.copyFileSync(manifest, path.join(scratch, 'vault.toml'));
  for (const page of pages) {
    fs.writeFileSync(path.join(scratch, 'knowledge', 'pages', `${page.id}.md`), page.markdown);
  }

  const report = await runVault(['validate', '--strict', '--json'],
    { repo: scratch, reportOnFailure: true });
  const k = report && report.knowledge;
  if (!k || !Array.isArray(k.issues)) {
    return { ok: false, issues: [{ code: 'VALIDATE_UNREADABLE', message: 'vault validate printed no report' }] };
  }
  const ids = new Set(pages.map(pg => pg.id));
  const issues = k.issues.filter(i => !CORPUS_RELATIVE_CODES.has(i.code));
  // An issue on no page (a manifest or vocabulary problem) disqualifies too:
  // the page cannot be judged sound against a broken frame.
  const disqualifying = issues.filter(i => !i.path || ids.has(i.path) || i.severity === 'error');
  return { ok: disqualifying.length === 0, issues: disqualifying };
}

/**
 * Stage, validate standalone, then run the governed `vault propose --diff`.
 *
 * `descriptors` is one extractor descriptor, or several when one elevation
 * yields several classes — then the pages go as a `--diff` DIRECTORY with a
 * `--title`, and vault raises ONE grouped proposal.
 *
 * @returns {Promise<object>} runVaultPropose's result, plus `proposable`,
 *   `stage_issues` and `staged` (page ids). A candidate whose staged page fails
 *   validation returns `{ proposable:false, blocked:true, stage_issues }` and
 *   `vault propose` is never run.
 */
async function gateElevation(descriptors, deps = {}) {
  const list = Array.isArray(descriptors) ? descriptors : [descriptors];
  if (list.length === 0) throw new Error('elevation-stage: nothing to stage');
  const env = deps.env || process.env;
  const runVault = deps.runVault || runVaultCommand;
  const now = deps.now || new Date();

  const stageRoot = fs.mkdtempSync(path.join(deps.tmpRoot || os.tmpdir(), 'kg-elevation-'));
  try {
    let resolved;
    try {
      resolved = [];
      for (const p of list) resolved.push(await resolveRelationTargets(p, { runVault }));
    } catch (err) {
      return notProposable(list, [], [{ code: 'RELATION_TARGET_UNRESOLVED', message: err.message }]);
    }
    let pages;
    try {
      pages = resolved.map(p => renderStagedPage(p, { now }));
    } catch (err) {
      return notProposable(list, [], [{ code: 'STAGE_FAILED', message: err.message }]);
    }
    const dupes = pages.filter((pg, i) => pages.findIndex(o => o.id === pg.id) !== i);
    if (dupes.length) {
      return notProposable(list, pages, dupes.map(d => ({
        code: 'STAGE_COLLISION', path: d.id, message: 'two candidates stage the same page id',
      })));
    }

    let repo;
    try {
      repo = deps.repo || resolveVaultRepo(env);
    } catch (err) {
      return notProposable(list, pages, [{ code: 'NO_REPO', message: err.message }]);
    }

    const verdict = await validateStandalone(pages, { repo, stageRoot, runVault });
    if (!verdict.ok) return notProposable(list, pages, verdict.issues);

    const diffDir = path.join(stageRoot, 'diff');
    fs.mkdirSync(diffDir);
    for (const pg of pages) fs.writeFileSync(path.join(diffDir, `${pg.id}.md`), pg.markdown);

    const first = list[0].propose_command;
    const grouped = pages.length > 1;
    const args = {
      ...first.proposal,
      iri: grouped ? first.iri : pages[0].iri,
      level: first.level,
      hypothesis: first.hypothesis,
      diff: grouped ? diffDir : path.join(diffDir, `${pages[0].id}.md`),
      ...(grouped ? { title: deps.title || `Elevate ${pages.map(pg => pg.id).join(', ')}` } : {}),
    };
    const outcome = await runVaultPropose(args, { env, runVault });
    return { ...outcome, proposable: !outcome.blocked, stage_issues: [], staged: pages.map(pg => pg.id) };
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

function notProposable(list, pages, issues) {
  const reason = issues.map(i => `${i.code}${i.path ? ` (${i.path})` : ''}: ${i.message}`).join('; ');
  return {
    command: list[0].propose_command,
    proposal: null,
    event: null,
    blockers: [],
    blocked: true,
    proposable: false,
    stage_issues: issues,
    staged: pages.map(pg => pg.id),
    error: `staged page is not proposable — ${reason}`,
  };
}

module.exports = {
  STAGE_ACTOR,
  CORPUS_RELATIVE_CODES,
  pageIdFor,
  wikilink,
  resolveRelationTargets,
  originOf,
  renderStagedPage,
  validateStandalone,
  gateElevation,
};
