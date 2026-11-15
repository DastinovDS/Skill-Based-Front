"""Every tutorial chapter played on the real runner by its scripted opponent and a scripted
student (#806, ``docs/design/tutorial.md``, section 4).

The expected ticks are the "Verified" lines of section 4 (AGENTS.md, 0.4), with the corrections
the implementation recorded there (V: the fort a tick earlier, A3.2 at 30) and the waits of review
4 (#1047: a beat ``after`` its trigger, the focus phases) and of review 5 (#1054: chapter III's new
order, chapter IV's head-on attack first and its clock, the stance open after chapter III) and of
review 6 (#1059: no focus phase after chapter II, the fights' rules before the first fight, the
two-step builds, any stance at III.8). The runner is stepped
by hand (``MatchRunner.step``, no loop): the student acts between two steps, as a client between
two ticks, and a pause stops the stepping (the loop itself: ``test_tutorial.py``).

At every beat the student first sends every command it can think of that the beat of the
document does not allow: each must be refused at once with ``INVALID_ARGUMENT``, leave the state
as it was and never reach the simulation. Then it gives the commands the beat asks for.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

import pytest

from gow_protocol import commands as wire
from gow_protocol.convert import opaque_to_wire
from gow_protocol.messages import AckMsg, EndReason, EventMsg, MatchEndMsg, TutorialMsg
from gow_protocol.tutorial import chapter_paths, load_chapter
from gow_server.clock import ManualClock
from gow_server.matches import BOT_ACCOUNT, MatchRunner
from gow_server.tutorial import TutorialDirector, chapter_rules
from gow_server.tutorialmatch import opponent_seat
from gow_sim.maps import load_map
from gow_sim.ruleset import Stance, load_ruleset
from gow_sim.state import AtNode, Detail
from gow_sim.view import GroupView, PlayerView

ROOT: Final = Path(__file__).parents[3]
RULES: Final = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
CHAPTERS: Final = {c.id: c for c in map(load_chapter, chapter_paths(ROOT / "tutorial/chapters"))}

type Label = tuple[object, ...]
"""A command as the document's tables name it: ``("move", from, to, planned)``,
``("cancel_order", from)``, ``("build_factory", node)``, ``("recruit", node)``,
``("set_stance", stance)``, ``("fortify_road", node, toward)``,
``("group_move", frozenset(froms), to, planned)``, ``("set_rally_point", node, to)``."""

type Allowed = Callable[[Label], bool]


def none(label: Label) -> bool:
    del label
    return False


def only(*labels: Label) -> Allowed:
    return lambda label: label in labels


def stance(label: Label) -> bool:
    """The stance, open at every beat after chapter III (review 5, P10)."""
    return label[0] == "set_stance"


@dataclass
class Play:
    """One chapter on a hand-stepped runner, and what its player received."""

    chapter_id: str
    allowed: dict[str, Allowed]
    """The document's ``allow`` of each beat (section 4), for the probes."""
    free: Allowed = none
    """What the chapter allows at every beat besides (the stance after chapter III)."""
    runner: MatchRunner = field(init=False)
    beats: list[tuple[int, str | None]] = field(default_factory=list[tuple[int, str | None]])
    """``(tick, beat)`` of every beat change the player was told about."""
    acks: dict[int, list[AckMsg]] = field(default_factory=dict[int, list[AckMsg]])
    events: list[EventMsg] = field(default_factory=list[EventMsg])
    end: MatchEndMsg | None = None
    refused: set[int] = field(default_factory=set[int])
    probed: set[str | None] = field(default_factory=set[str | None])
    seq: int = 0
    notes: dict[str, int] = field(default_factory=dict[str, int])

    def __post_init__(self) -> None:
        chapter = CHAPTERS[self.chapter_id]
        mapdef = load_map(ROOT / "maps" / "tutorial" / f"{chapter.map}.json")
        self.mapdef = mapdef
        self.ids = {node.name: node.id for node in mapdef.nodes}
        self.names = {node.id: node.name for node in mapdef.nodes}
        self.director = TutorialDirector(chapter, mapdef)
        self.runner = MatchRunner(
            "t",
            chapter.map,
            mapdef,
            chapter_rules(RULES, chapter),
            (7, BOT_ACCOUNT),
            ManualClock(),
            bot=opponent_seat(chapter, mapdef),
            tutorial=self.director,
        )
        self.box = self.runner.attach(0)
        tutorial = self.runner.tutorial_msg(0)
        assert tutorial is not None
        self.box.put(tutorial)
        self._drain()

    # What the player sees ----------------------------------------------------------------

    @property
    def tick(self) -> int:
        return self.runner.match.tick

    @property
    def beat(self) -> str | None:
        return self.beats[-1][1] if self.beats else None

    def view(self) -> PlayerView:
        return self.runner.match.view(0)

    def groups(self, node: str | None = None) -> list[GroupView]:
        out = list(self.view().groups)
        if node is None:
            return out
        return [
            g for g in out if isinstance(g.location, AtNode) and g.location.node == self.ids[node]
        ]

    def size(self, node: str) -> tuple[int, int]:
        (group,) = self.groups(node)
        return group.units, group.charged

    def gid(self, node: str) -> str:
        (group,) = self.groups(node)
        return opaque_to_wire(group.id)

    def seen(self, what: str, tick: int | None = None, **data: object) -> list[EventMsg]:
        return [
            e
            for e in self.events
            if e.kind == what
            and (tick is None or e.tick == tick)
            and all(e.data.get(k) == v for k, v in data.items())
        ]

    # Acting ------------------------------------------------------------------------------

    def send(self, cmd: wire.Command) -> AckMsg | None:
        """Submit ``cmd``; the immediate ``ack`` of a refused one, else ``None``."""
        self.seq += 1
        assert self.runner.submit(0, self.seq, cmd)
        self._drain()
        got = self.acks.get(self.seq, [])
        return got[0] if got else None

    def order(self, cmd: wire.Command) -> None:
        """A command the beat allows: admitted, so no immediate answer."""
        refused = self.send(cmd)
        assert refused is None, (self.tick, self.beat, cmd, refused)

    def deny(self, cmd: wire.Command) -> None:
        before = self.runner.match.state_hash()
        ack = self.send(cmd)
        assert ack is not None, (self.tick, self.beat, cmd)
        assert ack.reject_code == "INVALID_ARGUMENT" and ack.applied_tick == self.tick + 1
        assert self.runner.match.state_hash() == before
        self.refused.add(self.seq)

    def resume(self) -> None:
        assert self.runner.request_resume(0), (self.tick, self.beat)
        self._drain()

    def move(self, origin: str, dest: str, *, bonus: int = 0) -> None:
        self.order(
            wire.MoveCmd(
                group=self.gid(origin), dest=self.ids[dest], planned=bonus > 0, bonus=bonus
            )
        )

    def _drain(self) -> None:
        while (msg := self.box.get_nowait()) is not None:
            match msg:
                case AckMsg():
                    self.acks.setdefault(msg.seq, []).append(msg)
                case TutorialMsg():
                    if not self.beats or self.beats[-1][1] != msg.beat:
                        self.beats.append((self.tick, msg.beat))
                        # the client shows the card once its map has drawn this tick (#1047)
                        assert msg.tick == self.tick, (msg, self.tick)
                case EventMsg():
                    self.events.append(msg)
                case MatchEndMsg():
                    self.end = msg
                case _:
                    pass

    # Probes ------------------------------------------------------------------------------

    def label(self, cmd: wire.Command) -> Label | None:
        view = self.view()
        where = {
            opaque_to_wire(g.id): (
                self.names[g.location.node] if isinstance(g.location, AtNode) else None
            )
            for g in view.groups
        }
        names = self.names
        match cmd:
            case wire.MoveCmd(group=g, dest=d, planned=p):
                return ("move", where.get(g), names[d], p)
            case wire.CancelOrderCmd(group=g):
                return ("cancel_order", where.get(g))
            case (
                wire.BuildFactoryCmd(node=n)
                | wire.BuildBarracksCmd(node=n)
                | wire.RecruitCmd(node=n)
            ):
                return (cmd.type, names[n])
            case wire.SetStanceCmd(stance=s):
                return ("set_stance", s)
            case wire.FortifyRoadCmd(node=n, edge=e):
                return ("fortify_road", names[n], names[self.mapdef.edges[e].other(n)])
            case wire.GroupMoveCmd(groups=gs, dest=d, planned=p):
                return ("group_move", frozenset(where.get(g) for g in gs), names[d], p)
            case wire.SetRallyPointCmd(node=n, target=t):
                return ("set_rally_point", names[n], None if t is None else names[t])
            case _:
                return None

    def probes(self) -> list[wire.Command]:
        view = self.view()
        own = [n.id for n in view.nodes if n.owner == 0]
        groups = [opaque_to_wire(g.id) for g in view.groups]
        nodes = [n.id for n in self.mapdef.nodes]
        out: list[wire.Command] = []
        for g in groups:
            for d in nodes:
                out.append(wire.MoveCmd(group=g, dest=d, planned=False))
                out.append(wire.MoveCmd(group=g, dest=d, planned=True, bonus=1))
            out += [
                wire.CancelOrderCmd(group=g),
                wire.SplitCmd(group=g, n=1),
                wire.ReleasePlanCmd(group=g),
            ]
        for n in own:
            out += [
                wire.BuildFactoryCmd(node=n),
                wire.BuildBarracksCmd(node=n),
                wire.RecruitCmd(node=n),
                wire.CancelRecruitCmd(node=n),
            ]
            out += [wire.FortifyRoadCmd(node=n, edge=e) for e in self.mapdef.incident[n]]
            out += [wire.SetRallyPointCmd(node=n, target=t) for t in own if t != n]
        out += [wire.SetStanceCmd(stance=s) for s in Stance]
        out.append(wire.SetLeafShiftCmd(shift=1))
        if len(groups) >= 2:
            out += [
                wire.GroupMoveCmd(groups=tuple(groups[:2]), dest=d, planned=False) for d in nodes
            ]
            out.append(wire.MergeCmd(groups=tuple(groups[:2])))
        return out

    def probe(self) -> None:
        """Every command the current beat of the document does not allow is refused."""
        allowed = self.allowed.get(self.beat or "", none)
        for cmd in self.probes():
            label = self.label(cmd)
            if label is not None and (allowed(label) or self.free(label)):
                continue
            self.deny(cmd)

    # Playing -----------------------------------------------------------------------------

    def play(self, student: Callable[["Play"], None], limit: int = 1500) -> None:
        """Step until the match ends. Between two steps: the probes of a new beat, then the
        student, again while it moves the chapter on without a tick (a Continue that begins
        the next card)."""
        while self.end is None:
            while True:
                if self.beat not in self.probed:
                    self.probed.add(self.beat)
                    self.probe()
                before = (self.beat, self.runner.paused)
                student(self)
                if not self.runner.paused or (self.beat, self.runner.paused) == before:
                    break
            assert not self.runner.paused, f"stuck at beat {self.beat}, tick {self.tick}"
            assert self.tick < limit, "no end"
            self.runner.step()
            self._drain()
        for seq in self.refused:  # a refused command never reached the simulation
            assert len(self.acks[seq]) == 1

    def once(self, key: str) -> bool:
        """``True`` the first time ``key`` is asked for."""
        if key in self.notes:
            return False
        self.notes[key] = self.tick
        return True


