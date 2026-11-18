"""The chapter files of the tutorial (#806, ``gow_protocol.tutorial``) and the ``tutorial``
message."""

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any, Final

import pytest
from pydantic import ValidationError

from gow_protocol.codec import decode_server, encode
from gow_protocol.messages import TutorialMsg
from gow_protocol.schema import protocol_json_schema
from gow_protocol.tutorial import (
    CHAPTER_IDS,
    Beat,
    Chapter,
    ChapterError,
    chapter_paths,
    check_chapter,
    check_chapters,
    dump_chapter,
    load_chapter,
)
from gow_sim.maps import load_map
from gow_sim.ruleset import load_ruleset

ROOT: Final = Path(__file__).resolve().parents[3]
CHAPTERS_DIR: Final = ROOT / "tutorial" / "chapters"
CAP: Final = load_ruleset(ROOT / "rulesets" / "mvp-7.toml").cp.cap


def chapters() -> list[Chapter]:
    return [load_chapter(path) for path in chapter_paths(CHAPTERS_DIR)]


def raw(chapter_id: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((CHAPTERS_DIR / f"{chapter_id}.json").read_text())
    return data


def test_every_chapter_file_fits_its_map_and_the_chapters_before_it() -> None:
    loaded = chapters()
    assert tuple(c.id for c in loaded) == CHAPTER_IDS
    assert sorted(p.name for p in CHAPTERS_DIR.glob("*.json")) == sorted(
        f"{i}.json" for i in CHAPTER_IDS
    )
    check_chapters(loaded)
    for chapter in loaded:
        check_chapter(chapter, load_map(ROOT / "maps" / "tutorial" / f"{chapter.map}.json"), CAP)


def test_the_hud_of_section_4_9() -> None:
    by_id = {c.id: c for c in chapters()}
    assert by_id["units"].ui == ()
    assert by_id["units"].ui_after() == ("terrainMode",)
    attack = by_id["attack"].ui_after()
    assert "clock" not in attack and {"planned", "vp"} <= set(attack)  # the clock is IV's own
    advanced = set(by_id["defence"].ui_after())
    assert {"terrainMarks", "alerts", "fort"} <= advanced
    for chapter_id in ("group-orders", "rally-points", "supply-distribution"):
        assert set(by_id[chapter_id].ui) == advanced


def test_a_file_round_trips() -> None:
    for chapter in chapters():
        assert Chapter.model_validate_json(dump_chapter(chapter)) == chapter


type Change = Callable[[dict[str, Any]], object]

BROKEN: Final[list[tuple[Change, str]]] = [
    (lambda d: d["beats"][1].update(pause="continue"), "a UI beat"),
    (lambda d: d["beats"][1].update(clock=600), "a UI beat"),
    (lambda d: d["beats"][1].update(on={"ui": "menu"}), "ui menu names the node"),
    (lambda d: d["beats"][1]["on"].update(ui="menu", node="Ashford"), "group goes with ui select"),
    (
        lambda d: d.update(always=[{"set_stance": {}, "max": 1}]),
        "always-allowed command has no max",
    ),
    (
        lambda d: [d["beats"][i].update(clock=100) for i in (2, 3)],
        "at most one beat starts the chapter's clock",
    ),
    (lambda d: d.update(cp_ticks_start=-1), "cp_ticks_start"),
    (lambda d: d["beats"][3]["on"].update(event="node_captured"), "a trigger"),
    (lambda d: d["beats"][3]["on"].update(start=True), "exactly one of"),
    (lambda d: d["beats"][3]["on"].update(continued="9"), "continued names no beat"),
    (lambda d: d["beats"][0].update(extra=1), "extra"),
    (lambda d: d.update(cp_start="full"), "cp_start"),
    (lambda d: d["beats"][0]["on"].update(after=5), "after goes with a trigger the server fires"),
    (lambda d: d["beats"][1]["on"].update(after=5), "after goes with a trigger the server fires"),
    (lambda d: d["goal"]["all"][0].update(after=5), "a goal condition has no after"),
    (lambda d: d["beats"][3].update(focus=30), "a focus beat is no card"),
    (
        lambda d: d["beats"].insert(0, {"id": "0W", "on": {"start": True}, "focus": 5}),
        "the first beat",
    ),
    (lambda d: d["beats"][0]["mark"].append({"capacity": "Ashford", "node": "Ashford"}), "a mark"),
    (
        lambda d: d["opponent"].append({"at": 3, "move": {"from": "a", "to": "b", "bonus": 1}}),
        "planned move",
    ),
]


@pytest.mark.parametrize(("change", "message"), BROKEN)
def test_a_broken_file_is_refused(change: Change, message: str) -> None:
    data = raw("units")
    change(data)
    with pytest.raises(ValidationError, match=message):
        Chapter.model_validate_json(json.dumps(data))


def test_names_and_roads_are_checked_against_the_map() -> None:
    mapdef = load_map(ROOT / "maps" / "tutorial" / "tut-move.json")
    data = raw("units")
    data["beats"][0]["mark"] = [{"node": "Atlantis"}]
    with pytest.raises(ChapterError, match="Atlantis"):
        check_chapter(Chapter.model_validate_json(json.dumps(data)), mapdef, CAP)
    data = raw("units")
    data["beats"][0]["mark"] = [{"road": ["Highhold", "Fordham"]}]
    with pytest.raises(ChapterError, match="no road"):
        check_chapter(Chapter.model_validate_json(json.dumps(data)), mapdef, CAP)
    data = raw("units")
    data["cp_start"] = CAP + 1
    with pytest.raises(ChapterError, match="over the cap"):
        check_chapter(Chapter.model_validate_json(json.dumps(data)), mapdef, CAP)


def test_a_chapter_must_start_with_the_hud_before_it() -> None:
    loaded = chapters()
    loaded[1] = loaded[1].model_copy(update={"ui": ()})
    with pytest.raises(ChapterError, match="economy: ui"):
        check_chapters(loaded)


def test_the_tutorial_message_and_the_schema() -> None:
    msg = TutorialMsg(
        chapter="attack",
        beat="10",
        paused=True,
        used=(),
        done=False,
        tick=469,
        clock_end=1069,
        by_clock=False,
    )
    assert decode_server(encode(msg)) == msg
    with pytest.raises(ValidationError):
        TutorialMsg.model_validate(
            {
                "type": "tutorial",
                "chapter": "nope",
                "beat": "1",
                "paused": False,
                "used": [],
                "done": False,
                "tick": 0,
                "clock_end": None,
                "by_clock": False,
            }
        )
    defs = protocol_json_schema()["$defs"]
    assert {"Chapter", "TutorialMsg", "Trigger", "Beat"} <= set(defs)
    # a field with a default may be left out of a file: not required in the TypeScript type
    assert "required" not in defs["Mark"] or "ring" not in defs["Mark"]["required"]


def test_the_waits_of_review_4() -> None:
    """#1047: a beat may begin ``after`` its trigger, a focus beat has no card, a card may ask
    for several orders, and a mark may name the element of a place."""
    by_id = {c.id: c for c in chapters()}
    units = by_id["units"]
    assert units.beats[2].on.after == 12 and units.beats[2].card
    economy = by_id["economy"]
    focus = [b for b in economy.beats if not b.card]
    assert [(b.id, b.focus) for b in focus] == [("1W", 35), ("2W", 60), ("3W", 80)]
    assert economy.beats[4].mark[0].warehouse == "Westmarch"
    assert by_id["rally-points"].beats[1].acts == 2
    assert by_id["units"].beats[4].mark[0].count == "Kestrel"


def test_the_content_of_review_5() -> None:
    """#1054: the CP progress at the start of II, the enemy mark, the menu beat of III, the clock
    of IV and the stance open after III."""
    by_id = {c.id: c for c in chapters()}
    economy = by_id["economy"]
    assert economy.cp_ticks_start == 70
    assert economy.beats[6].mark[0].enemy == "Coldwell"
    menu = by_id["building"].beats[1]
    assert (menu.on.ui, menu.on.node, menu.client_only) == ("menu", "Fernhill", True)
    clocks = [(b.id, b.clock) for b in by_id["attack"].beats if b.clock is not None]
    assert clocks == [("11", 600)]
    for chapter_id in ("units", "economy", "building"):
        assert by_id[chapter_id].always == ()
    for chapter_id in CHAPTER_IDS[3:]:
        (entry,) = by_id[chapter_id].always
        assert entry.set_stance is not None and entry.set_stance.stance is None


def test_the_content_of_review_6() -> None:
    """#1059: every build is two steps (a card that opens the menu, then a UI beat on the open
    menu), no focus phase from chapter III on (but Advanced 3, whose lesson is the supply flow),
    any stance at the end of III, and the rules of a fight told before the first one."""
    by_id = {c.id: c for c in chapters()}
    for chapter_id, node in (
        ("building", "Fernhill"),
        ("building", "Millbrook"),
        ("defence", "Flatford"),
    ):
        menus = [b for b in by_id[chapter_id].beats if b.on.ui == "menu" and b.on.node == node]
        assert len(menus) == 1, (chapter_id, node)
    for chapter_id in ("building", "attack", "defence", "group-orders", "rally-points"):
        assert all(b.focus is None for b in by_id[chapter_id].beats), chapter_id
    allow = by_id["building"].beats[-1].allow
    assert allow is not None and len(allow) == 1
    assert allow[0].set_stance is not None and allow[0].set_stance.stance is None
    attack = by_id["attack"].beats
    assert not any(b.on.event == "fight_started" for b in attack)


def test_the_cuts_of_the_attention_review() -> None:
    """#1075 (``docs/design/tutorial.md`` section 1, "Attention review"): I has no capacity card,
    IV tells the shot and the rounds in one card and no leaving a fight with the head-on attack,
    IV.10 and V.2 do not pause, V.3 does, and no card waits for a refill or comments on A1's
    fight. The beat ids of review 6 are kept, so the gaps are the cut beats."""
    by_id = {c.id: c for c in chapters()}

    def ids(chapter_id: str) -> list[str]:
        return [b.id for b in by_id[chapter_id].beats]

    def beat(chapter_id: str, beat_id: str) -> Beat:
        return next(b for b in by_id[chapter_id].beats if b.id == beat_id)

    assert ids("units") == ["1", "2", "4", "5", "6", "7"]
    assert ids("attack") == ["1", "4", "5", "6", "7", "8", "9", "10", "11", "13"]
    assert ids("group-orders") == ["1", "2", "3", "5"]
    head_on = beat("attack", "4")
    assert head_on.on.continued == "1" and head_on.pause == "action"
    assert beat("attack", "10").pause is None
    assert beat("attack", "13").on.view is not None  # the refill ends with the attack card
    assert beat("defence", "2").pause is None
    assert beat("defence", "3").pause == "continue"
    assert not any(b.on.event == "fight_started" for b in by_id["group-orders"].beats)
