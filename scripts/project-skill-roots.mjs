#!/usr/bin/env node
// project-skill-roots.mjs — collapse the divergent ancestor skill roots (SK-2).
//
// The audit (audit-2026-07-15.md SK-2) found four skill roots that do not agree,
// so the set the Claude Code Skill tool sees depends on the launch CWD:
//   /opt/agentbox/skills          — 115, baked from source, THE canonical set
//   ~/.claude/skills              — manifest projection (SK-1, reconcile-skills.sh)
//   $WORKSPACE/.claude/skills      — hand-accreted, deprecated residue
//   $WORKSPACE/project/.claude/skills — 159, incl. the whole project-local AQE
//                                    fleet (56 uniques that exist nowhere else)
//
// This is the SK-2 half of the SK-1 projection mechanism: it makes the ancestor
// roots deterministic reflections of the one canonical source instead of
// independent, drifting copies. For every entry whose NAME has a baked
// counterpart it guarantees a canonical link (so a rebuild always yields the
// current skill and a CWD can never surface a stale snapshot); every entry that
// exists nowhere else — the project-local overlay (AQE fleet, testing family,
// v3-* set) — is PRESERVED untouched. Nothing is deleted: superseded real
// directories are moved into a hidden `.superseded/` sidecar so the collapse is
// always recoverable.
//
// DESIGN DECISION (documented, per the brief's two options): the 56 project-local
// uniques are kept as an INTENTIONAL OVERLAY LAYER, not enumerated into the baked
// canonical set. They are the agentic-qe fleet installed per-project by `aqe init`
// and are legitimately project-scoped; baking them would couple the image to one
// project's QE choices. So: ONE canonical source (baked /opt/agentbox/skills +
// registered-skills.txt), ancestor roots projected from it, project-local overlay
// preserved and reported.
//
// AMENDMENT 2026-09-16 (ADR-2092) — the manifest was being BYPASSED here.
// The loop above only ever *repaired* what it found: an ancestor entry whose name
// happened to be baked was freshened to a canonical link and kept, whether or not
// registered-skills.txt listed it. So the curated manifest governed ~/.claude/skills
// and nothing governed the ancestor roots, which still carried whatever `ruflo init`
// left behind — audited at 26 skills in $WORKSPACE/.claude/skills, ZERO of them
// registered, ~2,377 prompt tokens every turn, including three flow-nexus skills
// with no account behind them and one whose own description begins "DEPRECATED".
// The Skill tool reads the ancestor root when launched from a nested CWD, so those
// were live in the prompt.
//
// The ancestor roots now mirror the REGISTERED set. An entry that is neither
// registered nor named in overlay-skills.txt is retired to the same recoverable
// .superseded/ sidecar. The project-local overlay stays supported — it is now
// explicit (an allowlist) rather than implicit (whatever happened to be on disk),
// which is what the original DESIGN DECISION above wanted and could not enforce.
//
// Idempotent and FAIL-OPEN: always exits 0; never blocks boot.
//
// Usage: project-skill-roots.mjs [--dry-run]
//   env SKILLS_TREE          canonical baked tree (default /opt/agentbox/skills)
//   env SKILL_ROOT_TARGETS   ':'-separated ancestor roots to reconcile
//                            (default "$WORKSPACE/.claude/skills:$WORKSPACE/project/.claude/skills")
//   env WORKSPACE            workspace root (default /home/devuser/workspace)
//   env REGISTERED_SKILLS_MANIFEST  default <SKILLS_TREE>/registered-skills.txt
//   env OVERLAY_SKILLS_MANIFEST     default <SKILLS_TREE>/overlay-skills.txt

import fs from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry-run');
const SKILLS_TREE = process.env.SKILLS_TREE || '/opt/agentbox/skills';
const WORKSPACE = process.env.WORKSPACE || '/home/devuser/workspace';
const TARGETS = (process.env.SKILL_ROOT_TARGETS ||
  `${WORKSPACE}/.claude/skills:${WORKSPACE}/project/.claude/skills`)
  .split(':').map((s) => s.trim()).filter(Boolean);

