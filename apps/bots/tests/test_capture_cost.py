"""DEC-38 in the bots (#580): a capture costs ``capture.charge_cost`` real charges.

``takes`` against rows of the DEC-38 table (mechanics.md, section 4, "Capture costs a charge"),
and full matches with ``charge_cost = 1``: no bot sends a group that cannot pay to a node it does
not own, and the bounces of unpaid captures (``capture_failed``) stay rare instead of repeating.
"""

from collections import Counter
from dataclasses import replace
from pathlib import Path

import pytest

from gow_bots.bots import BOTS, shots_to_take, takes
from gow_sim.commands import Move, PlayerCommand
from gow_sim.maps import Terrain, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))


def _cost(rules: Ruleset, cost: int) -> Ruleset:
    return replace(rules, capture=replace(rules.capture, charge_cost=cost))


# ``takes`` on the rows of the DEC-38 table (its worked examples are in a forest) ------------------

# (row, charge_cost, attacker charged, plan bonus, defender units, defender charged, taken)
ROWS = [
    (1, 1, 2, 0, 0, 0, True),  # 2/2 into an empty neutral city
    (2, 1, 0, 0, 0, 0, False),  # 2/0: bounce
    (3, 1, 1, 0, 0, 0, True),  # 1/1 into an empty province
    (6, 1, 0, 0, 0, 0, False),  # 3/0 into an empty enemy city
    (10, 2, 1, 0, 0, 0, False),  # charge_cost 2: 3/1 into an empty neutral
    (13, 1, 4, 0, 2, 2, False),  # 4/4 against 2/2: the attack is left 4/0
    (14, 1, 5, 0, 2, 2, True),  # 5/5 against 2/2: 5/1 pays
    (15, 1, 2, 2, 2, 2, False),  # 2/2 + plan (+2) against 2/2: virtual charges do not pay
    (16, 1, 3, 2, 1, 0, True),  # 3/3 + plan (+2) against 1/0
    (18, 1, 0, 2, 0, 0, False),  # 2/0 + plan (+2) into an empty neutral
    (29, 0, 0, 0, 0, 0, True),  # charge_cost 0: 2/0 takes an empty node (today)
    (29, 0, 4, 0, 2, 2, True),  # charge_cost 0: 4/4 takes against 2/2 (today)
    (29, 0, 2, 2, 2, 2, True),  # charge_cost 0: 2/2 + plan (+2) against 2/2 (today)
]


@pytest.mark.parametrize(("row", "cost", "charged", "bonus", "units", "held", "taken"), ROWS)
def test_takes_follows_the_dec38_table(
    mvp1_rules: Ruleset,
    row: int,
    cost: int,
    charged: int,
    bonus: int,
    units: int,
    held: int,
    taken: bool,
) -> None:
    rules = _cost(mvp1_rules, cost)
    need = shots_to_take(rules, Terrain.FOREST, units, held) if units else 0
    assert takes(rules, charged, bonus, need) is taken, f"DEC-38 row {row}"


# Full matches with charge_cost = 1 ----------------------------------------------------------------

MAPS = ("crossroads", "highway", "ridge")
NAMES = (
    "smart_rusher",
    "smart_expander",
    "smart_turtle",
    "rusher",
    "reactive",
    "expander",
    "turtle",
    "random_legal",
)


def _play(name: str, map_name: str, rules: Ruleset, ticks: int) -> Counter[str]:
    """Self-play of bot ``name``: Moves to foreign nodes, those of groups that cannot pay, and
    the capture events."""
    mapdef = load_map(ROOT / "maps" / f"{map_name}.json")
    match = Match(mapdef, rules, KEY)
    bots = [BOTS[name](mapdef, rules, seed=1, player=p) for p in (0, 1)]
    cost = rules.capture.charge_cost
    seen: Counter[str] = Counter()
    seq = 0
    while match.tick < ticks and not match.finished:
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            for p in (0, 1):
                view = match.view(p)
                groups = {g.id: g for g in view.groups}
                for cmd in bots[p].decide(view, match.tick):
                    if isinstance(cmd, Move) and view.nodes[cmd.dest].owner != p:
                        seen["foreign"] += 1
                        g = groups.get(cmd.group)
                        if g is not None and g.charged < cost:
                            seen["unpaid"] += 1
                    cmds.append(PlayerCommand(p, seq, match.resolve(p, cmd)))
                    seq += 1
        for e in match.step(cmds):
            if e.kind in ("capture_failed", "node_captured"):
                seen[e.kind] += 1
    return seen


@pytest.mark.parametrize("map_name", MAPS)
@pytest.mark.parametrize("name", NAMES)
def test_no_bot_sends_a_group_that_cannot_pay(
    mvp1_rules: Ruleset, name: str, map_name: str
) -> None:
    seen = _play(name, map_name, _cost(mvp1_rules, 1), 3000)
    assert seen["foreign"] > 0, seen  # the bot does attack and claim
    assert seen["unpaid"] == 0, seen
    # A bounce now comes only from charges lost on the way, never from a loop of unpaid orders
    # (before #580 the bots bounced about twice per capture).
    assert seen["capture_failed"] * 10 <= seen["node_captured"], seen
