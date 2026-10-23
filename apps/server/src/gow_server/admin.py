"""``gow-admin``: rename or block a player (MOD-01). Runs on the server host, no HTTP endpoint.

    gow-admin show <player>
    gow-admin rename <player> <new-nick>
    gow-admin block <player>
    gow-admin unblock <player>
    gow-admin reset-password <player>

``<player>`` is the numeric id or the nick (any spelling with the same skeleton). In the
production stack: ``docker compose exec app gow-admin block 42``. It works on the database in
``GOW_DATABASE_URL`` while the server runs (SQLite WAL). A blocked account is refused on every HTTP
request (403) and on the next match WebSocket connection; a match already running goes on until it
ends or the player disconnects. ``rename`` checks the nick format and uniqueness, but not the
reserved and forbidden lists: the operator decides. A rename does not change the token.
``reset-password`` asks for a new password twice on the terminal (never as an argument, never
printed: ``docker compose exec`` gives it a terminal) and logs the player out everywhere: they log
in with the nick and the new password the operator passed on (#374, players have no recovery).
"""

import argparse
import getpass
import secrets
import sys
from collections.abc import Callable, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from gow_server.db import create_db_engine, upgrade_to_head
from gow_server.models import Player, utcnow
from gow_server.nicks import skeleton, validate_nick
from gow_server.passwords import PasswordHasher, normalize
from gow_server.settings import Settings


class AdminError(Exception):
    """A reason the command cannot be done; printed without a traceback."""


def find_player(session: Session, ref: str) -> Player:
    """The player by id (digits) or by nick; ``AdminError`` if there is none."""
    player = session.get(Player, int(ref)) if ref.isdecimal() else None
    if player is None:
        try:
            key = skeleton(ref)
        except ValueError:
            key = None
        if key is not None:
            player = session.execute(
                select(Player).where(Player.nick_key == key)
            ).scalar_one_or_none()
    if player is None:
        raise AdminError(f"no such player: {ref}")
    return player


def describe(player: Player) -> str:
    state = (
        f"blocked since {player.blocked_at:%Y-%m-%d %H:%M} UTC" if player.blocked_at else "active"
    )
    return f"id={player.id} nick={player.nick} {state}"


def rename(session: Session, ref: str, new_nick: str) -> str:
    player = find_player(session, ref)
    try:
        nick = validate_nick(new_nick)
        key = skeleton(nick)
    except ValueError as exc:
        raise AdminError(str(exc)) from None
    taken = session.execute(
        select(Player.id).where(Player.nick_key == key, Player.id != player.id)
    ).first()
    if taken is not None:
        raise AdminError("nick is taken")
    player.nick = nick
    player.nick_key = key
    session.commit()
    return describe(player)


def set_blocked(session: Session, ref: str, *, blocked: bool) -> str:
    player = find_player(session, ref)
    if not blocked:
        player.blocked_at = None
    elif player.blocked_at is None:
        player.blocked_at = utcnow()
    session.commit()
    return describe(player)


def reset_password(
    session: Session, ref: str, passwords: PasswordHasher, read_password: Callable[[str], str]
) -> str:
    player = find_player(session, ref)
    first = read_password("New password: ")
    if read_password("Repeat the password: ") != first:
        raise AdminError("passwords do not match")
    try:
        password = normalize(first)
    except ValueError as exc:
        raise AdminError(str(exc)) from None
    player.password_hash = passwords.hash(password)
    # A token nobody has: every device is logged out and logs in with the new password.
    player.token_hash = secrets.token_bytes(32)
    session.commit()
    return f"{describe(player)}, password reset, logged out everywhere"


def run(
    sessions: sessionmaker[Session],
    argv: Sequence[str],
    *,
    passwords: PasswordHasher | None = None,
    read_password: Callable[[str], str] = getpass.getpass,
) -> str:
    """Execute one command; returns the line to print. Raises ``AdminError``.

    ``passwords`` defaults to the hasher of ``Settings()``; ``read_password`` reads a password
    without echo (tests pass their own)."""
    parser = argparse.ArgumentParser(prog="gow-admin", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("show", "block", "unblock", "reset-password"):
        sub.add_parser(name).add_argument("player", help="id or nick")
    renamer = sub.add_parser("rename")
    renamer.add_argument("player", help="id or nick")
    renamer.add_argument("nick", help="new nick")
    args = parser.parse_args(argv)
    with sessions() as session:
        match args.command:
            case "show":
                return describe(find_player(session, args.player))
            case "rename":
                return rename(session, args.player, args.nick)
            case "block":
                return set_blocked(session, args.player, blocked=True)
            case "reset-password":
                hasher = passwords or PasswordHasher(Settings())
                return reset_password(session, args.player, hasher, read_password)
            case _:
                return set_blocked(session, args.player, blocked=False)


def main(argv: Sequence[str] | None = None) -> None:
    engine = create_db_engine(Settings().database_url)
    try:
        upgrade_to_head(engine)
        sessions = sessionmaker(engine, expire_on_commit=False)
        print(run(sessions, sys.argv[1:] if argv is None else argv))
    except AdminError as exc:
        sys.exit(f"gow-admin: {exc}")
    finally:
        engine.dispose()
