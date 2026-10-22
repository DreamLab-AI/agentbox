#!/usr/bin/env python3
"""Repeatability: compare two isaac-motion-export/1 directories sample by sample.

    compare_runs.py <export_a> <export_b> [--tol-pos 1e-4] [--tol-rot 1e-4]

Same configuration and seed should reproduce a trajectory within the backend's tolerance, not
necessarily bit for bit (GPU solvers are not promised deterministic). The tolerances are declared
here before the comparison, the worst deviations are reported, and a bitwise-identical result is
reported as such rather than assumed. Exit 0 within tolerance, 3 outside, 2 on a structural mismatch.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
for cand in (os.path.join(HERE, "..", "..", "..", "isaac-sim-sidecar", "lib"), "/opt/isaac-sim-assets/lib"):
    if os.path.isdir(cand):
        sys.path.insert(0, cand)
        break
import motion_export as me  # noqa: E402


def main(argv):
    a_dir, b_dir = argv[0], argv[1]
    opt = dict(zip(argv[2::2], argv[3::2]))
    tol_pos, tol_rot = float(opt.get("--tol-pos", 1e-4)), float(opt.get("--tol-rot", 1e-4))
    ha, sa, _ = me.validate(a_dir)
    hb, sb, _ = me.validate(b_dir)
    if len(sa) != len(sb) or ha["time"] != hb["time"] or [b["id"] for b in ha["bodies"]] != [b["id"] for b in hb["bodies"]]:
        print(json.dumps({"pass": False, "error": "structure differs (sample count, time model or bodies)"}))
        return 2
    worst_pos = worst_rot = 0.0
    identical = True
    for x, y in zip(sa, sb):
        identical &= x == y
        for bid, bx in x["bodies"].items():
            by = y["bodies"][bid]
            worst_pos = max(worst_pos, math.dist(bx["p"], by["p"]))
            dot = max(-1.0, min(1.0, abs(sum(p * q for p, q in zip(bx["q"], by["q"])))))
            worst_rot = max(worst_rot, 2.0 * math.atan2(math.sqrt(max(0.0, 1.0 - dot * dot)), dot))
    report = {"samples": len(sa), "bitwise_identical": identical, "worst_position_m": worst_pos,
              "worst_rotation_rad": worst_rot, "tolerances": {"position_m": tol_pos, "rotation_rad": tol_rot},
              "pass": worst_pos <= tol_pos and worst_rot <= tol_rot}
    print(json.dumps(report))
    return 0 if report["pass"] else 3


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