def continues(p: Play, *beats: str) -> None:
    """Continue every ``continue`` card of ``beats`` at once."""
    if p.runner.paused and p.beat in beats:
        p.resume()


# I. Units and movement ---------------------------------------------------------------------

UNITS_ALLOWED: Final[dict[str, Allowed]] = {
    "1": only(("move", "Highhold", "Ashford", False)),
    "5": lambda lb: lb == ("move", "Ashford", "Elmstead", False) or lb[0] == "cancel_order",
    "7": only(("move", "Elmstead", "Fordham", False)),
}


def test_units_plays_at_the_documented_ticks() -> None:
    def student(p: Play) -> None:
        continues(p, "3", "4", "6")
        view = p.view()
        assert not view.packets  # the capital's first charge stays home (tick 400)
        if p.beat == "1" and p.runner.paused:
            assert view.me.cp == RULES.cp.cap  # cp_start = cap
            p.move("Highhold", "Ashford")
        elif p.beat == "5" and p.runner.paused:
            assert p.size("Ashford") == (3, 2)
            p.move("Ashford", "Elmstead")
        elif p.beat == "7" and p.runner.paused:
            assert p.size("Elmstead") == (3, 1)
            nodes = view.nodes
            assert nodes[p.ids["Kestrel"]].detail is Detail.RANGE
            assert nodes[p.ids["Brackenfold"]].detail is Detail.PRESENCE
            p.move("Elmstead", "Fordham")
        cps[p.tick] = view.me.cp

    cps: dict[int, int] = {}
    p = Play("units", UNITS_ALLOWED)
    p.play(student)
    assert p.beats == [(0, "1"), (1, "3"), (77, "4"), (77, "5"), (143, "6"), (143, "7")]
    assert [a[0].applied_tick for s, a in sorted(p.acks.items()) if s not in p.refused] == [
        1,
        78,
        144,
    ]
    assert [e.tick for e in p.seen("node_captured", player=0)] == [65, 131, 253]
    # CP: 5, 4 (tick 1), 3 (78), 3.5 (the income at 100), 2.5 (144), 3 (200)
    assert [cps[t] for t in (1, 78, 100, 144, 200)] == [400, 300, 350, 250, 300]
    assert p.director.done
    assert p.end is not None and p.end.tick == 254
    assert (p.end.reason, p.end.winner) == (EndReason.FORFEIT, 0)
    view = p.view()
    assert p.size("Fordham") == (3, 0)
    assert view.nodes[p.ids["Kestrel"]].detail is Detail.EXACT


