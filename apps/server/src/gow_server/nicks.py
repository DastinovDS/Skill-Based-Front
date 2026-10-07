# ruff: noqa: RUF001, RUF002  (this module is about look-alike letters: they are meant to be here)
"""Nick rules (ID-01, MOD-01): format, spoofing protection, reserved and forbidden nicks.

Three layers, all deterministic and stdlib-only:

1. **Format** (``validate_nick``): NFC, 3..16 characters, letters of ONE script, digits, ``_``
   and ``-``; no compatibility characters (fullwidth letters, ligatures: ``NFKC(nick) == nick``).
   One script per nick is the "mixed script" rule of Unicode TR39: ``Аdmin`` (Cyrillic А, Latin
   dmin) is rejected outright.
2. **Skeleton** (``skeleton``): the key of uniqueness. A simplified take on the TR39 skeleton:
   case folding, accents removed, then look-alike letters folded onto one Latin letter. It stops
   whole-script spoofs too (``Сар`` in Cyrillic against ``Cap``). The table below is hand-made:
   the stdlib has no ``confusables.txt``. It covers the Cyrillic and Greek letters that look like
   Latin ones (the practical attack on a Latin-script game); it is NOT the full TR39 data, and
   look-alikes between other scripts (Armenian, Cherokee, ...) are not folded.
3. **Policy** (``NickPolicy``): reserved names (``admin``, ``moderator``, ...) and a small list of
   forbidden words, both compared on the skeleton, so ``@dm1n``-style tricks with look-alikes
   do not pass. Forbidden words match as substrings of the skeleton (``f_u_c_k`` too), which
   can catch an innocent nick (the Scunthorpe problem): the built-in list is kept short and the
   operator can extend it (``GOW_NICK_BLOCKLIST_FILE``), or rename a player with ``gow-admin``.
"""

import unicodedata
from collections.abc import Iterable
from pathlib import Path
from typing import Final

NICK_MIN: Final = 3
NICK_MAX: Final = 16
NICK_PUNCTUATION: Final = frozenset("_-")
# Hangul fillers are letters (category Lo) that render as blank space: invisible nicks.
NICK_INVISIBLE_LETTERS: Final = frozenset("ᅟᅠㅤﾠ")
SKELETON_MAX: Final = 64
"""Width of ``players.nick_key``. ``skeleton`` of a valid nick is far shorter (at most 3 characters
per source character); the check is a safety net."""

# Scripts that are written together in one language count as one script.
_SCRIPT_GROUPS: Final = {"HIRAGANA": "CJK", "KATAKANA": "CJK", "HANGUL": "HANGUL"}

# Letters (after casefold) that look like a Latin letter -> that letter.
_CONFUSABLE_LETTERS: Final = {
    # Cyrillic
    "а": "a", "в": "b", "г": "r", "е": "e", "к": "k", "м": "m", "н": "h", "о": "o",
    "п": "n", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x", "ѕ": "s", "і": "i",
    "ј": "j", "ԁ": "d", "ԛ": "q", "ԝ": "w", "һ": "h", "ѵ": "v", "ӏ": "l",
    # Greek
    "α": "a", "γ": "y", "ε": "e", "η": "n", "ι": "i", "κ": "k", "ν": "v", "ο": "o",
    "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "ω": "w",
    # Latin look-alikes of Latin letters
    "ı": "i",
}  # fmt: skip
# Second pass, on Latin: i, l and 1 (and uppercase I) are one glyph in many fonts; 0 is o.
_LATIN_FOLD: Final = str.maketrans({"i": "l", "1": "l", "0": "o"})
_CONFUSABLE_TABLE: Final = str.maketrans(_CONFUSABLE_LETTERS)
# Extra folding only for the forbidden-word check: leetspeak digits.
_LEET_FOLD: Final = str.maketrans({"3": "e", "4": "a", "5": "s", "7": "t", "8": "b"})

RESERVED_NICKS: Final = frozenset(
    {
        "admin", "administrator", "moderator", "mod", "gm", "support", "staff", "system",
        "server", "official", "operator", "owner", "root", "sysop", "bot", "ai", "null",
        "undefined", "anonymous", "skillbasedfront", "sbf", "gow",
        "администратор", "модератор", "админ", "модер", "поддержка", "система", "сервер",
        "бот",
    }
)  # fmt: skip
"""Compared on the skeleton with trailing digits cut: ``Admin``, ``admin_2``, ``Аdmin`` all hit."""

