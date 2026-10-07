# ruff: noqa: RUF001  (look-alike letters are the subject of these tests)
"""MOD-01: nick format, skeleton (look-alike protection), reserved and forbidden nicks."""

import contextlib
import unicodedata
from pathlib import Path

import pytest

from gow_server.nicks import SKELETON_MAX, NickPolicy, load_blocklist, skeleton, validate_nick

LATIN_A = "A"
CYRILLIC_A = "А"
GREEK_OMICRON = "ο"


def test_mixed_script_nick_is_rejected() -> None:
    assert unicodedata.name(CYRILLIC_A) == "CYRILLIC CAPITAL LETTER A"
    for nick in (f"{CYRILLIC_A}dmin", f"Pl{GREEK_OMICRON}yer", "Иван_Ivan"):
        with pytest.raises(ValueError, match="one script"):
            validate_nick(nick)


@pytest.mark.parametrize("nick", ["Иван_2000", "Straße", "玩家一号", "ひらがな漢字", "Ωμεγα"])
def test_single_script_nicks_pass(nick: str) -> None:
    assert validate_nick(nick) == nick


@pytest.mark.parametrize("nick", ["Ｃａｐ", "ﬃx_ab", "___", "---"])
def test_compatibility_characters_and_no_alphanumerics_are_rejected(nick: str) -> None:
    with pytest.raises(ValueError):
        validate_nick(nick)


@pytest.mark.parametrize(
    ("first", "second"),
    [
        ("Cap", "Сар"),  # Latin Cap and Cyrillic Es-a-er
        ("Alice", "ALICE"),
        ("Alice", "Al_ice"),
        ("Alice", f"{CYRILLIC_A}lice"),
        ("Ilya", "llya"),  # capital i and lowercase L look the same
        ("Pro100", "Pr0lOO"),
        ("Renée", "Renee"),
        ("Straße", "STRASSE"),
    ],
)
def test_look_alikes_share_a_skeleton(first: str, second: str) -> None:
    assert skeleton(first) == skeleton(second)


@pytest.mark.parametrize(
    ("first", "second"), [("Alice", "Alina"), ("Иван", "Ivan"), ("a1b", "a2b")]
)
def test_different_nicks_have_different_skeletons(first: str, second: str) -> None:
    assert skeleton(first) != skeleton(second)


def test_skeleton_always_fits_the_column() -> None:
    worst = ["ﷺ"[:1] * 16, "ΐ" * 16, "ß" * 16, "ǆ" * 16, "한" * 16]
    for nick in worst:
        with contextlib.suppress(ValueError):  # refused instead of overflowing is fine too
            assert len(skeleton(nick)) <= SKELETON_MAX


@pytest.mark.parametrize(
    "nick",
    ["admin", "Admin", "ADMIN_01", "admin-", "\u0410dmin", "Moderator", "админ", "Админ99", "b0t"],
)
def test_reserved_nicks_are_refused(nick: str) -> None:
    assert not NickPolicy().is_allowed(nick)


@pytest.mark.parametrize("nick", ["adminton", "botanist", "Alice", "Иван", "admins_pal", "Moder8"])
def test_ordinary_nicks_are_allowed(nick: str) -> None:
    assert NickPolicy().is_allowed(nick)


@pytest.mark.parametrize(
    "nick",
    ["xFuckerx", "f_u_c_k", "sh1t", "Bitch99", "хуйня", "Пизда", "scheiße", "Arschloch1", "H1tler"],
)
def test_forbidden_words_are_refused(nick: str) -> None:
    assert not NickPolicy().is_allowed(nick)


def test_blocklist_file_extends_the_built_in_list(tmp_path: Path) -> None:
    path = tmp_path / "words.txt"
    path.write_text("# comment\n\nBadWord\n  spaced  \n", encoding="utf-8")
    words = load_blocklist(path)
    assert words == ["BadWord", "spaced"]
    policy = NickPolicy(words)
    assert not policy.is_allowed("xxbadwordxx")
    assert not policy.is_allowed("Spaced")
    assert NickPolicy().is_allowed("xxbadwordxx")
