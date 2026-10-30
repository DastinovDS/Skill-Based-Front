"""Charge ledger on full bot matches (#588): sources minus sinks equal the end stock exactly.

The expectation is the identity of ``gow_sim.analysis`` (docs/balance/charge-flow.md), not a value
read off the code: a nonzero residual means the simulation moved a charge no event explains.
"""

from dataclasses import replace
from pathlib import Path

import pytest

from gow_bots.bots import bot_factory
from gow_sim.analysis import MatchRecorder, analyze
from gow_sim.maps import PLAYERS, load_map
from gow_sim.match import run_headless
from gow_sim.ruleset import Ruleset, load_ruleset

ROOT = Path(__file__).resolve().parents[3]
MATCHES = [
    ("crossroads", "smart_rusher", "smart_expander", 0),
    ("highway", "smart_strangler", "smart_turtle", 1),
    ("ridge", "smart_reactive", "smart_rusher", 2),
]


@pytest.mark.parametrize("cost", [0, 1])
@pytest.mark.parametrize(("map_name", "bot0", "bot1", "seed"), MATCHES)
def test_the_ledger_balances_on_a_full_match(
    map_name: str, bot0: str, bot1: str, seed: int, cost: int
) -> None:
    base: Ruleset = load_ruleset(ROOT / "rulesets" / "mvp-1.toml")
    rules = replace(base, capture=replace(base.capture, charge_cost=cost))
    mapdef = load_map(ROOT / "maps" / f"{map_name}.json")
    controllers = [
        bot_factory(b)(mapdef, rules, seed=seed, player=p)
        for p, b in zip(PLAYERS, (bot0, bot1), strict=True)
    ]
    recorder = MatchRecorder()
    run_headless(mapdef, rules, controllers, observer=recorder)
    log = recorder.log()
    metrics = analyze(log)
    assert log.capture_charge_cost == cost
    for p in PLAYERS:
        flow = metrics.flow[p]
        assert flow.residual == 0, (p, flow)
        assert flow.end == log.stock[p][-1]
        assert sum(log.places_end[p]) == flow.end
        assert flow.start == sum(log.places_start[p])
        assert flow.delivered_front <= flow.delivered
        assert flow.front_empty_cap_has_ticks <= flow.front_empty_ticks <= flow.marker_ticks
        assert flow.marker_ticks <= log.ticks
    # The match is real: someone captured something, so the cost column is exercised.
    assert sum(metrics.captures) > 0
    if cost:
        assert sum(f.captures for f in metrics.flow) == cost * sum(metrics.captures)
