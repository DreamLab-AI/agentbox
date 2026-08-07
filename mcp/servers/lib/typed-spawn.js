'use strict';

/**
 * typed-spawn — a typed, DID-attributed recursive-spawn contract (prime-agent
 * candidate 4, bound to our substrate).
 *
 * Prime-agent's rlm() spawns ANONYMOUS, UNTYPED children. We already exceed the
 * raw capability (Skill tool + skill-router + agent_spawn/task_orchestrate), so
 * the real adoptable is the CONTRACT prime lacks. Every subagent spawned through
 * here is:
 *
 *   (a) a child BEAD under the parent epic — work-DAG attribution, using the
 *       addDependency()/dep-aware getReady() resurrected in beads 1.1.0, so the
 *       recursion is a real dependency graph, not anonymous fan-out;
 *   (b) TYPED — its input/output are ontology-class IRIs validated against the
 *       live corpus; an unknown IRI is rejected before any work is spawned;
 *   (c) OWNED — the child inherits the parent's DID/Nostr identity as its actor,
 *       so sovereign ownership propagates down the subagent tree.
 *
 * The heavy lifting (retrieval, reasoning, actual agent execution) stays with the
 * orchestrator; this is the thin typing+attribution+ownership skin over a spawn.
 */

/** Resolve the ontology + beads backends (both overridable for tests). */
function loadDeps(opts) {
  let ontology = opts.ontology;
  if (!ontology) {
    const { createLocalOntology } = require('./ontology-local.js');
    ontology = createLocalOntology();
  }
  let beads = opts.beads;
  if (!beads) {
    const { LocalSqliteBeadsAdapter } = require('../../../management-api/adapters/beads/local-sqlite.js');
    beads = new LocalSqliteBeadsAdapter({ dbPath: opts.dbPath || ':memory:' });
  }
  return { ontology, beads };
}

/** Validate a list of ontology IRIs/slugs; throw on any unknown; return canonical IRIs. */
function validateIris(ontology, iris, role) {
  const bad = [];
  const canonical = [];
  for (const iri of iris || []) {
    const c = ontology.classGet({ iri });
    if (c.error) bad.push(iri);
    else canonical.push(c.iri);
  }
  if (bad.length) throw new Error(`${role} references unknown ontology IRIs: ${bad.join(', ')}`);
  return canonical;
}

/**
 * Create a spawn context bound to a parent epic and an owner DID.
 * @param {object} [opts]
 * @param {string} [opts.owner]      - owner DID (default AGENTBOX_REFINE_OPERATOR or did:nostr:jjohare)
 * @param {string} [opts.epicId]     - existing parent epic; created if absent
 * @param {string} [opts.epicTitle]  - title when creating the epic
 * @param {object} [opts.ontology]   - ontology backend override
 * @param {object} [opts.beads]      - beads adapter override
 * @param {string} [opts.dbPath]     - beads db path (default :memory:)
 */
async function createSpawnContext(opts = {}) {
  const { ontology, beads } = loadDeps(opts);
  const owner = opts.owner || process.env.AGENTBOX_REFINE_OPERATOR || 'did:nostr:jjohare';

  let epicId = opts.epicId;
  if (!epicId) {
    // Ownership is an axis distinct from `actor` (which is the CLAIM — who works
    // the bead). Carry the owner DID in tags so `getReady` (actor IS NULL) still
    // treats children as runnable, and a worker can claim-and-run without taking
    // ownership. This is the sovereign-ownership-vs-claim separation.
    const epic = await beads.createEpic({ title: opts.epicTitle || 'session work ledger', tags: [`owner:${owner}`] });
    epicId = epic.id;
  }

  /**
   * Spawn a typed, owned child: mint a child bead under the epic, validate typed
   * input IRIs, and register any blocking dependencies in the work-DAG.
   * @returns {Promise<{beadId, epicId, owner, skill, typedInput, status}>}
   */
  async function spawnChild({ title, skill, inputIris, blockedBy } = {}) {
    if (!title) throw new Error('title is required');
    const typedInput = validateIris(ontology, inputIris, 'input'); // rejects unknown IRIs first
    const child = await beads.createChild({
      title,
      parent_id: epicId,
      // owner DID in tags (ownership, propagated from parent); actor left null so
      // the child stays runnable in getReady until a worker claims it.
      tags: [`owner:${owner}`, `skill:${skill || 'none'}`, ...typedInput.map((i) => `in:${i}`)],
    });
    for (const blocker of blockedBy || []) {
      await beads.addDependency(child.id, blocker); // work-DAG edge
    }
    return { beadId: child.id, epicId, owner, skill: skill || null, typedInput, status: child.status };
  }

  /**
   * Complete a child: validate typed output IRIs, then close the bead.
   * @returns {Promise<{beadId, owner, typedOutput, status}>}
   */
  async function completeChild(beadId, { outputIris, outcome } = {}) {
    const typedOutput = validateIris(ontology, outputIris, 'output');
    const closed = await beads.close(beadId, outcome || 'done');
    return { beadId, owner, typedOutput, status: closed.status };
  }

  /** Children ready to run — unblocked in the work-DAG (all blockers closed). */
  async function ready() {
    const rows = await beads.getReady({ parent_id: epicId });
    return rows.map((b) => ({ beadId: b.id, title: b.title, actor: b.actor }));
  }

  return { epicId, owner, spawnChild, completeChild, ready, _beads: beads };
}

module.exports = { createSpawnContext, validateIris, loadDeps };
