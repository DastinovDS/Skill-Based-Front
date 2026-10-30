"""Write the combat examples of the "How to play" screen (CLI-13, #72).

The examples are rows of ``packages/protocol/vectors/combat.json`` (the inputs: who stands
where, with which bonus). Each one is played here through the real systems of ``gow_sim`` under
the ruleset that is played (``rulesets/mvp-2.toml``), and the state after every round is
recorded. The client only draws the file (``apps/client/src/howto/combatExamples.gen.json``); it
never works out a fight (AGENTS.md, 7.1). The rule numbers the page quotes (a round in seconds,
the bonus per road, the price of a planned order, the VP period, ...) come from the same ruleset
and go into the same file.

    mise run regen:howto

(that is this script, then prettier on the file). The file is committed;
``tests/test_export_howto.py`` regenerates it and fails when it differs, and also compares every
outcome with the expected values of ``combat.json``, which come from ``docs/design/mechanics.md``,
not from the code.
"""

import json
from pathlib import Path
from typing import Any, Final

from gow_sim.commands import apply_commands
from gow_sim.maps import MapDef, parse_map
from gow_sim.match import SIM_VERSION
from gow_sim.ruleset import Ruleset, load_ruleset, ruleset_hash
from gow_sim.state import (
    AtNode,
    Event,
    GameState,
    Group,
    Mode,
    OnEdge,
    Order,
    initial_state,
)
from gow_sim.systems.combat import combat
from gow_sim.systems.movement import leg, movement
from gow_sim.systems.orders import active_bonuses, orders

ROOT: Final = Path(__file__).resolve().parents[1]
RULESET_PATH: Final = ROOT / "rulesets" / "mvp-2.toml"
VECTORS_PATH: Final = ROOT / "packages" / "protocol" / "vectors" / "combat.json"
OUT_PATH: Final = ROOT / "apps" / "client" / "src" / "howto" / "combatExamples.gen.json"

# The rows of the DEC-24 table shown on the page, with the id the client keys its texts by.
EXAMPLES: Final = (
    ("equal", 1),  # 2 charged against 2 charged: they cancel, the attack turns back
    ("surplus", 3),  # 4 charged against 2 charged: every surplus charge kills
    ("defenseless", 7),  # 2 charged against 3 without a charge: the unit without one dies
    ("planned", 9),  # a scheduled order: bonus shots in front of the real ones
)

TRAVEL: Final = 30  # ticks per edge of the little line the examples are played on


def _node(i: int, terrain: str, owner: int | None) -> dict[str, Any]:
    return {
        "id": i,
        "name": f"n{i}",
        "x": 10 * i,
        "y": 10,
        "terrain": terrain,
        "vp": 1,
        "kind": "city_large",
        "capital_of": None,
        "start_owner": owner,
        "start_units": 0,
        "start_charged": 0,
        "start_stock": 0,
    }


def _line(terrains: list[str], owners: list[int | None]) -> MapDef:
    """A path graph ``0 - 1 - 2``, capitals at the ends, ``TRAVEL`` ticks per edge."""
    n = len(terrains)
    nodes = [_node(i, terrains[i], owners[i]) for i in range(n)]
    nodes[0]["capital_of"], nodes[-1]["capital_of"] = 0, 1
    nodes[0]["kind"] = nodes[-1]["kind"] = "capital"
    edges = [
        {
            "id": i,
            "a": i,
            "b": i + 1,
            "max_level": 3,
            "travel_ticks": TRAVEL,
            "border_permille": 500,
        }
        for i in range(n - 1)
    ]
    data = {
        "meta": {"name": "line", "version": 1, "symmetry": "rot180", "width": 1000, "height": 20},
        "nodes": nodes,
        "edges": edges,
        "mirror": {
            "nodes": {str(i): n - 1 - i for i in range(n)},
            "edges": {str(i): n - 2 - i for i in range(n - 1)},
        },
    }
    return parse_map(data)


def _step(state: GameState, rules: Ruleset) -> list[Event]:
    """One tick: the commands (none), ``movement``, ``combat`` and ``orders``."""
    state.tick += 1
    state.events = []
    _, applied = apply_commands(state, rules, [])
    state.events += applied
    state.events += movement(state, rules)
    state.events += combat(state, rules, active_bonuses(state, rules))
    state.events += orders(state, rules)
    return list(state.events)


def _before_arrival(state: GameState, rules: Ruleset, edge: int, from_node: int) -> OnEdge:
    """On ``edge`` from ``from_node``, one tick before arriving at the other end."""
    to = state.map.edges[edge].other(from_node)
    way = leg(state.map, rules, edge, to)
    return OnEdge(edge, from_node, way.progress(way.ticks - 1))


def _num(e: Event, key: str) -> int:
    value = e.get(key)
    assert isinstance(value, int) and not isinstance(value, bool), (e.kind, key)
    return value


def _side(state: GameState, player: int) -> dict[str, int]:
    groups = [g for g in state.groups.values() if g.owner == player]
    return {"units": sum(g.units for g in groups), "charged": sum(g.charged for g in groups)}


