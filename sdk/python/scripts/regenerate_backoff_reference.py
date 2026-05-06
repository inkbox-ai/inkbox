#!/usr/bin/env python3
"""
Regenerate the backoff reference fixture.

Drives the Python tunnels-runtime backoff schedule against a fixed
input RNG sequence and emits the per-attempt result as JSON. The TS
SDK's `tests/tunnels/runtime.test.ts` loads the same JSON and asserts
that its runtime, given the same input sequence, produces the same
sleep durations within 1 ULP.

When either side's backoff formula changes, run this script and update
both Python and TS in the same PR. Without the fixture checked in,
"matches Python output" has no operational meaning over time.

Usage:
    python sdk/python/scripts/regenerate_backoff_reference.py
"""

from __future__ import annotations

import json
from pathlib import Path

# Mirror the constants in inkbox.tunnels.client._runtime.
BACKOFF_CAP = 30.0
BACKOFF_JITTER = 0.25

# Fixed input sequence — must stay byte-identical across regenerations
# unless the test on the TS side updates with the same sequence.
RNG_INPUTS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]


def schedule(rng_inputs: list[float]) -> list[dict[str, float]]:
    backoff = 1.0
    out: list[dict[str, float]] = []
    for attempt, r in enumerate(rng_inputs):
        backoff_in = backoff
        jitter = backoff * BACKOFF_JITTER * (2 * r - 1)
        sleep_for = max(0.1, backoff + jitter)
        backoff_out = min(backoff * 2, BACKOFF_CAP)
        out.append(
            {
                "attempt": attempt,
                "rng": r,
                "backoff_in": backoff_in,
                "jitter": jitter,
                "sleep_for": sleep_for,
                "backoff_out": backoff_out,
            },
        )
        backoff = backoff_out
    return out


def main() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    target = (
        repo_root
        / "sdk"
        / "typescript"
        / "tests"
        / "fixtures"
        / "backoff_reference.json"
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "constants": {"backoff_cap": BACKOFF_CAP, "backoff_jitter": BACKOFF_JITTER},
        "rng_inputs": RNG_INPUTS,
        "schedule": schedule(RNG_INPUTS),
    }
    target.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
