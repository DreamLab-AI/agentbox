#!/usr/bin/env python3
"""Write the hand-up packet for a work item that spent its whole budget.

An instruction to hand up after so many minutes cannot be obeyed by a model inside a
session: it has no wall clock, and one deep in a rabbit hole is the last thing able to
notice it is in one. So the harness keeps the clock, and when an item's budget runs out
this writes the packet on its behalf, in the shape `scripts/handup.mjs` reads.

Usage: handup-budget.py <out.json> <item id> <budget seconds> <item dir>
"""
import datetime
import json
import sys

out, item, budget, item_dir = sys.argv[1:5]
packet = {
    "id": f"{item}-budget",
    "written": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "tier_requested": "T1",
    "reason": "prerequisite",
    "ask": "unblock",
    "question": (
        f"The {item} step used its whole {budget}s budget without producing its artefact; "
        "what was missing, and is the step or the estate at fault?"
    ),
    "gate": {"name": f"item.{item}", "output": f"{item_dir}/transcript.jsonl"},
    "artifacts": {"chapter": f"{item_dir}/transcript.jsonl"},
    "attempts": [],
    "resume": {"harness": "opencode", "session": None, "model": None, "profile": None, "home": None},
    "budget_spent": {"tokens": 0, "wall_seconds": int(budget)},
    "blocks": [],
}
with open(out, "w") as handle:
    json.dump(packet, handle, indent=2)
    handle.write("\n")
print(f"hand-up packet written for {item} ({budget}s budget spent)")
