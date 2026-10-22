# isaac-motion-export/1

A directory: `motion.json` (header), `states.jsonl` (one sample per line), `contacts.jsonl`.
Writer, validator and analytic references: `isaac-sim-sidecar/lib/motion_export.py`
(`validate()` is the compliance check; `tests/isaac-sim/test_motion_export.py` pins it).

## Conventions (fixed, not inferred)

Right-handed, **Z up**, SI metres (`meters_per_unit` 1.0), quaternions **w, x, y, z**. A producer
converting from another convention records each step in `provenance.conversions`. The validator
rejects any other value, a non-unit quaternion, non-increasing timestamps, undeclared bodies,
a joint without `limits`, or a body without `mass` and `mass_estimated`.

## Header

`time`: `solver_dt`, `substeps`, `sample_dt`, `delivery_fps` (advisory; null by default). Simulation
time is continuous and is never the edit clock. Stop-motion cadence and exposure holds are applied
downstream; the continuous motion is the preserved artefact.
`bodies[]`: `id`, `parent`, `rest{p,q}`, `mass`, `mass_estimated`, `collision` (explicit proxy note).
`joints[]`: `id`, `type`, `parent`, `child`, `axis`, `limits [lo,hi]` (radians or metres; use
`[null,null]` for unlimited, never omit), `drive`.
`fields_unavailable[]`: fields the backend did not provide (for example `contacts.force`).
`provenance`: `source` (`isaac-sim` or `analytic-reference`), `simulated` (bool), `seed`, `conversions[]`,
plus the receipt's versions and input hashes via the job manifest.

## Samples

`states.jsonl`: `{"step","t","bodies":{id:{p,q,v,w}},"joints":{id:{pos,vel,effort}}}`.
`contacts.jsonl`: `{"step","t","a","b","impulse","force"}`; null where unavailable.

Estimated physical parameters (miniature scale, guessed inertias) must carry `mass_estimated: true`.
Whether to simulate a miniature, a full-scale character mapped into miniature rendering, or a
stylised proxy is a consumer decision; record it in the consumer's scene notes, not here.
USD scene interchange (UsdPhysics) travels alongside as `scene.usd` when a job writes one; URDF and
MJCF are accepted job inputs for articulated assets.
