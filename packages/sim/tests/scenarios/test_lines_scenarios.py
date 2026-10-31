"""Breaking supply lines: the owner's four situations of DEC-41, item 3 (mechanics.md, section 7,
block "Economy v2 (DEC-41, #642)"), played through the full ``Match.step`` on ``mvp-3``.

| # | Lines | Event | Result |
|---|---|---|---|
| 1 | A -> C along A-B-C; a path A-D-C exists | B captured | the line reroutes along A-D-C |
| 2 | A -> B; B -> D; B -> C; D and C connect only through B | B captured | all three lines cut |
| 3 | as 2 | C captured | only B -> C is cut; A -> B and B -> D stay |
| 4 | factory A with lines A -> B, A -> E | A captured | both lines cut |

Map ``dec41`` (see ``test_dec41.py``): player 0 owns K (capital), A, B, C, D, E, F, G with
the roads K-A, A-B, B-C, A-D, D-C, A-E, K-E, B-F, B-G. F and G hang off B only, so situations
2 and 3 use B -> F and B -> G for "B -> D, B -> C" of the table. A is a built factory. A
capture is the owner change of ``capacity.change_owner`` between two ticks, as combat and
movement make it.
"""

from pathlib import Path

from gow_sim.commands import DrawLine, Ok, PlayerCommand
from gow_sim.maps import load_map
from gow_sim.match import Match
from gow_sim.ruleset import load_ruleset
from gow_sim.state import Event, Line
from gow_sim.systems.capacity import change_owner

TESTS_DIR = Path(__file__).resolve().parents[1]
RULES = load_ruleset(TESTS_DIR.parents[2] / "rulesets" / "mvp-3.toml")
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
K, A, B, C, D, E, F, G = range(8)


def _match(*paths: tuple[int, ...]) -> Match:
    """A match at tick 1 with factory A and the lines ``paths`` of player 0, ids 0, 1, ..."""
    match = Match(MAP, RULES, bytes(range(32)))
    match.state.nodes[A].factory = 0
    commands = [PlayerCommand(0, i, DrawLine(p)) for i, p in enumerate(paths)]
    match.step(commands)
    assert all(isinstance(r.outcome, Ok) for r in match.results)
    return match


def _capture(match: Match, node: int) -> list[Event]:
    """Player 1 takes ``node``; the next tick settles the lines."""
    change_owner(match.state, node, 1)
    return match.step()


def _lines(match: Match) -> dict[int, tuple[int, ...]]:
    return {k: line.path for k, line in match.state.players[0].lines.items()}


def _kinds(events: list[Event], kind: str) -> list[int]:
    """The ids of the own lines in the ``kind`` events of player 0."""
    ids: list[int] = []
    for e in events:
        line = e.get("line") if e.kind == kind and e.get("player") == 0 else None
        if isinstance(line, int):
            ids.append(line)
    return ids


def test_situation_1_a_captured_intermediate_node_reroutes_the_line() -> None:
    match = _match((A, B, C))
    events = _capture(match, B)
    assert _lines(match) == {0: (A, D, C)}
    assert _kinds(events, "line_rerouted") == [0]
    assert _kinds(events, "line_cut") == []


def test_situation_1_without_a_way_round_the_line_is_cut() -> None:
    match = _match((A, B, C))
    change_owner(match.state, D, 1)
    events = _capture(match, B)
    assert _lines(match) == {}
    assert _kinds(events, "line_cut") == [0]


def test_the_drawn_path_is_kept_while_it_is_intact() -> None:
    """Item 6: A -> C drawn along the slower A-D-C (87 ticks against 60) stays as drawn, also
    after a capture elsewhere; only a break reroutes."""
    match = _match((A, D, C))
    for _ in range(50):
        match.step()
    events = _capture(match, F)
    assert _lines(match) == {0: (A, D, C)}
    assert not _kinds(events, "line_rerouted") and not _kinds(events, "line_cut")
    events = _capture(match, D)
    assert _lines(match) == {0: (A, B, C)}
    assert _kinds(events, "line_rerouted") == [0]


def test_situation_2_a_captured_relay_cuts_its_incoming_and_outgoing_lines() -> None:
    match = _match((A, B), (B, F), (B, G))
    events = _capture(match, B)
    assert _lines(match) == {}
    assert sorted(_kinds(events, "line_cut")) == [0, 1, 2]


def test_situation_3_a_captured_target_cuts_only_its_line() -> None:
    match = _match((A, B), (B, F), (B, G))
    events = _capture(match, G)
    assert _lines(match) == {0: (A, B), 1: (B, F)}
    assert _kinds(events, "line_cut") == [2]


def test_situation_4_a_captured_factory_cuts_all_its_lines() -> None:
    match = _match((A, B), (A, E))
    events = _capture(match, A)
    assert _lines(match) == {}
    assert sorted(_kinds(events, "line_cut")) == [0, 1]
    assert match.state.nodes[A].factory == 1  # passed: player 1 had only its capital


def test_a_packet_on_a_broken_line_is_lost() -> None:
    """Item 3, "packets in flight": a charge on the road A-B when B falls is lost (section 7),
    and the line itself reroutes along A-D-C."""
    match = _match((A, B, C))
    state = match.state
    state.nodes[A].warehouse = 1
    while not state.packets:
        match.step()
    (packet,) = state.packets.values()
    events = _capture(match, B)
    lost = [e for e in events if e.kind == "packet_lost"]
    assert [(e.get("packet"), e.get("charges")) for e in lost] == [(packet.id, 1)]
    assert _lines(match) == {0: (A, D, C)}


def test_line_ids_are_per_player() -> None:
    """Only the owner sees its lines (item 3, fog): the ids count per player, so a line of
    player 1 does not move the numbers of player 0."""
    match = Match(MAP, RULES, bytes(range(32)))
    draws = ((1, (16, 15)), (1, (16, 15, 14)), (0, (K, A)))  # 16, 15, 14: K, A, B of player 1
    match.step([PlayerCommand(player, i, DrawLine(path)) for i, (player, path) in enumerate(draws)])
    assert match.state.players[0].lines == {0: Line(0, (K, A))}
    assert sorted(match.state.players[1].lines) == [0, 1]
