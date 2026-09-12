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

**A long document has to be written in pieces.** An orientation item did the work — eighty-five
tool calls, every source range opened and checked — generated a twenty-three-thousand-character
note covering all fifteen chapters, and lost it: the write was rejected because a second tool
call's arguments were spliced into the middle of the content string, so the JSON would not parse.
Ten minutes of generation, one malformed call, nothing on disk. The larger the single write, the
likelier this is, and a local model asked for a long document will reach for one call.

So say it in the item: write the file with the first section, then append each further section in
its own call. That also makes the earlier advice real — an item that writes as it goes has
something on disk when the budget ends, and an item that writes once has nothing.

When it does happen, the output is usually recoverable: the rejected payload is in the
transcript, and reproducing it verbatim (cut at the splice, with the truncation marked) is
faithful to what the model produced. It is the transport that failed, not the judgement. Say in
the file that it was recovered and where it was cut.

**An instruction without a form is not an instruction.** "Ground every claim about behaviour by
citing it below the reading path" produced four chapters, five and a half thousand words, and not
one citation. The prose was excellent and entirely uncheckable. The model was not ignoring the
rule; it was told what to achieve and not what to write, and for an audience whose contract says
file paths must stay out of the reading path, "below the reading path" has no obvious shape.

The same thing happened in the same run with front matter: the reader build requires it, the item
was not given the block, and the chapter arrived without one.

So an item that must produce a particular shape is given that shape, literally, in the prompt:
the heading, the link form, the number of bullets that is usual. It costs four lines and it is the
difference between a chapter that can be audited and one that cannot.

The tell is worth learning to spot. When a rule states a property of the output rather than a
thing to write — grounded, checked, consistent, documented — ask what the model would have to
type to satisfy it. If the answer is not obvious to you, it will not be obvious to a session with
no memory of the convention.

**The browser's localhost is not yours.** A capture item runs in one container and drives a
browser in another. The session can `curl http://localhost:3000` and get the product; hand the
browser that same URL and it opens its own container's nothing. The failure is quiet: a
screenshot of a blank page or a connection error, saved under a filename claiming it shows the
product.

So the engagement's service manifest names both addresses and says which is which, and the
capture item is told to use the browser one. Check before the item runs, not after: open the
product in the browser yourself, from the address you are about to write down, and look at what
comes back. That also answers the second question the item cannot answer for itself — whether
the product is currently in a state worth photographing at all.

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

## A produced asset is not a delivered asset

Three times on one project, assets were made, gated and then reached nobody: clips no page
referenced, diagrams no chapter linked, captures no build attached. Each time everything looked
finished — files on disk, a gate passing them — and each time a reader would have seen none of it.

Existence and reachability are different properties, and only one of them is easy to check. So
have the build state reachability out loud, every run:

    Built 15 chapters + index; 12 of 15 have a clip, 9 have a picture, 11 have captures.
    3 chapter(s) still have no clip.
    41 capture(s) in the pack are shown on no page; declare them in the manifest or delete them.

That last line is the whole point. It converts a property no session can verify by looking at a
directory into a string a session can grep for. Then the instruction becomes a form rather than an
aspiration: *run the build and keep working until it stops printing that line*.

Attach by declaration, not by inference, whenever the asset's name is not already the chapter's.
A manifest of chapter id to file and caption also separates two things that want to be different:
the file name has to be honest so a review can judge it, and the caption has to be written for the
reader. Deriving the caption from the file name is what makes captions read like file names.

## The producer's file name is not evidence

A capture run wrote 133 files holding 76 distinct images: 24 pictures had each been saved under
several names, and the names contradicted each other. One image arrived as
`choose-a-campaign-variant-5`, `heatmap-by-section-and-variant-5` and
`timeline-for-the-selected-visit-5`. At most one of those is true, and a reviewer holding only one
of them cannot tell which.

Deduplicate by content hash before dealing review batches, keep the aliases in a file, and tell the
reading sessions plainly that names are not evidence. Otherwise the duplicates land in different
batches, no reviewer sees the contradiction, and a false name is copied into a caption.

## A measure that is a bounding box cannot see a hole

The emptiness check compared the trimmed bounding box to the whole frame. It is a good test for
blank border and a blind one for blank middle: a page that never painted its centre has content at
the top and content at the bottom, so it trims to nearly the full frame and scores 98%.

The fault's shape was one the measure could not represent. Reading down the image for a run of rows
with no variation across them, bounded by content above and below, separates cleanly — broken
pages read 47 to 52 per cent, sound ones nine or below.

Before trusting a gate, ask what shape of fault its measure cannot represent. Then take one bad
asset you know is bad and confirm the gate says so.

## An artefact that arrives late still counts

The runner judges an item when its process exits. An item that times out having already written
what the next step needs is recorded failed, and everything downstream is skipped — including the
steps that would have checked the work. A rescue that places the artefact ninety seconds later
cannot change that verdict, because the verdict has already been cast.

So apply the artefact rule on a loop rather than once: poll the status file, and for any failed
item whose `produces` globs all match non-empty files, promote it to done and log that it was
promoted and has not been looked at. A blind seeing item is not promoted by this, because its
refused output is moved aside and its globs no longer match, which is the right answer.
