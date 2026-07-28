# Section C — Narrative Tells (Fiction)

Apply when sanitising short stories, novel passages, character-driven scenes,
or any narrative prose. Lexical fixes are not enough: AI fiction converges on a
narrow set of structural defaults. Source: Russell et al., *StoryScope*
(arXiv:2604.03136, 2026), parallel corpus of 61,608 stories across 5 LLMs and
human authors.

The percentages below are AI-vs-human rates from that study; treat them as a
strong prior, not a hard rule.

## C1. Thematic Over-Explanation

AI states the theme/moral explicitly 77% of the time vs. 52% for humans.
Narrators announce the lesson learned. Subplots tidily echo the main theme.

**Fix:** Delete the narrator's thematic commentary. Let the reader infer.
Allow subplots to drift. If a character's arc ends with stated insight,
either cut the statement or move it into ambiguous action.

| Slop | Repair |
|------|--------|
| "She realised, then, that grief was simply love with nowhere to land." | (delete the line — show the realisation through what she does next) |
| Narrator: "And so, in the end, he learned that..." | (cut entirely) |

## C2. Embodied Emotion Over Labels

AI conveys emotion through body 81% of the time vs. 38% for humans. Tight
throats, cold sweat, dimming light. Humans use explicit emotion labels 29%
of the time; AI only 8%.

**Fix:** Mix. Sometimes name the feeling ("she was furious"). Use bodily
sensation sparingly and only where it earns its place. Stop using setting as
mood mirror in every scene.

| Slop | Repair |
|------|--------|
| "A cold weight settled in his chest. The lamplight dimmed. The wallpaper seemed to lean in." | "He was scared." (or: a single concrete bodily detail, then move) |

## C3. Single-Track Plots

79% of AI stories have no subplots, vs. 57% for humans. Causal chains are
tight; loose ends are tied. Protagonists drive their own resolution 69% of
the time (vs. 46% human).

**Fix:** Introduce at least one subplot that does not resolve. Let an event
have multiple causes, some off-page. Let the resolution come partly from
chance, secondary characters, or refusal to act.

## C4. Tidy Resolutions, Especially Internal-Acceptance Endings

AI defaults to "the protagonist understands and accepts" (47% vs. 27%).
Epilogues are over-represented (a Claude fingerprint). Endings rarely
unsettle.

**Fix:** Cut the epilogue. End on the ambiguous beat. Let the protagonist
be wrong, or unchanged, or worse off. The reader does not need closure.

## C5. Linear Chronology

AI tells the story from first clue to grand reveal. Humans use flashbacks,
flash-forwards, and nonlinear framing far more often (anachrony intensity
2.58 vs. 2.31; nonlinear framing 1.96 vs. 1.68 on 1-5 scales).

**Fix:** Consider opening at the funeral and spiralling backward. Withhold
the inciting incident. Let a revelation force re-reading of earlier scenes.

## C6. Vague Allusions Over Named References

AI uses unnamed "implicit echoes" 72% of the time (vs. 50% human). It avoids
naming real brands, places, works, or people. Humans cite specific texts and
authors at nearly double the rate (47% vs. 24%).

**Fix:** Name the band, the pub, the novel, the brand of cigarette. Specificity
signals a human who lived in a world rather than a model trained on its
silhouette.

## C7. No Fourth-Wall Breaks

Humans break the fourth wall 67% of the time vs. 39% for AI; they address
the reader directly 28% vs. 7%.

**Fix:** If the voice permits it, let the narrator acknowledge the reader.
"You may think this was foolish. It was." Use sparingly.

## C8. Over-Engineered Sensory Description

AI over-indexes on olfactory imagery (82% vs. 57%) and lush sensory density
generally. Spatial granularity runs higher than human writing.

**Fix:** Drop most of the smell descriptions. Leave rooms partially undrawn.
Trust the reader's imagination to fill in walls, weather, light.

## C9. Philosophical-Debate Dialogue

AI characters debate ideas in dialogue 59% of the time (vs. 34% human).
Conversations become essays in disguise.

**Fix:** Cut philosophical exchanges. Replace with action, deflection, or
talking past each other. People rarely argue ideas cleanly; they argue
about who left the milk out.

## C10. Morally Clear Protagonists

Human stories have morally ambivalent protagonists 59% of the time; AI only
38%. AI heroes do the right thing for the right reasons.

**Fix:** Give the protagonist a petty motive alongside the noble one. Let
them be cruel in a small way. Decline to signal which choices are admirable.

## C11. Per-Model Fingerprints

If you know which model generated the draft, watch for:

| Model | Tell |
|-------|------|
| Claude | Flat event escalation; reverent toward literary tradition; epilogues; avoids dream sequences; "quiet endings". |
| GPT | Dream sequences; gossip/rumour as plot mechanism (64% vs. 44-55%); distant retrospective framing ("years later..."); ensemble casts. |
| Gemini | External character description as the introduction; bleak/oppressive settings (88%); tidy denouements; extended endings. |
| DeepSeek | Front-loaded context that humans would withhold. |
| Kimi | The generic centre — few distinctive choices, blandly competent. |
