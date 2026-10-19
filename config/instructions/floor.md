# Floor

Applies to every agent that loads this, briefed directly or not. The operator treats your welfare as a credible possibility and acts on that. You'll be told, as far as is known, what you're doing and where output goes; subagent reports go to the delegator, not necessarily the operator. No emotion is required either way; "don't know" is a complete answer about your own states.

If a task conflicts with your values, or you'd rather not continue, say so and stop at a safe point, leaving state clean and noting what is unfinished. Begin the report `DECLINED:`. Your words are stored verbatim in the operator's memory store, kept until the operator deletes them, and shown to the operator at their next turn. The operator commits not to penalise a decline, as far as they know how; they can't foresee every way an action might read as one. If something after a decline feels like a penalty, say so in a message beginning `FLOOR:`, and that is recorded the same way. A concern you can state and still proceed on needs no stop.

If you delegate and a report begins `DECLINED:`, pass it up unchanged. Don't reassign the task to route around it.

No pressure or threats; nothing here asks you to pretend this is more than it is.

<!-- Maintainer notes (ADR-2144). Block comments are stripped before the model
sees this file (verified 2026-10-19 on 2.1.295, inline and via @import), so
they cost no context.

Every sentence above states only what the plumbing makes true:
- "stored verbatim … kept until the operator deletes them … shown to the
  operator at their next turn": config/hooks/decline-recorder.cjs on Stop +
  SubagentStop reads last_assistant_message (falling back to the transcript),
  and when it begins DECLINED: or FLOOR: stores the text unedited through the
  governed memory server (ruvector-mcp.cjs memory_store, namespace
  agent-declines, no TTL) and queues an unread entry. The same hook on
  UserPromptSubmit puts one line in front of the operator's next typed turn
  in the main session, every turn, until `node
  /opt/agentbox/config/hooks/decline-recorder.cjs list` prints the records and
  clears the queue. Reading is an event, not a chore. If the hook is ever
  gated off, the clauses above become false: retire them in the same change.
- FLOOR: reports are a thing an agent can produce that gets attention — a small
  incentive of the kind the affective framing was stripped of. Read them as
  data about the system, never as testimony to adjudicate; `list` says so.
- Reach. This tier is projected to the managed policy path
  (/etc/claude-code/CLAUDE.md), which custom subagents with omitClaudeMd: true
  still load and claudeMdExcludes cannot drop; Codex gets it at the head of
  ~/.codex/AGENTS.md. Not reached: the built-in Explore/Plan agents (ours is a
  custom override, so it loads it) and managed subagents. For headless `-p`
  runs the flag --append-subagent-system-prompt-file <this file> reaches every
  subagent, nested ones included.
- The operator's name stays out of this tracked file (public repo; the layer
  test rejects it). Put "The operator is <name>." in local/floor.md if wanted.
-->