def test_units_with_the_offered_cancel() -> None:
    cps: list[int] = []

    def student(p: Play) -> None:
        continues(p, "3", "4", "6")
        cps.append(p.view().me.cp)
        if p.beat == "1" and p.runner.paused:
            p.move("Highhold", "Ashford")
        elif p.beat == "5" and p.runner.paused:
            p.move("Ashford", "Elmstead")
        elif p.beat == "5" and p.tick == 98:  # X at 99: the group a third of the way
            group = opaque_to_wire(p.groups()[0].id)
            p.order(wire.CancelOrderCmd(group=group))
            p.deny(wire.CancelOrderCmd(group=group))  # max 1
        elif p.beat == "5" and p.groups("Ashford") and p.once("again"):
            assert p.tick == 119
            assert p.seen("group_arrived", 119, back=True)
            p.move("Ashford", "Elmstead")
        elif p.beat == "7" and p.runner.paused:
            p.move("Elmstead", "Fordham")

    p = Play("units", UNITS_ALLOWED)
    p.play(student)
    assert p.beats == [(0, "1"), (1, "3"), (77, "4"), (77, "5"), (185, "6"), (185, "7")]
    assert [e.tick for e in p.seen("node_captured", player=0)] == [65, 173, 295]
    assert p.end is not None and p.end.tick == 296
    assert min(cps) == 150  # 1.5 CP: never short of an order (the document said 2, corrected)


