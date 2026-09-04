---
title: TimesFM forecasting assessment
description: September 2026 release verification, monitor data readiness and bounded evaluation scope.
status: assessed-deferred
last_updated: 2026-09-04
---

# TimesFM forecasting assessment

TimesFM-3 is a credible candidate for evaluating correlated resource demand, but
is deferred from the Agentbox builder. Its released pretrained weights are
restricted to non-commercial, non-production use. The upstream README separates
the Apache-2.0 code licence from that restriction; adding an opt-in flag would
not make production use permissible. See the [upstream release
notice](https://github.com/google-research/timesfm#license-notice-for-pretrained-weights)
and [weight licence](https://huggingface.co/google/timesfm-3.0-pytorch/blob/main/LICENSE).

No package, model download, service, endpoint or automatic remediation is added
by this assessment. No inference benchmark was run.

## Verified release surface

Google's [31 August announcement](https://research.google/blog/timesfm-3-a-zero-shot-foundation-model-for-multivariate-forecasting/)
describes joint targets, historical covariates, known future covariates and
quantile forecasts. Those capabilities could support CPU, memory and request-rate
forecasts with planned workload schedules as inputs. This is an Agentbox use-case
inference, not measured performance on our estate.

The [official repository](https://github.com/google-research/timesfm) exposes
`timesfm3.TimesFM3Evaluator`, `ModelConfig` and `predict_batch`. Its multivariate
example uses target arrays shaped `(variates, context_length)`, past-only
covariates over the context, and known future covariates over context plus
horizon. This is a Python/PyTorch implementation; the reviewed release does not
establish a supported Rust inference path. A Rust port would need numerical
parity tests and a separate maintenance justification.

The [official model card](https://huggingface.co/google/timesfm-3.0-pytorch)
publishes weights and configuration but lists no hosted inference provider.
The announcement says BigQuery integration is forthcoming; it does not establish
an available TimesFM-3 hosted API. Recheck both surfaces before implementation.

## Existing data and gaps

| Source | Present capability | Gap before forecasting |
| --- | --- | --- |
| [System monitor](../../management-api/utils/system-monitor.js) | Timestamped CPU, GPU, memory and disk snapshots | No historical collector in this module; normalise units and retain samples at a declared cadence |
| [Shared metrics registry](../../management-api/observability/metrics.js) | Adapter and HTTP counters, latency histograms, process metrics | An exporter is not a history store; verify a scraper, retention and range-query access |
| [Project telemetry](../../management-api/observability/project-metrics.js) | Current project gauges and scan/publish counters | Sparse state changes and cumulative totals need explicit target definitions |
| [System pane](../../config/tmux-autostart.sh) | SystemScape visual history with a process monitor | This wiring establishes a display, not an exportable retained dataset |
| [Quartz wrapper](../../gui-tools-sidecar/forecast_quartz.py) | Existing domain-specific solar forecast | Different target and data contract; no evidence that TimesFM would improve it |

The inspected builder and monitor paths do not establish a retained, aligned
multivariate dataset. An external scraper may already exist; its actual history
and missing-data rate must be checked rather than inferred from `/metrics`.
RuVector semantic memory is not a substitute for a time-series history store.

## Bounded next implementation

1. Define one decision: an advisory capacity forecast over a fixed horizon.
   Select units, sampling interval, identity scope and a small target set before
   collecting data. Start with memory used and request rate; add GPU demand only
   where sensor coverage is reliable.
2. Export an authorised history through the existing observability deployment.
   Require monotonic UTC timestamps, stable series labels, units, missingness
   masks and workload/restart markers. Convert counters to reset-aware rates;
   derive latency statistics from histogram intervals. Do not interpolate across
   restarts or fill unavailable sensors with zero.
3. Compare persistence and seasonal-naive forecasts using rolling time cut-offs.
   Hold out complete later windows, fit preprocessing only on earlier samples,
   and require enough history for the selected seasonal baseline. Report MAE,
   quantile loss, interval coverage, false alerts, inference latency and peak
   memory. Scheduled inputs must have been knowable at the forecast cut-off.
4. Evaluate TimesFM-3 only where the licence permits the specific research use,
   with pinned code and checkpoint revisions and bounded local inputs. A future
   production candidate needs suitable rights or another eligible model. The
   upstream README identifies TimesFM-2.5 weights as Apache-2.0, but eligibility
   alone does not establish better forecasts than the baselines.
5. Proceed only if the candidate improves the declared error/alert budget within
   the hardware budget. Retain observed threshold alerts during stale data,
   missing series, model errors and workload shifts. Label predictions and their
   uncertainty separately from observations; do not let forecasts restart agents
   or change memory automatically.

If a service becomes justified, gate both its package and supervisor entry in
the manifest, register its apply class, and use the existing durable adapter
contracts for stored results. Keep heavy inference in an explicitly provisioned
worker; a small Rust client can validate inputs, enforce timeouts and report
advisory results. Rebuild testing should then cover disabled-feature behaviour,
offline startup, stale-data handling and the measured forecast comparison.

## Verification

Assessment checked against the linked upstream announcement, repository, model
card and licence on 4 September 2026. Local source inspection covered the five
paths above. Production integration remains deferred on licensing fit, historical
data readiness and demonstrated forecast value, rather than missing source code.
