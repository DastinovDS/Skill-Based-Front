"""The bake time budget of the map tests, scaled to the speed of the machine they run on (#869).

`docs/design/map-format.md`: baking one map takes up to `BAKE_SECONDS` of CPU time on the reference
machine (`docs/perf.md`). A shared CI runner under pytest-xdist is two to three times slower, so a
fixed 10 s flaked there (10.17 s) though nothing regressed. The budget is therefore scaled by how
much slower this machine runs a fixed numpy workload than the reference machine, measured in the
same process right before and right after the bake (the slower of the two, so a burst of load
during the bake is seen). The workload does not use `gow_maps`, so a slower bake still trips the
budget on any machine; a faster machine keeps the full budget. On the reference machine the ridge
bake takes about 4 s and the workload 0.25 s, so a bake about 2.5 times slower than now fails
anywhere, as the fixed budget did on the reference machine.
"""

import time
from collections.abc import Callable

import numpy as np
import pytest

BAKE_SECONDS = 10
# CPU time of `reference_seconds()` on the reference machine (Apple M4, docs/perf.md), unloaded.
REFERENCE_SECONDS = 0.25


def reference_seconds() -> float:
    """CPU time of a fixed numpy workload like the bake (element-wise maths on a map raster)."""
    started = time.process_time()
    a = np.linspace(0.0, 1.0, 1_600_000).reshape(1000, 1600)
    for _ in range(10):
        a = np.sqrt(np.abs(np.sin(a * 7.0) + np.roll(a, 3, axis=0) * 0.5))
        a = np.cumsum(a, axis=1) / 1600.0
    return time.process_time() - started


@pytest.fixture
def bake_budget() -> Callable[[], float]:
    """Call after the bake: `BAKE_SECONDS` times how much slower this machine is (at least 1)."""
    before = reference_seconds()

    def budget() -> float:
        slower = max(before, reference_seconds()) / REFERENCE_SECONDS
        return BAKE_SECONDS * max(1.0, slower)

    return budget
