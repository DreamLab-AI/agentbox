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
// Idempotent and FAIL-OPEN: always exits 0; never blocks boot.
//
// Usage: project-skill-roots.mjs [--dry-run]
//   env SKILLS_TREE          canonical baked tree (default /opt/agentbox/skills)
//   env SKILL_ROOT_TARGETS   ':'-separated ancestor roots to reconcile
//                            (default "$WORKSPACE/.claude/skills:$WORKSPACE/project/.claude/skills")
//   env WORKSPACE            workspace root (default /home/devuser/workspace)

import fs from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry-run');
const SKILLS_TREE = process.env.SKILLS_TREE || '/opt/agentbox/skills';
const WORKSPACE = process.env.WORKSPACE || '/home/devuser/workspace';
const TARGETS = (process.env.SKILL_ROOT_TARGETS ||
  `${WORKSPACE}/.claude/skills:${WORKSPACE}/project/.claude/skills`)
  .split(':').map((s) => s.trim()).filter(Boolean);

const log = (m) => console.log(`[project-skill-roots]${DRY ? ' DRY' : ''} ${m}`);

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

function reconcileRoot(root) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { log(`root absent, skipping: ${root}`); return; }

  const c = { ok: 0, relinked: 0, superseded: 0, overlay: 0, left: 0, divergent: [] };
  for (const ent of entries) {
    const name = ent.name;
    if (name.startsWith('.')) continue;                 // hidden (.superseded, .env)
    const localPath = path.join(root, name);
    let st; try { st = fs.lstatSync(localPath); } catch { continue; }
    // Skip plain files (SKILL-DIRECTORY.md, mcp.json, *.json) — only dirs/links are skills.
    if (!st.isDirectory() && !st.isSymbolicLink()) continue;

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
  log(`root ${root}: canonical-ok=${c.ok} repaired=${c.relinked} superseded=${c.superseded} overlay-preserved=${c.overlay} left=${c.left}`);
  if (c.divergent.length) log(`  overlay (project-local, exists nowhere else — preserved): ${c.divergent.sort().join(', ')}`);
}

try {
  if (!fs.existsSync(SKILLS_TREE)) { log(`canonical tree missing (${SKILLS_TREE}) — no-op`); process.exit(0); }
  for (const root of TARGETS) reconcileRoot(root);
} catch (e) {
  log(`WARN non-fatal: ${e && e.message}`);
}
process.exit(0);
