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
    assert "clock" not in attack and {"planned", "vp"} <= set(attack)  # IV.9 hides the clock
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
    (lambda d: d["beats"][2]["on"].update(event="nothing"), "a trigger"),
    (lambda d: d["beats"][3]["on"].update(start=True), "exactly one of"),
    (lambda d: d["beats"][4]["on"].update(continued="9"), "continued names no beat"),
    (lambda d: d["beats"][0].update(extra=1), "extra"),
    (lambda d: d.update(cp_start="full"), "cp_start"),
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
    msg = TutorialMsg(chapter="attack", beat="F", paused=True, used=(0,), done=False)
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
            }
        )
    defs = protocol_json_schema()["$defs"]
    assert {"Chapter", "TutorialMsg", "Trigger", "Beat"} <= set(defs)
    # a field with a default may be left out of a file: not required in the TypeScript type
    assert "required" not in defs["Mark"] or "ring" not in defs["Mark"]["required"]
