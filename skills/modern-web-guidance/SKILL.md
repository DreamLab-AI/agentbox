---
name: modern-web-guidance
description: "Look up modern web-platform implementation patterns and browser compatibility before choosing HTML, CSS or DOM APIs. Use for native dialogs/popovers, anchor positioning, container queries, view transitions, browser fallbacks, Core Web Vitals fixes, or replacing legacy frontend patterns. Complements framework and design skills. Not for visual styling direction (open-design), framework internals (leptos), driving a browser (browser), or testing a running page (qe-browser)."
license: Apache-2.0
---

# Modern Web Guidance

Use the GoogleChrome guidance corpus to choose platform primitives and fallbacks
before implementing the relevant HTML/CSS/DOM behaviour. Preserve the project's
framework, browser support policy and requested scope. This applies to the DOM
and CSS rendered by Rust/Leptos too; it does not require changing language or
replacing the framework.

## Search, retrieve, apply

Requires Node >=22, npm and network access on first use. Use the pinned CLI;
the wrapper runs it through Node because npm caches may be mounted noexec.
These commands do not install upstream skills or change harness configuration:

```sh
bash /opt/agentbox/skills/modern-web-guidance/scripts/guidance.sh search "light dismiss dialog"
bash /opt/agentbox/skills/modern-web-guidance/scripts/guidance.sh retrieve "<id returned by search>"
```

Before the image rebuild, replace `/opt/agentbox/skills` in these commands with
the checkout's absolute `skills` path.

- Search with a focused 2–5 word capability or component phrase. Split separate
  features into separate queries; omit framework and application names.
- Read the returned descriptions, then retrieve matching IDs (comma-separated
  IDs are supported). Do not invent IDs or treat search snippets as guidance.
- If matches are weak, rephrase once with a concrete component noun. Use `list`
  for discovery if needed. If the corpus has no relevant guide, use official
  platform documentation and state the gap.
- Read large retrieved guides from the output file in full when the CLI spills
  output to a file. Apply the relevant advice and verify the implementation
  against it; report the guide IDs and material choices or fallbacks concisely.

Use the project's explicit browser targets. Otherwise follow the guide's
Baseline Widely available policy and its fallbacks for newer features. A Chrome
smoke check alone does not establish cross-browser compatibility. Use feature
detection where the guide recommends it; do not add unrequested polyfills or
features. Adapt examples to framework lifecycles, SSR and DOM ownership.

If package retrieval or guidance lookup is unavailable, report that limitation
and use authoritative documentation; do not claim the corpus was consulted.

## Broad modernisation only

For an explicit broad legacy-pattern audit or modernisation request:

```sh
bash /opt/agentbox/skills/modern-web-guidance/scripts/guidance.sh legacy-scan <project-path> --json
```

Check findings against their `keepWhen` / `dropWhen` conditions before reporting
or editing. Retrieve the relevant guides and preserve required fallbacks. Scan
again after authorised changes, but do not remove safe code to force zero
matches. The scan covers only a subset of the corpus; it is not a complete web
quality audit. Specific feature tasks use search/retrieve instead.

## Composition and maintenance

- `open-design` owns visual direction; consult this skill for its HTML/CSS/DOM implementation.
- `leptos` owns framework behaviour; `visioncraft` owns delivery and proportionate checks.
- `browser` and `qe-browser` verify running behaviour and accessibility.

Read [upstream provenance and update procedure](references/upstream.md) when
updating the pin. This skill is discoverable through the all-skills router and
is deliberately absent from the always-loaded manifests.
