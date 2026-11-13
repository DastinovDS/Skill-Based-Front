"""Temporary diagnostics of #1029 (removed before merge)."""

import copy
import statistics
import timeit
from dataclasses import dataclass, field


@dataclass(slots=True)
class _Item:
    key: int
    value: int


def _workload(n: int = 5000) -> int:
    items = {i: _Item(i, (i * 7919) % 1009) for i in range(n)}
    order = sorted(items, key=lambda k: (items[k].value, k))
    total = 0
    for k in order:
        item = items[k]
        if item.value % 3 == 0:
            total += item.key
    return total


@dataclass(slots=True)
class _Node:
    nid: int
    owner: int
    stock: int
    nbrs: list[int] = field(default_factory=lambda: [])


def _graph(n: int) -> dict[int, _Node]:
    g = {i: _Node(i, i % 2, i % 7) for i in range(n)}
    for i in range(n):
        g[i].nbrs.extend(((i * 31 + 7) % n, (i * 17 + 3) % n, (i + 1) % n))
    return g


_G = _graph(20000)


def _bfs_copy() -> int:
    g = copy.deepcopy(_G)
    seen = {0: 0}
    queue = [0]
    for nid in queue:
        d = seen[nid] + 1
        for m in g[nid].nbrs:
            if m not in seen:
                seen[m] = d
                queue.append(m)
    return sum(sorted(seen.values()))


for label in ("first", "again"):
    for name, fn, reps in (
        ("w5k", _workload, 200),
        ("w50k", lambda: _workload(50000), 40),
        ("bfs_copy20k", _bfs_copy, 20),
    ):
        runs = timeit.repeat(fn, number=1, repeat=reps)
        print(
            f"WORKLOAD {label} {name}: min {min(runs) * 1e3:.3f} ms, "
            f"median {statistics.median(runs) * 1e3:.3f} ms"
        )
