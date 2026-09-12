# Running outside Claude Code

This skill's specialist handoffs assume an estate where a browser, a generator and a speech
service arrive as tools. A local agent harness often has none of them: it has a shell, a
file editor and a catalogue of skills, and nothing else. What it does next decides whether
the deliverable is reviewable.

The failure to avoid is improvisation. Given no browser tool, a capable model will write a
DevTools client in shell, copy it into a container and drive a page by hand. It works, and
it is worthless as evidence: no capture receipt, no declared mode or identity, nothing a
reviewer can reproduce, and a silent dependency on a private port that will not exist next
week. The same goes for inventing an encoding pipeline, a diagram renderer or a speech call.

## Resolve a capability in this order

1. **A skill in the catalogue.** Search it, read the entrypoint, follow its references. A
   local harness usually exposes the same skills through a `skill` tool; the fact that a
   capability is not a native tool does not mean the estate lacks it.
2. **A documented service in the engagement's service manifest.** The manifest is an
   engagement fixture, not part of this skill, because addresses belong to a deployment and
   not to a method. It names, per capability, the endpoint, how to check it is alive, and
   what a call must record. Read it, check health first, and keep the receipt.
3. **Hand up.** With neither, write a packet with `reason=specialist` and continue on work
   the packet does not block. An absent capability is a finding about the estate, and
   somebody should know; it is not licence to build a substitute.

A service manifest is small and belongs beside the other fixtures:

```json
{ "browser":  { "endpoint": "…", "health": "…", "records": "screenshot, url, viewport, mode, identity" },
  "images":   { "endpoint": "…", "health": "…", "records": "workflow, model, seed, job id" },
  "speech":   { "endpoint": "…", "health": "…", "records": "engine, voice, measured duration" } }
```

## A session cannot check itself

Two of this method's rules turned out to be unenforceable from inside a session, for the
same reason, and the fix is the same both times: move the check into a different session.

**A session has no clock.** "Hand up after twenty minutes on one sub-goal" cannot be obeyed
by something with no sense of elapsed time, and the moment it matters most is the moment the
model has least perspective. A measured item spent forty minutes building a protocol client
instead of taking the screenshot it was asked for, with that rule sitting unread in its
context. The budget belongs to the harness, which can end the item and write the packet.

**A session cannot see what it wrote.** "Look at every screenshot you take" cannot be obeyed
either: inside a session the picture is a path, not an image, and there is no way for the
model to attach a file to itself. A measured item captured seven frames, was told to inspect
each, and inspected none — not from carelessness, but because the tools available to it
carry text. One of those frames showed the product failing to load, with three panels
reading "fetch failed", under a filename claiming it showed the feature working.

The instruction "extract frames and look at them" is the trap, because the first half is
possible and the second is not: the item runs ffmpeg, writes forty frames, sees none of
them, and reports on all seven clips in the voice of someone who looked. That is worse than
admitting it could not see, and it happened on a measured run where a title collision
visible in the first frame a person opened went unmentioned in a review that passed
everything.

So a seeing item never fetches its own subject. The plan attaches it, the harness refuses an
item whose name says it looks and whose attachment list is empty, and an item that produces
the frames is a different item from the one that judges them.

So capture and inspection are always two steps. The capturing step writes frames and a
manifest of what each was meant to show. The inspecting step is launched with those frames
attached as input, sees them, and says what is actually there. `evals/run-chaptered.sh`
takes an `attach` list per work item for exactly this.

The general form is worth remembering beyond these two cases: **if a rule asks a session to
judge its own work against something the session cannot perceive, the rule is decoration.**
Put the perception in the harness, or put the judgement in a second session that can see.

## A long run prunes what it writes

An agent harness keeps a session store, and an unattended plan writes to it for hours. On
this estate that store sits on a 128 MB memory filesystem, and a day of runs filled it; the
next session died on a database checkpoint reporting that the disk was full, an error that
names neither the harness nor the plan that caused it. The growth is silent, the failure is
late, and it blames the wrong thing.

Two measures, in order. First, do not use the small filesystem: most harnesses take an
environment variable for their data directory, so point it at the run's own workspace on
real disk, where a long plan can grow without starving anything else. Second, keep pruning
as the safety net: a run that lasts hours checks its own headroom before each step and
prunes when it is low. The session store is a cache of past conversations, not a deliverable: no step reads
it, and removing it costs only the ability to resume an old session. Logs older than a day
go too. `evals/run-chaptered.sh` does this between work items.

The same care applies to what a run leaves behind: generated frames, intermediate renders
and model caches belong in the engagement workspace where they can be swept, never in the
target and never in a memory filesystem that something else depends on.

## What a service call still owes

A service reached over HTTP is a specialist by another route, so it owes what a specialist
owes: a health check before use, the request parameters recorded, an artefact on disk, and
a receipt naming the service, its revision if it reports one, and what was produced. A
capture with no receipt is not evidence, whichever tool made it. Generated imagery is
labelled as illustration whether a skill or a raw endpoint produced it.

Two habits keep a long unattended run honest. Resume a submitted job rather than
resubmitting when an observation times out, because a second job wastes shared capacity and
usually produces a second artefact nobody reviews. And never let a missing capability
quietly change the deliverable: if the clip cannot be made, the chapter ships without one
and says so in the production record, rather than borrowing something that looks similar.