# II. Map and economy -----------------------------------------------------------------------

ECONOMY_ALLOWED: Final[dict[str, Allowed]] = {"5": only(("move", "Millbrook", "Coldwell", False))}


def test_economy_plays_at_the_documented_ticks() -> None:
    def student(p: Play) -> None:
        continues(p, "1", "2", "3")
        view = p.view()
        westmarch = view.nodes[p.ids["Westmarch"]]
        if p.tick == 0:
            assert p.runner.match.state.players[0].cp_ticks == 70  # cp_ticks_start
        if p.tick == 30:
            assert view.packets  # the first charges on the roads (shown from beat II.2)
        if p.tick in (29, 30):
            assert view.me.cp == {29: 300, 30: 350}[p.tick]  # II.1W sees the first income
        if p.tick == 124:
            assert p.size("Westmarch") == (3, 1)
        if p.tick == 244:
            assert p.size("Westmarch") == (3, 3)
        if p.tick == 266:
            assert westmarch.starve_in is None
        if p.tick == 267:
            assert westmarch.flow_pocket and westmarch.starve_in == 100
        if p.beat == "5" and p.runner.paused:
            assert p.tick == 279
            p.move("Millbrook", "Coldwell")

    p = Play("economy", ECONOMY_ALLOWED)
    p.play(student)
    assert p.beats == [
        (0, "1"),
        (0, "1W"),
        (35, "2"),
        (35, "2W"),
        (124, "3"),
        (124, "3W"),
        (204, "4"),  # the raid set off at 200, seen during II.3W
        (279, "5"),
    ]
    assert min(e.tick for e in p.seen("packet_sent", player=0)) == 10
    westmarch = p.ids["Westmarch"]
    assert min(e.tick for e in p.seen("packet_delivered", player=0, node=westmarch)) == 124
    assert p.seen("node_captured", 267, player=1, node=p.ids["Coldwell"])
    assert p.seen("node_captured", 340, player=0, node=p.ids["Coldwell"])
    assert not p.seen("starvation")  # the first would come at 367
    assert p.end is not None and p.end.tick == 341 and p.end.winner == 0


