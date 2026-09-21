//! `system-one-eval` — the measurement rig for System One backends.
//!
//! It runs the estate's labelled routing corpus against *any* System One
//! endpoint — TypeSafe's Jev or the sovereign façade — using the exact request
//! `skill-route.cjs` sends, and reports accuracy, soft accuracy, latency,
//! tokens, cost and a backend-versus-backend parity diff.
//!
//! ```text
//! system-one-eval run --backend http://systemone:8097/v1/systemone
//! system-one-eval parity \
//!     --a-url https://api.typesafe.ai/v1/systemone --a-model jev-latest --a-key "$TYPESAFE_API_KEY" \
//!     --b-url http://systemone:8097/v1/systemone   --b-model laya-typed-decisions
//! system-one-eval copy-ceiling --backend http://systemone:8097/v1/systemone \
//!     --concurrency 1 --timeout-ms 120000
//! ```
//!
//! Three reporting rules are structural. Cases the backend failed to answer are
//! counted as wrong, never dropped — a rig that quietly excludes its failures
//! measures the backend's good days. And the cases whose discriminative clause
//! sits late in the skill description are reported as their own subgroup,
//! because that is the subgroup naive 48-token truncation destroys and
//! deliberate compression is supposed to save; an aggregate number hides
//! exactly the effect the exercise is about.
//!
//! The third is the input-exposure control in [`copy`]. The gold label of a
//! routing case is the *name of an option whose rubric the judge is shown*, so
//! exposure is total and some of the measured accuracy is delivery of exposed
//! text rather than judgement. Every `run` therefore reports a copy ceiling and
//! the signed gain over it beside its accuracy, as the method's source paper
//! recommends; the `copy-ceiling` subcommand adds the embedding ceiling, the
//! per-item interval, the power projection and the subgroup breakdown.

pub mod client;
pub mod copy;
pub mod corpus;
pub mod metrics;
pub mod runner;