const log = (m) => console.log(`[project-skill-roots]${DRY ? ' DRY' : ''} ${m}`);

// ── manifests ──────────────────────────────────────────────────────────────
// readNames: one name per line, '#' comments and blanks ignored. A missing file
// yields an empty set — fail-open, exactly like the shell reconcilers.
function readNames(file) {
  const out = new Set();
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      const n = raw.split('#')[0].trim();
      if (n) out.add(n);
    }
  } catch { /* absent → empty */ }
  return out;
}
const REGISTERED = readNames(process.env.REGISTERED_SKILLS_MANIFEST
  || path.join(SKILLS_TREE, 'registered-skills.txt'));
// Names kept in the ancestor roots despite not being registered — the explicit
// project-local overlay (e.g. the per-project `aqe init` fleet).
const OVERLAY_KEEP = readNames(process.env.OVERLAY_SKILLS_MANIFEST
  || path.join(SKILLS_TREE, 'overlay-skills.txt'));
// Guard: an empty registered set means the manifest is missing or unreadable.
// Retiring every entry on that basis would be a catastrophic misread of a
// transient error, so pruning is DISABLED when we could not load it.
const PRUNE_ENABLED = REGISTERED.size > 0;

// A name is "baked" (part of the canonical set) iff /opt/agentbox/skills/<name>/SKILL.md exists.
function isBaked(name) {
  try { return fs.existsSync(path.join(SKILLS_TREE, name, 'SKILL.md')); }
  catch { return false; }
}
// The canonical target every baked-named ancestor entry should resolve to.
const canonical = (name) => path.join(SKILLS_TREE, name);

// A symlink is "canonical-equivalent" if it is not broken, resolves to a dir that
// contains SKILL.md, and its resolved basename matches the entry name. This accepts
// both the baked tree (/opt/agentbox/skills/<name>) and the in-repo source tree
// (…/agentbox/skills/<name>) as valid canonical targets — content is identical
// (source == baked, verified by the audit) — so we never churn a working link.
function isCanonicalEquivalent(localPath, name) {
  try {
    if (fs.existsSync(path.join(localPath, 'SKILL.md'))) {
      const real = fs.realpathSync(localPath);
      return path.basename(real) === name && real.includes(`${path.sep}skills${path.sep}`);
    }
  } catch { /* broken link */ }
  return false;
}

function relink(localPath, name) {
  const target = canonical(name);
  if (DRY) return true;
  try { fs.rmSync(localPath, { recursive: true, force: true }); } catch { /* ignore */ }
  if (fs.existsSync(localPath) || isLink(localPath)) return false; // removal failed → skip loudly
  try { fs.symlinkSync(target, localPath); return true; } catch { return false; }
}

function isLink(p) { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } }

function supersedeThenLink(root, name) {
  // Move a divergent real directory into a hidden recoverable sidecar, then link
  // to canonical. Never destroys content.
  const localPath = path.join(root, name);
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const graveyard = path.join(root, '.superseded');
  const dest = path.join(graveyard, `${name}-${stamp}`);
  if (DRY) { log(`  would supersede realdir ${localPath} -> ${dest}, then link -> ${canonical(name)}`); return true; }
  try {
    fs.mkdirSync(graveyard, { recursive: true });
    fs.renameSync(localPath, dest);
  } catch {
    log(`  ERROR could not move ${localPath} to sidecar — leaving untouched`);
    return false;
  }
  try { fs.symlinkSync(canonical(name), localPath); return true; }
  catch { log(`  ERROR linking ${name} after supersede (content preserved at ${dest})`); return false; }
}