FORBIDDEN_WORDS: Final = (
    # English
    "fuck", "shit", "bitch", "cunt", "nigger", "nigga", "faggot", "whore", "hitler",
    # German
    "scheisse", "arschloch", "fotze", "wichser", "hurensohn",
    # Russian
    "хуй", "хуе", "хуя", "пизд", "бляд", "блят", "ебан", "ебат", "мудак", "пидор", "пидар",
    "залуп",
)  # fmt: skip


def validate_nick(raw: str) -> str:
    """Normalize a nick to NFC and check its format; raises ValueError with the reason."""
    nick = unicodedata.normalize("NFC", raw)
    if not NICK_MIN <= len(nick) <= NICK_MAX:
        raise ValueError(f"nick must be {NICK_MIN}..{NICK_MAX} characters long")
    scripts: set[str] = set()
    has_alnum = False
    for char in nick:
        category = unicodedata.category(char)
        letter = category.startswith("L") and char not in NICK_INVISIBLE_LETTERS
        if not (letter or category == "Nd" or char in NICK_PUNCTUATION):
            raise ValueError("nick may contain only letters, digits, '_' and '-'")
        if char not in NICK_PUNCTUATION:
            has_alnum = True
        if letter:
            scripts.add(_script(char))
    if unicodedata.normalize("NFKC", nick) != nick:
        raise ValueError("nick may not contain compatibility characters (fullwidth, ligatures)")
    if not has_alnum:
        raise ValueError("nick needs a letter or a digit")
    if len(scripts) > 1:
        raise ValueError("nick may use letters of one script only")
    return nick


def _script(char: str) -> str:
    """Script of a letter: the first word of its Unicode name (``LATIN``, ``CYRILLIC``, ...)."""
    first = unicodedata.name(char, "UNKNOWN").split(" ", 1)[0]
    return _SCRIPT_GROUPS.get(first, first)


def skeleton(nick: str) -> str:
    """The uniqueness key: two nicks that look alike have the same skeleton.

    Case-insensitive (``casefold``), accents dropped, Cyrillic and Greek look-alikes of Latin
    letters folded, ``i``/``l``/``1`` and ``0``/``o`` folded, ``_`` and ``-`` removed.
    ``Straße`` and ``STRASSE`` are the same, so are ``Cap`` and Cyrillic ``Сар``.
    """
    result = _skeleton_unchecked(nick)
    if not result or len(result) > SKELETON_MAX:
        raise ValueError("nick is not allowed")
    return result


def _skeleton_unchecked(word: str) -> str:
    folded = unicodedata.normalize("NFD", word.casefold())
    bare = "".join(c for c in folded if unicodedata.category(c) != "Mn")
    result = bare.translate(_CONFUSABLE_TABLE).translate(_LATIN_FOLD)
    return "".join(c for c in result if c not in NICK_PUNCTUATION)


def _blocklist_form(word: str) -> str:
    return _skeleton_unchecked(word).translate(_LEET_FOLD)


def _without_tail(nick: str) -> str:
    """The nick without trailing digits, ``_`` and ``-``: ``admin_2`` -> ``admin``."""
    end = len(nick)
    while end and (
        unicodedata.category(nick[end - 1]) == "Nd" or nick[end - 1] in NICK_PUNCTUATION
    ):
        end -= 1
    return nick[:end]


def load_blocklist(path: Path) -> list[str]:
    """Words of a blocklist file: one per line, blank lines and ``#`` comments ignored."""
    words: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        word = line.strip()
        if word and not word.startswith("#"):
            words.append(word)
    return words


class NickPolicy:
    """Reserved and forbidden nicks. ``extra_words`` extend the built-in forbidden list."""

    def __init__(self, extra_words: Iterable[str] = ()) -> None:
        self._reserved = frozenset(_skeleton_unchecked(word) for word in RESERVED_NICKS)
        self._forbidden = tuple(
            form
            for word in (*FORBIDDEN_WORDS, *extra_words)
            if (form := _blocklist_form(word))  # a word that folds to nothing would block everyone
        )

    def is_allowed(self, nick: str) -> bool:
        """``False`` for a reserved or forbidden nick (``nick`` is already format-checked)."""
        if _skeleton_unchecked(_without_tail(nick)) in self._reserved:
            return False
        leet = _blocklist_form(nick)
        return not any(word in leet for word in self._forbidden)