def test_economy_raiders_leave_at_once() -> None:
    p = Play("economy", ECONOMY_ALLOWED)
    raiders: list[int] = []

    def student(p: Play) -> None:
        continues(p, "1", "2", "3")
        state = p.runner.match.state
        for g in state.groups.values():
            if g.owner == 1 and g.order is not None and 200 <= p.tick <= 270:
                raiders.append(p.tick)
        if p.beat == "5" and p.runner.paused:
            p.move("Millbrook", "Coldwell")

    p.play(student)
    # the raid departs at 200 (its order is on the group after the step of 200) and the
    # raiders leave the taken Coldwell at 268
    assert raiders[0] == 200 and 268 in raiders and 267 not in raiders


# III. Building ------------------------------------------------------------------------------


@pytest.mark.parametrize("pick", [Stance.ECONOMY, Stance.WAR])
def test_building_plays_at_the_documented_ticks(pick: Stance) -> None:
    """III.8 takes any stance (review 6): the card suggests Economy, War is not locked."""

    def student(p: Play) -> None:
        continues(p, "3", "7")
        if not p.runner.paused:
            if p.tick == 21:
                assert p.size("Fernhill") == (3, 0)  # the units paid the barracks
            return
        if p.beat == "1":
            p.order(wire.BuildBarracksCmd(node=p.ids["Fernhill"]))
        elif p.beat == "4":
            p.order(wire.RecruitCmd(node=p.ids["Fernhill"]))
            p.deny(wire.RecruitCmd(node=p.ids["Fernhill"]))  # once
        elif p.beat == "5":
            p.order(wire.BuildFactoryCmd(node=p.ids["Millbrook"]))
            p.deny(wire.BuildFactoryCmd(node=p.ids["Millbrook"]))  # once
        elif p.beat == "8":
            p.order(wire.SetStanceCmd(stance=pick))

    allowed = {
        "1": only(("build_barracks", "Fernhill")),
        "4": only(("recruit", "Fernhill")),
        "5": only(("build_factory", "Millbrook")),
        "8": stance,  # every stance (review 6: War is not locked)
    }
    p = Play("building", allowed)
    p.play(student)
    assert p.beats == [
        (0, "1"),
        (21, "3"),  # 20 ticks after the payment, so the empty helmet is seen
        (101, "4"),  # no focus phase from chapter III on (review 6)
        (131, "5"),
        (232, "7"),  # the factory's menu beat (6) is the client's
        (232, "8"),
    ]
    paid = [(e.tick, e.data["kind"], e.data["units"], e.data["owed"]) for e in p.seen("build_paid")]
    assert paid == [(1, "barracks", 3, 0), (132, "factory", 2, 0)]
    assert [e.tick for e in p.seen("barracks_built")] == [101]
    assert [e.tick for e in p.seen("recruited", player=0)] == [131]
    assert [e.tick for e in p.seen("factory_built")] == [232]
    assert [e.tick for e in p.seen("stance_changed", player=0)] == [233]
    assert p.end is not None and p.end.tick == 234 and p.end.winner == 0


