"""QA-04 (#86): any schema-valid command from a client reaches the simulation without a crash.

The codec tests (``test_validation.py``) fuzz the frames; this one fuzzes what passes them. Every
field takes values from the whole wire range, not only from the map: own group ids, ids of enemy
groups (in both players' id spaces), random id strings, node and edge ids and unit counts up to
``MAX_INT``. A command goes the server's way (``encode`` -> ``decode_client`` ->
``command_from_wire`` -> ``Match.resolve`` -> ``Match.step``) on a running match with groups of
both players. A crash would end the match for both players: a way to dodge a lost rated match.
Every command gets an ``ack``, and an unknown or enemy id is ``NOT_FOUND_OR_HIDDEN``.
"""

import copy
from pathlib import Path
from typing import Final

from hypothesis import given, settings
from hypothesis import strategies as st

from gow_bots.bots import BOTS
from gow_protocol import commands as wire
from gow_protocol.base import MAX_INT
from gow_protocol.codec import decode_client, decode_server, encode
from gow_protocol.convert import ack_msg, command_from_wire
from gow_protocol.messages import CommandMsg
from gow_sim import commands as sim
from gow_sim.maps import PLAYERS, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Stance, load_ruleset
from gow_sim.state import Mode
from gow_sim.view import opaque_id

ROOT: Final = Path(__file__).resolve().parents[3]
KEY: Final = b"qa-04 fuzz match key, 32 bytes!!"
WARMUP_TICKS: Final = 600
NOT_FOUND: Final = sim.RejectCode.NOT_FOUND_OR_HIDDEN.value


def _warm_match() -> Match:
    """A match after ``WARMUP_TICKS`` of bot play: groups of both players, on nodes and edges."""
    mapdef = load_map(ROOT / "maps" / "arteriya.json")
    rules = load_ruleset(ROOT / "rulesets" / "mvp-0.toml")
    match = Match(mapdef, rules, KEY)
    bots = [BOTS["rusher"](mapdef, rules, seed=3, player=p) for p in PLAYERS]
    seq = dict.fromkeys(PLAYERS, 0)
    while match.tick < WARMUP_TICKS and not match.finished:
        batch: list[sim.PlayerCommand] = []
        if match.tick % 5 == 0:
            for p in PLAYERS:
                for cmd in bots[p].decide(match.view(p), match.tick):
                    seq[p] += 1
                    batch.append(sim.PlayerCommand(p, seq[p], match.resolve(p, cmd)))
        match.step(batch)
    assert not match.finished
    assert all(any(g.owner == p for g in match.state.groups.values()) for p in PLAYERS)
    return match


BASE: Final = _warm_match()
STATE: Final = BASE.state
OWN: Final = {
    p: [str(opaque_id(KEY, p, gid)) for gid, g in sorted(STATE.groups.items()) if g.owner == p]
    for p in PLAYERS
}
ENEMY: Final = {
    p: sorted(
        {
            str(opaque_id(KEY, viewer, gid))
            for gid, g in STATE.groups.items()
            if g.owner != p
            for viewer in PLAYERS
        }
    )
    for p in PLAYERS
}

_ints = st.one_of(st.integers(0, 64), st.integers(0, MAX_INT))
_random_ids = st.one_of(
    st.from_regex(r"[A-Za-z0-9_-]{1,32}", fullmatch=True),
    st.integers(0, 2**64).map(str),
    st.integers(0, 4096).map(str),  # small internal-looking ids
)


@st.composite
def _command(draw: st.DrawFn, player: int) -> wire.Command:
    ids = st.one_of(st.sampled_from(OWN[player]), st.sampled_from(ENEMY[player]), _random_ids)
    kinds = ("move", "split", "merge", "mode", "stance", "road", "recruit", "cancel")
    kind = draw(st.sampled_from(kinds))
    match kind:
        case "move":
            return wire.MoveCmd(group=draw(ids), dest=draw(_ints), planned=draw(st.booleans()))
        case "split":
            return wire.SplitCmd(group=draw(ids), n=draw(_ints.filter(bool)))
        case "merge":
            groups = draw(st.lists(ids, min_size=2, max_size=wire.MAX_MERGE_GROUPS, unique=True))
            return wire.MergeCmd(groups=tuple(groups))
        case "mode":
            return wire.SetModeCmd(group=draw(ids), mode=draw(st.sampled_from(list(Mode))))
        case "stance":
            return wire.SetStanceCmd(stance=draw(st.sampled_from(list(Stance))))
        case "road":
            return wire.UpgradeRoadCmd(node=draw(_ints), edge=draw(_ints))
        case "recruit":
            return wire.RecruitCmd(node=draw(_ints))
        case _:
            return wire.CancelOrderCmd(group=draw(ids))


@st.composite
def _batch(draw: st.DrawFn) -> list[tuple[int, wire.Command]]:
    size = draw(st.integers(1, 8))
    out: list[tuple[int, wire.Command]] = []
    for _ in range(size):
        player = draw(st.sampled_from(PLAYERS))
        out.append((player, draw(_command(player))))
    return out


def _ids_of(cmd: wire.Command) -> tuple[str, ...]:
    match cmd:
        case wire.MergeCmd(groups=groups):
            return groups
        case (
            wire.MoveCmd(group=g)
            | wire.SplitCmd(group=g)
            | wire.SetModeCmd(group=g)
            | wire.CancelOrderCmd(group=g)
        ):
            return (g,)
        case _:
            return ()


@settings(max_examples=300, deadline=None)
@given(_batch())
def test_any_valid_wire_command_is_acked_and_never_crashes(
    batch: list[tuple[int, wire.Command]],
) -> None:
    match = copy.deepcopy(BASE)
    pending: list[sim.PlayerCommand] = []
    for seq, (player, cmd) in enumerate(batch, start=1):
        msg = decode_client(encode(CommandMsg(seq=seq, cmd=cmd)))
        assert isinstance(msg, CommandMsg)
        resolved = match.resolve(player, command_from_wire(msg.cmd))
        pending.append(sim.PlayerCommand(player, seq, resolved))
    match.step(pending)
    assert sorted(r.seq for r in match.results) == list(range(1, len(batch) + 1))
    for result in match.results:
        ack = ack_msg(result)
        assert decode_server(encode(ack)) == ack
        player, cmd = batch[result.seq - 1]
        foreign = [i for i in _ids_of(cmd) if i not in OWN[player]]
        if foreign and not isinstance(cmd, wire.MergeCmd):
            assert ack.reject_code == NOT_FOUND  # unknown and enemy ids look the same