def _play(vec: dict[str, Any], rules: Ruleset) -> dict[str, Any]:
    """Play one ``node_attack`` row: ``a`` (player 0) attacks the node of ``b`` (player 1)."""
    assert vec["location"] == "node_attack", vec["id"]
    mapdef = _line(["forest", vec["terrain"] or "forest", "forest"], [0, 1, 1])
    state = initial_state(mapdef, rules)
    for side, player in (("a", 0), ("b", 1)):
        spec = vec["sides"][side]
        for g in spec["groups"]:
            where: AtNode | OnEdge = (
                AtNode(1) if side == "b" else _before_arrival(state, rules, 0, 0)
            )
            order = None if side == "b" else Order((1,), False, 0)
            bonus = spec["bonus"]
            if bonus is not None and bonus["source"] == "planned_order":
                order = Order((1,), True, 0)
            gid = state.new_id()
            state.groups[gid] = Group(
                gid, player, g["units"], g["charged"], Mode(g["mode"]), where, order=order
            )
            if bonus is not None and bonus["source"] == "defense_mode":
                state.groups[gid].ticks_in_defense = (
                    bonus["amount"] * rules.orders.defense_ticks_per_bonus
                )
            elif bonus is not None:
                state.groups[gid].bonus = bonus["amount"]
    start = {"a": _side(state, 0), "b": _side(state, 1)}
    events = _step(state, rules)  # the contact, tick 1
    contact = state.tick
    started = [e for e in events if e.kind == "fight_started"]
    assert len(started) == 1, vec["id"]
    (fight,) = state.fights.values()
    bonus_start = {"a": fight.virtual[0], "b": fight.virtual[1]}
    bonus_left = dict(bonus_start)
    frames: list[dict[str, Any]] = []
    ended: list[Event] = []
    while not ended:
        events = _step(state, rules)
        assert state.tick <= contact + 400, "the fight does not end"
        rounds = [e for e in events if e.kind == "fight_round"]
        if rounds:
            (rnd,) = rounds
            bonus_left["a"] -= _num(rnd, "virtual_0")
            bonus_left["b"] -= _num(rnd, "virtual_1")
            frames.append(
                {
                    "round": len(frames) + 1,
                    "after_ticks": state.tick - contact,
                    "after_seconds": _seconds(state.tick - contact, rules.tick_hz),
                    "a": _side(state, 0),
                    "b": _side(state, 1),
                    "bonus_left": dict(bonus_left),
                }
            )
        ended = [e for e in events if e.kind == "fight_ended"]
    (end,) = ended
    attackers = [g for g in state.groups.values() if g.owner == 0]
    bounced = any(isinstance(g.location, OnEdge) and g.location.back for g in attackers)
    return {
        "vector": vec["id"],
        "terrain": vec["terrain"],
        "bonus_start": bonus_start,
        "start": start,
        "rounds": frames,
        "end": {
            "after_ticks": state.tick - contact,
            "a": _side(state, 0),
            "b": _side(state, 1),
            "node_taken": state.nodes[1].owner == 0,
            "attack_bounces": bounced,
            "losses": {"a": _num(end, "losses_0"), "b": _num(end, "losses_1")},
        },
    }


def _seconds(ticks: int, tick_hz: int) -> int:
    assert ticks % tick_hz == 0, (ticks, tick_hz)
    return ticks // tick_hz


def _cp(hundredths: int) -> int:
    assert hundredths % 100 == 0, hundredths
    return hundredths // 100


def build() -> dict[str, Any]:
    rules = load_ruleset(RULESET_PATH)
    vectors = {v["id"]: v for v in json.loads(VECTORS_PATH.read_text(encoding="utf-8"))["vectors"]}
    hz = rules.tick_hz
    stance = rules.economy.stance_to_charges_pct
    return {
        "generated_by": "scripts/export_howto.py (mise run regen:howto), do not edit",
        "ruleset": RULESET_PATH.stem,
        "ruleset_hash": ruleset_hash(rules),
        "sim_version": SIM_VERSION,
        "rules": {
            "round_seconds": _seconds(rules.combat.round_ticks, hz),
            "planned_delay_seconds": _seconds(rules.orders.planned_delay_ticks, hz),
            "planned_bonus_per_road": rules.orders.planned_bonus_per_edge,
            "defense_seconds_per_bonus": _seconds(rules.orders.defense_ticks_per_bonus, hz),
            "cost_move_cp": _cp(rules.orders.cost.move),
            "cost_planned_cp": _cp(rules.orders.cost.planned_move),
            "cost_defense_cp": _cp(rules.orders.cost.defense),
            "stance_charges_pct": {
                "economy": stance.economy,
                "balance": stance.balance,
                "war": stance.war,
            },
            "vp_period_seconds": _seconds(rules.victory.vp_period_ticks, hz),
            "capital_multiplier": rules.victory.capital_multiplier,
            "match_minutes": _seconds(rules.match_ticks, hz) // 60,
        },
        "examples": [{"id": name, **_play(vectors[row], rules)} for name, row in EXAMPLES],
    }


def render() -> str:
    return json.dumps(build(), indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(render(), encoding="utf-8")
    print(f"wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
