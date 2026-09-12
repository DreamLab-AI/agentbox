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

**And an artefact does not prove it looked.** The rule that a prerequisite is satisfied by the
file rather than by a tidy exit is right nearly everywhere, and wrong for exactly this case. A
review item was sent four frames, the server refused them as too large, and the model wrote the
review anyway — listing the four filenames it had never received, in the voice of someone who
had opened them. The harness saw a file where its `produces` glob pointed and marked the item
done. That is how a fabrication gets laundered into a record.

So a seeing item whose attachments were refused now fails, whatever it wrote, and the file is
moved aside so the next item cannot glob it. The refusal is detectable — the transcript carries
the server's error — and detecting it is the whole job. **An output produced after the input was
refused is not evidence; it is what the model would have written with no input at all.**

The refusal itself is worth understanding, because the obvious mitigation is the wrong one. It
was not the model's context: it was an HTTP body limit, and the body is the whole conversation.
Every turn re-sends every attached image, so an item with four frames crosses the limit partway
through, after several tool calls have already succeeded. Capping the count is not enough; the
frames have to be small enough that the conversation containing them several times over still
fits. `ATTACH_PX` and `ATTACH_Q` set that, defaulting to 820px at a lower quality, which is about
a third of the bytes and still shows a title collision or a panel that failed to load.

So capture and inspection are always two steps. The capturing step writes frames and a
manifest of what each was meant to show. The inspecting step is launched with those frames
attached as input, sees them, and says what is actually there. `evals/run-chaptered.sh`
takes an `attach` list per work item for exactly this.

The general form is worth remembering beyond these two cases: **if a rule asks a session to
judge its own work against something the session cannot perceive, the rule is decoration.**
Put the perception in the harness, or put the judgement in a second session that can see.

**A session must not delegate.** A local model handed an open-ended exploration will reach for
a sub-agent, and that is the most expensive thing it can do: the nested session has none of the
context, gets none of the budget, and the outer session blocks on it with the clock running. A
measured item spent its full seventy-five minutes this way — eighteen file reads, one delegation,
and nothing written — on work that took four minutes once the reading was done for it. Say so in
the item: do it yourself in this session, do not delegate.

**A session that writes at the end writes nothing.** The item above had an answer worth keeping
at the forty-minute mark and no file to show for it, because it was still gathering. An item
whose output appears only after the last read loses everything when the budget ends, and the
budget ending is normal rather than exceptional. So the instruction is to write the artefact as
the first action, from whatever is already known, and improve it in place: a file that is half
right beats a better one the item did not reach. This also gives `produces` something to find,
which is what turns a timed-out item into a satisfied prerequisite.

## Hand the session an inventory, not a search

The failure above was not really about delegation. It was asked to derive a curriculum by
reading a thirty-four-thousand-line front end, which is not work a local model can finish, so it
did the only thing it could and tried to farm it out.

Reading a codebase to find out what a product lets someone do is mechanical, and mechanical work
belongs in a script. `scripts/surface-inventory.mjs` walks the interface code and writes the
route list with, under each route, the headings, buttons, table columns, field labels and
messages that appear on it:

```
node scripts/surface-inventory.mjs --repo <app dir> --out <slice>/user-surface-inventory.md
```

Two hundred lines out of thirty-four thousand, and the item reads it in one call. What comes back
is better than a summary the model would have written, because it is the product's own
vocabulary: a chapter named from it uses the words on the screen, which is also what lets the
capture item find the thing later and what lets a reader match the page to the pack.

The same principle applies wherever a session would otherwise search: the diagram corpus
(`scripts/diagram-corpus.mjs`), the citation index, the route map. Compute it once, hand it in,
and spend the session's budget on judgement instead of discovery.

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