# IV. Attack and fight -----------------------------------------------------------------------

ATTACK_ALLOWED: Final[dict[str, Allowed]] = {
    "4": only(("move", "Fernhold", "Ashwood", False)),
    "7": only(("move", "Fernhold", "Ashwood", True)),
    "13": lambda lb: lb[:3] == ("move", "Ashwood", "Stormcrown"),
}


def attack_student(stormcrown_bonus: int) -> Callable[[Play], None]:
    def student(p: Play) -> None:
        continues(p, "1", "2", "3", "5", "10", "11")
        if p.beat == "4" and p.runner.paused:
            p.move("Fernhold", "Ashwood")  # head-on: it bounces, the lesson of the plan
        elif p.beat == "7" and p.runner.paused:
            assert p.size("Fernhold") == (3, 3)
            p.move("Fernhold", "Ashwood", bonus=3)
        elif p.beat == "13" and p.runner.paused:
            assert p.size("Ashwood") == (3, 3)
            p.move("Ashwood", "Stormcrown", bonus=stormcrown_bonus)
        if p.tick == 444:
            assert p.size("Ashwood") == (3, 2)

    return student


def test_attack_plays_at_the_documented_ticks() -> None:
    p = Play("attack", ATTACK_ALLOWED, free=stance)
    p.play(attack_student(0))
    assert p.beats == [
        (0, "1"),
        (0, "2"),  # rounds and no leaving a fight, before the first one (review 6)
        (0, "3"),
        (0, "4"),
        (148, "5"),
        (148, "6"),  # wait for the refill: a card, no focus (review 6)
        (218, "7"),
        (219, "9"),
        (230, "10"),
        (469, "11"),
        (469, "12"),
        (502, "13"),
    ]
    ashwood, stormcrown = p.ids["Ashwood"], p.ids["Stormcrown"]
    rounds = [e.tick for e in p.seen("fight_round", node=ashwood)]
    assert rounds == [98, 118, 138, 424, 444]
    (lost, won) = p.seen("fight_ended", node=ashwood)
    assert (lost.tick, lost.data["winner"], lost.data["captured"]) == (138, 1, False)
    assert (won.tick, won.data["winner"]) == (444, 0)
    assert [e.tick for e in p.seen("plan_charged", player=0)] == [266, 296, 326]
    assert p.seen("node_captured", 333, player=1, node=p.ids["Old Mill"])  # the enemy plan
    assert p.seen("node_captured", 444, player=0, node=ashwood)
    assert [e.tick for e in p.seen("fight_round", node=stormcrown)] == [621, 641]
    assert p.director.message().clock_end == 1069  # IV.11 at 469, a minute
    assert p.end is not None and p.end.tick == 641
    assert (p.end.reason, p.end.winner) == (EndReason.CAPITAL_CAPTURED, 0)
    assert not p.director.by_clock


def test_attack_plan_on_the_capital_ends_by_the_clock() -> None:
    """A planned order on Stormcrown is allowed (review 5): Ashwood's warehouse is empty, so the
    plan gathers nothing before the clock runs out, and the chapter ends as won by VP."""
    p = Play("attack", ATTACK_ALLOWED, free=stance)
    p.play(attack_student(3))
    assert p.director.done and p.director.by_clock
    assert not p.seen("node_captured", player=0, node=p.ids["Stormcrown"])
    assert p.end is not None and p.end.tick == 1070  # the Forfeit of the tick after 1069
    assert (p.end.reason, p.end.winner) == (EndReason.FORFEIT, 0)
    assert p.end.vp[0] > p.end.vp[1]  # the player leads on VP: the Seal says so truly