// Retire an unregistered entry from an ancestor root: no relink afterwards, the
// name simply stops being visible to the Skill tool. A symlink is unlinked (its
// content lives in the baked tree and is not ours to move); a real directory is
// moved into the same recoverable sidecar supersedeThenLink uses.
function retireUnregistered(root, name) {
  const localPath = path.join(root, name);
  if (DRY) { log(`  would retire unregistered: ${name}`); return true; }
  let st; try { st = fs.lstatSync(localPath); } catch { return false; }
  if (st.isSymbolicLink()) {
    try { fs.unlinkSync(localPath); return true; }
    catch { log(`  ERROR could not unlink ${localPath} — leaving untouched`); return false; }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const graveyard = path.join(root, '.superseded');
  const dest = path.join(graveyard, `${name}-${stamp}`);
  try {
    fs.mkdirSync(graveyard, { recursive: true });
    fs.renameSync(localPath, dest);
    return true;
  } catch {
    log(`  ERROR could not move ${localPath} to sidecar — leaving untouched`);
    return false;
  }
}

function reconcileRoot(root) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { log(`root absent, skipping: ${root}`); return; }

  const c = { ok: 0, relinked: 0, superseded: 0, overlay: 0, left: 0, retired: 0, divergent: [], gone: [] };
  for (const ent of entries) {
    const name = ent.name;
    if (name.startsWith('.')) continue;                 // hidden (.superseded, .env)
    const localPath = path.join(root, name);
    let st; try { st = fs.lstatSync(localPath); } catch { continue; }
    // Skip plain files (SKILL-DIRECTORY.md, mcp.json, *.json) — only dirs/links are skills.
    if (!st.isDirectory() && !st.isSymbolicLink()) continue;

    // Manifest first: an ancestor root mirrors the REGISTERED set. Being baked is
    // not a licence to be visible here — that was the leak (see the amendment at
    // the top of this file). An explicit overlay entry is exempt.
    if (PRUNE_ENABLED && !REGISTERED.has(name) && !OVERLAY_KEEP.has(name)) {
      if (retireUnregistered(root, name)) { c.retired++; c.gone.push(name); }
      else c.left++;
      continue;
    }

    if (isBaked(name)) {
      if (st.isSymbolicLink()) {
        if (isCanonicalEquivalent(localPath, name)) { c.ok++; continue; }
        // Broken or wrong-target symlink for a baked name → repair to canonical.
        if (relink(localPath, name)) { c.relinked++; log(`  repaired link: ${name} -> ${canonical(name)}`); }
        else c.left++;
      } else {
        // Real directory shadowing a baked skill → the drift/staleness class.
        // Supersede (recoverable) then link to canonical.
        if (supersedeThenLink(root, name)) c.superseded++; else c.left++;
      }
    } else {
      // No baked counterpart.
      const hasSkill = (() => { try { return fs.existsSync(path.join(localPath, 'SKILL.md')); } catch { return false; } })();
      if (hasSkill) { c.overlay++; c.divergent.push(name); }
      else c.left++;
    }
  }
  log(`root ${root}: canonical-ok=${c.ok} repaired=${c.relinked} superseded=${c.superseded} overlay-preserved=${c.overlay} retired=${c.retired} left=${c.left}`);
  if (c.divergent.length) log(`  overlay (allowlisted in overlay-skills.txt — preserved): ${c.divergent.sort().join(', ')}`);
  if (c.gone.length) log(`  retired (not in registered-skills.txt; recoverable under .superseded/): ${c.gone.sort().join(', ')}`);
  if (!PRUNE_ENABLED) log('  NOTE pruning disabled — registered-skills.txt empty or unreadable');
}

try {
  if (!fs.existsSync(SKILLS_TREE)) { log(`canonical tree missing (${SKILLS_TREE}) — no-op`); process.exit(0); }
  for (const root of TARGETS) reconcileRoot(root);
} catch (e) {
  log(`WARN non-fatal: ${e && e.message}`);
}
process.exit(0);
