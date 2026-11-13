"""The playtest override ``GOW_LEVEL_BOTS`` (#1037): parsing and the failure at start."""

import pytest
from pydantic import ValidationError

from gow_server.levelbots import LEVEL_BOTS, level_bots
from gow_server.settings import Settings


def test_empty_override_is_the_default_table() -> None:
    assert level_bots("") == LEVEL_BOTS
    assert level_bots(" , ") == LEVEL_BOTS


def test_pairs_replace_their_levels_only() -> None:
    result = level_bots("expert=owner_style, easy = smart_rusher@normal")
    assert result["expert"] == "owner_style"
    assert result["easy"] == "smart_rusher@normal"
    assert result["normal"] == LEVEL_BOTS["normal"] and result["hard"] == LEVEL_BOTS["hard"]


def test_the_default_table_is_not_changed() -> None:
    level_bots("expert=owner_style")
    assert LEVEL_BOTS["expert"] == "smart_expander@hard"


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("expert", "not level=bot"),
        ("expert=", "not level=bot"),
        ("godlike=owner_style", "unknown level"),
        ("expert=no_such_bot", "unknown bot"),
        ("expert=owner_style@easy", "bad level"),
    ],
)
def test_a_bad_pair_is_a_readable_error(text: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        level_bots(text)


def test_settings_read_the_variable_and_refuse_a_bad_one(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOW_LEVEL_BOTS", "expert=owner_style")
    assert Settings().level_bots == "expert=owner_style"
    monkeypatch.setenv("GOW_LEVEL_BOTS", "expert=nope")
    with pytest.raises(ValidationError, match="GOW_LEVEL_BOTS"):
        Settings()


def test_the_override_is_allowed_in_prod(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOW_ENV", "prod")
    monkeypatch.setenv("GOW_LEVEL_BOTS", "expert=owner_style")
    assert Settings().level_bots == "expert=owner_style"