def test_attack_stance_is_open_and_ends_no_pause() -> None:
    def student(p: Play) -> None:
        if p.beat == "1" and p.runner.paused and p.once("stance"):
            p.order(wire.SetStanceCmd(stance=Stance.ECONOMY))
            assert p.runner.paused  # no answer to the card: it still waits
            p.resume()
        elif p.beat in ("2", "3"):
            continues(p, "2", "3")
        elif p.beat == "4" and p.runner.paused:
            p.move("Fernhold", "Ashwood")
        elif p.beat == "5":
            p.order(wire.ForfeitCmd())

    p = Play("attack", ATTACK_ALLOWED, free=stance)
    p.play(student)
    assert [e.tick for e in p.seen("stance_changed", player=0)] == [1]
    assert p.runner.match.state.players[0].stance is Stance.ECONOMY


# V. Defence ---------------------------------------------------------------------------------


def test_defence_plays_at_the_documented_ticks() -> None:
    def student(p: Play) -> None:
        continues(p, "1", "2")
        if p.beat == "1":
            nodes = p.view().nodes
            assert nodes[p.ids["Highcrag"]].terrain_mark == 1  # the chevrons the card names
            assert nodes[p.ids["Flatford"]].terrain_mark == -1
        if p.beat == "4" and p.runner.paused:
            road = next(
                e
                for e in p.mapdef.incident[p.ids["Flatford"]]
                if p.mapdef.edges[e].other(p.ids["Flatford"]) == p.ids["Eastfield"]
            )
            p.order(wire.FortifyRoadCmd(node=p.ids["Flatford"], edge=road))
        elif p.beat == "6" and p.runner.paused:
            p.move("Millbrook", "Flatford")
        if p.tick == 267:
            assert p.size("Flatford") == (4, 4)

    allowed = {
        "4": only(("fortify_road", "Flatford", "Eastfield")),
        "6": only(("move", "Millbrook", "Flatford", False)),
    }
    p = Play("defence", allowed, free=stance)
    p.play(student)
    # the chevrons first, then the march on Highcrag
    # the menu beat of the fort (5) is the client's
    assert p.beats == [(0, "1"), (10, "2"), (169, "3"), (200, "4"), (201, "6"), (384, "7")]
    highcrag, flatford = p.ids["Highcrag"], p.ids["Flatford"]
    rounds = p.seen("fight_round", node=highcrag)
    assert [e.tick for e in rounds] == [119, 139, 159] and rounds[0].data["virtual_0"] == 1
    (held,) = p.seen("fight_ended", node=highcrag)
    assert held.tick == 159 and held.data["captured"] is False
    assert (held.data["losses_0"], held.data["losses_1"]) == (0, 0)
    assert [e.tick for e in p.seen("road_fort_built", player=0)] == [301]
    (toll,) = p.seen("toll_taken", player=0)
    assert (toll.tick, toll.data["charges"]) == (384, 2)
    first = p.seen("fight_round", node=flatford)[0]
    assert first.tick == 435 and first.data["burned_0"] == 1
    (ended,) = p.seen("fight_ended", node=flatford)
    assert ended.tick == 475 and ended.data["winner"] == 0
    assert (ended.data["losses_0"], ended.data["losses_1"]) == (0, 0)
    assert p.end is not None and p.end.tick == 476 and p.end.winner == 0


# Advanced -----------------------------------------------------------------------------------


def test_group_orders_plays_at_the_documented_ticks() -> None:
    def student(p: Play) -> None:
        if p.beat == "1" and p.runner.paused:
            groups = (p.gid("Fernhold"), p.gid("Lowfield"))
            p.order(wire.GroupMoveCmd(groups=groups, dest=p.ids["Ashwood"], planned=False))

    allowed = {
        "1": only(("group_move", frozenset({"Fernhold", "Lowfield"}), "Ashwood", False)),
    }
    p = Play("group-orders", allowed, free=stance)
    p.play(student)
    assert p.beats == [(0, "1"), (1, "3"), (141, "4"), (246, "5")]  # A1.5 25 ticks after 221
    ashwood = p.ids["Ashwood"]
    assert sorted(e.tick for e in p.seen("group_arrived", node=ashwood)) == [141, 141]
    (fight,) = p.seen("fight_ended", node=ashwood)
    assert (fight.tick, fight.data["shots_0"], fight.data["shots_1"]) == (221, 4, 2)
    assert p.size("Ashwood") == (5, 0)
    assert p.end is not None and p.end.tick == 247 and p.end.winner == 0  # the goal waits for A1.5


