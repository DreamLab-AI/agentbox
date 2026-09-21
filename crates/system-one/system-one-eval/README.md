# system-one-eval

The measurement rig for System One backends: runs the estate's labelled routing
corpus against *any* endpoint — TypeSafe's Jev or the sovereign façade — and
reports accuracy, soft accuracy, latency, tokens, cost and a backend-versus-backend
parity diff. Internal to this repository — `publish = false`.

## Running it

```bash
# through the sidecar (stages the corpus and skills tree in for you)
./agentbox.sh systemone eval
./agentbox.sh systemone eval inspect
./agentbox.sh systemone eval parity --a-url https://api.typesafe.ai/v1/systemone \
    --a-key "$TYPESAFE_API_KEY" --b-url http://127.0.0.1:8097/v1/systemone

# directly
system-one-eval run --backend http://systemone:8097/v1/systemone \
    --cases tests/system-one/routing-cases.json --skills-dir /opt/agentbox/skills

# sweep the decline threshold, one whole corpus run per value
system-one-eval sweep --backend http://systemone:8097/v1/systemone \
    --from 0.0 --to 1.0 --step 0.1
system-one-eval sweep --backend http://systemone:8097/v1/systemone \
    --thresholds 0.3,0.4,0.5,0.6 --json sweep.json
```

`inspect` reads the corpus and the skills tree and calls nothing — use it to see
what is about to be measured.

## What it sends

Byte-for-byte the request `config/hooks/lib/skill-route.cjs` sends: the same
instructions, the same `none` rubric, the same 9000/3000-character prompt clamp,
the same question name. The candidate map is built from the skills tree the same
way `loadCandidates` builds it, including the status exclusions. A rig that sent
anything else would be measuring a backend nobody calls.

## What it reports, and why in that shape

* **Accuracy and soft accuracy** (label in the top three — the router's advisory
  line shows three, so top-3 is the number that matches what the model sees).
* **Failures counted as wrong, never dropped.** A run that answered 62 of 86
  cases and got 36 right is a 41.9% run, not a 58% run.
* **Per class** (`near-neighbour`, `boundary`, `single`, `none`) from the corpus.
* **Per discriminator position.** `late` means the expected skill's boundary
  clause ("NOT for…", "rather than…", "unless…") begins beyond the per-option
  token budget — the cases laya's unconditional 48-token, tail-first option
  truncation destroys and deliberate compression is meant to save. The corpus
  may carry an explicit `late_discriminator` flag; when it does not, the rig
  derives the subgroup from the descriptions under test. At the current tree
  that is **32 of 86 cases** at a 44-token budget.
* **Adaptation**, when the backend reports an `sso` block: how many options were
  actually judged of how many offered, how many state windows, what the rubrics
  were compressed to, and the façade/engine timing split. Against a cloud
  backend this section is absent, which is the honest answer.
* **`none` behaviour**, always: how often declining was the right answer, how
  often it was the given one, and the resulting recall and precision. Accuracy
  on the `none` class alone hides the other half — a backend can score well on
  it by declining everything.

## The threshold sweep

Where an engine scores each option independently, declining is a *threshold* on
the best option's absolute score rather than a 116-way competition for one
probability mass. Which threshold is a measurement, so `sweep` runs the whole
corpus once per value and prints accuracy, soft accuracy, the `none` subgroup
(recall and precision), the late-discriminator and near-neighbour subgroups, and
p50 latency per threshold. The best-accuracy row is reported and **not**
applied: the operator sets the deployed value.

Against a backend whose engine has one shared head budget, a fixed threshold
would mean something different for every request, so the façade accepts the
field and does not apply it. The sweep detects that — no run reports a decline
rule — and says the numbers are one run repeated rather than a sweep.

The HTTP is [`system-one-client`](../system-one-client)'s and the request and
response types are [`system-one-core`](../system-one-core)'s, so the rig speaks
the same wire as the consumers rather than a lookalike of it. The request it
builds is checked by core's own `validate` in a unit test.
