'use strict';
// Regression: agent-action-pipeline returns `decision: 'deny'` (its contract suite
// pins that), while dispatchTaskSpawn compared against 'denied'. A denial therefore
// fell through to the allow branch, dereferenced a missing output and threw
// outside the route's try/catch: 500 where routes/tasks.js meant 403.
const path = require('path');
const actionPlane = require(path.join(__dirname, '..', '..', 'management-api', 'lib', 'action-plane.js'));

describe('action-plane denial normalisation', () => {
  it("maps the pipeline's 'deny' to the route-facing 'denied' and never reaches the executor", async () => {
    const processManager = { spawnTask: async () => { throw new Error('spawn must not run on a denial'); } };
    const logger = { warn() {}, info() {}, error() {}, debug() {} };
    const plane = actionPlane.getActionPlane({ processManager, logger });
    if (!plane.ready) {
      // No events adapter in this environment: dispatch reports unavailable
      // before any decision, which routes/tasks.js already maps to 503.
      const res = await actionPlane.dispatchTaskSpawn({ agent: 'a', task: 't', provider: 'p', claude_flow_agent_id: null }, { processManager, logger });
      expect(res.ready).toBe(false);
      return;
    }
    const original = plane.pipeline.dispatch;
    plane.pipeline.dispatch = async () => ({ decision: 'deny', reason: 'guard blocked', journal_event_id: 'evt-1' });
    try {
      const res = await actionPlane.dispatchTaskSpawn({ agent: 'a', task: 't', provider: 'p', claude_flow_agent_id: null }, { processManager, logger });
      expect(res).toEqual({ ready: true, decision: 'denied', denyReason: 'guard blocked', journalEventId: 'evt-1' });
    } finally {
      plane.pipeline.dispatch = original;
    }
  });
});