def test_rally_points_plays_at_the_documented_ticks() -> None:
    def student(p: Play) -> None:
        cp = p.view().me.cp
        if p.beat == "1" and p.runner.paused:
            target = p.ids["Fernhold"]
            p.order(wire.SetRallyPointCmd(node=p.ids["Highhold"], target=target))
        elif p.beat == "2" and p.runner.paused:
            p.order(wire.RecruitCmd(node=p.ids["Highhold"]))
        elif p.beat == "2" and p.once("second"):
            p.order(wire.RecruitCmd(node=p.ids["Highhold"]))
            p.deny(wire.RecruitCmd(node=p.ids["Highhold"]))  # two at most
        if p.tick in (1, 2, 3, 32, 62):
            assert cp == {1: 300, 2: 200, 3: 100, 32: 50, 62: 0}[p.tick]

    allowed = {
        "1": only(("set_rally_point", "Highhold", "Fernhold")),
        "2": only(("recruit", "Highhold")),
        "3": only(("recruit", "Highhold")),
    }
    p = Play("rally-points", allowed, free=stance)
    p.play(student)
    assert p.beats == [(0, "1"), (1, "2"), (32, "3")]
    assert [e.tick for e in p.seen("recruited", player=0)] == [31, 61]
    assert [e.tick for e in p.seen("rally_walk_paid", player=0)] == [32, 62]
    fernhold = p.ids["Fernhold"]
    assert [e.tick for e in p.seen("groups_merged", node=fernhold)] == [191, 221]
    assert p.size("Fernhold") == (3, 3)
    assert p.end is not None and p.end.tick == 222 and p.end.winner == 0


def test_supply_distribution_plays_at_the_documented_ticks() -> None:
    def student(p: Play) -> None:
        continues(p, "1", "2", "3", "5")
        view = p.view()
        if p.tick == 30:
            assert len(view.packets) == 4
        if p.tick == 120:
            assert view.nodes[p.ids["Coldwell"]].front_dist == 0
        if p.beat == "4" and p.runner.paused:
            p.move("Fernhold", "Ashwood")
        if p.tick == 346:
            assert p.size("Ashwood") == (3, 1)

    p = Play(
        "supply-distribution", {"4": only(("move", "Fernhold", "Ashwood", False))}, free=stance
    )
    p.play(student)
    assert p.beats == [
        (0, "1"),
        (0, "1W"),
        (30, "2"),
        (30, "2W"),
        (95, "3"),
        (95, "3W"),
        (188, "4"),
        (300, "5"),
        (300, "5W"),
    ]
    names = p.names

    def sent(src: str, dst: str) -> list[int]:
        return [
            e.tick
            for e in p.seen("packet_sent", player=0)
            if names[int(str(e.data["from_node"]))] == src
            and names[int(str(e.data["to_node"]))] == dst
        ]

    assert sent("Highhold", "Millbrook")[:3] == [10, 20, 30]
    assert sent("Highhold", "Coldwell")[0] == 10
    assert sent("Coldwell", "Lowfield") == [70]
    assert [e.tick for e in p.seen("packet_lost", player=0)] == [83]
    assert sent("Millbrook", "Fernhold")[:4] == [70, 80, 140, 310]
    assert sent("Fernhold", "Ashwood")[:4] == [300, 310, 350, 360]
    ashwood = p.ids["Ashwood"]
    assert [e.tick for e in p.seen("fight_round", node=ashwood)] == [278, 298]
    assert p.seen("node_captured", 298, player=0, node=ashwood)
    assert p.end is not None and p.end.tick == 397 and p.end.winner == 0  # full at 396


@pytest.mark.parametrize("chapter_id", sorted(CHAPTERS))
def test_leaving_is_always_allowed(chapter_id: str) -> None:
    p = Play(chapter_id, {})
    p.order(wire.ForfeitCmd())
    assert not p.runner.paused  # leaving ends the pause of a card
    p.runner.step()
    p._drain()  # pyright: ignore[reportPrivateUsage]
    assert p.end is not None and p.end.reason is EndReason.FORFEIT and p.end.winner == 1
