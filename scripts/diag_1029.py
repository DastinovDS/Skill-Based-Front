"""Temporary diagnostics of #1029 (removed before merge)."""

import statistics
import timeit
from dataclasses import dataclass


@dataclass(slots=True)
class _Item:
    key: int
    value: int


def _workload() -> int:
    items = {i: _Item(i, (i * 7919) % 1009) for i in range(5000)}
    order = sorted(items, key=lambda k: (items[k].value, k))
    total = 0
    for k in order:
        item = items[k]
        if item.value % 3 == 0:
            total += item.key
    return total


for label in ("first", "again"):
    runs = timeit.repeat(_workload, number=1, repeat=200)
    print(
        f"WORKLOAD {label}: min x{min(runs[:30]) / 1.29e-3:.2f} (30), min x{min(runs) / 1.29e-3:.2f} (200), "
        f"median x{statistics.median(runs) / 1.29e-3:.2f}"
    )
