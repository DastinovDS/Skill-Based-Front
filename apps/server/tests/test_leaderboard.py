"""LB-01 (#78): ``GET /api/leaderboard`` and ``GET /api/players/{id}``.

Who is listed follows DEC-34 (mechanics.md, section 19): a password account that finished
calibration and is not blocked. The expected ranks and numbers are worked out by hand from the
seeded ratings (``r - 2 * RD``), not read back from the endpoint.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Final

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from gow_server.app import create_app
from gow_server.identity import hash_token
from gow_server.ladder import LadderRules, apply_match
from gow_server.models import Match, MatchPlayer, Player, Rating
from gow_server.replays import ReplayService
from gow_server.settings import Settings

T0: Final = datetime(2026, 10, 1, 12, 0, 0)


@dataclass(frozen=True)
class Side:
    player: int | None = None
    bot: str | None = None
    result: str = "win"
    mode: str = "none"
    reason: str | None = None
    before: float | None = None
    after: float | None = None


class Db:
    """Direct writes to the database behind the app under test."""

    def __init__(self, client: TestClient) -> None:
        self.sessions: sessionmaker[Session] = client.app.state.sessions  # type: ignore[attr-defined]
        self.clock = 0

    def player(
        self,
        nick: str,
        *,
        password: bool = True,
        rating: float = 1500.0,
        rd: float = 350.0,
        played: int | None = None,
        blocked: bool = False,
    ) -> int:
        """A player; ``played`` (rating-changing matches) set means it has a rating row."""
        with self.sessions.begin() as session:
            player = Player(
                nick=nick,
                nick_key=nick.casefold(),
                token_hash=hash_token(f"token-{nick}"),
                password_hash="x" if password else None,
                blocked_at=T0 if blocked else None,
            )
            session.add(player)
            session.flush()
            if played is not None:
                session.add(
                    Rating(
                        player_id=player.id,
                        rating=rating,
                        rd=rd,
                        volatility=0.06,
                        rated_matches=played,
                    )
                )
            return player.id

    def match(
        self,
        first: Side,
        second: Side,
        *,
        rated: bool = False,
        status: str = "saved",
        replay_path: str | None = "x.frames.json.gz",
        expired: bool = False,
        map_id: str = "line3",
        ticks: int = 3000,
    ) -> int:
        self.clock += 1
        ended = T0 + timedelta(minutes=self.clock)
        with self.sessions.begin() as session:
            match = Match(
                map_id=map_id,
                ruleset_hash="h",
                rated=rated,
                status=status,
                ended_at=ended,
                end_reason="eliminated",
                ticks=ticks,
                replay_path=None if expired else replay_path,
                replay_expired_at=ended if expired else None,
            )
            session.add(match)
            session.flush()
            for index, side in enumerate((first, second)):
                session.add(
                    MatchPlayer(
                        match_id=match.id,
                        side=index,
                        player_id=side.player,
                        bot=side.bot,
                        result=side.result,
                        rating_mode=side.mode,
                        unrated_reason=side.reason,
                        rating_before=side.before,
                        rating_after=side.after,
                    )
                )
            return match.id


@pytest.fixture
def db(client: TestClient) -> Db:
    return Db(client)


def get_board(client: TestClient) -> dict[str, Any]:
    response = client.get("/api/leaderboard")
    assert response.status_code == 200
    return response.json()  # type: ignore[no-any-return]


def get_profile(client: TestClient, player_id: int, token: str | None = None) -> dict[str, Any]:
    headers = {} if token is None else {"Authorization": f"Bearer {token}"}
    response = client.get(f"/api/players/{player_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()  # type: ignore[no-any-return]


# Leaderboard ---------------------------------------------------------------------------------


def test_an_empty_leaderboard(client: TestClient) -> None:
    assert get_board(client) == {"entries": [], "total": 0, "min_rated_matches": 5}


def test_the_leaderboard_orders_by_r_minus_two_rd_and_skips_who_dec_34_excludes(
    client: TestClient, db: Db
) -> None:
    # Displayed rating r - 2 * RD: a 1700 with a wide RD is below a 1600 with a narrow one.
    a = db.player("a", rating=1600.0, rd=100.0, played=5)  # 1400
    b = db.player("b", rating=1700.0, rd=200.0, played=9)  # 1300
    f = db.player("f", rating=1500.0, rd=100.0, played=5)  # 1300: ties with b, b has the lower id
    db.player("calibrating", rating=2000.0, rd=50.0, played=4)  # one match short
    db.player("guest", password=False, rating=2000.0, rd=50.0, played=12)
    db.player("blocked", rating=2000.0, rd=50.0, played=12, blocked=True)
    db.player("unplayed")  # no rating row at all
    board = get_board(client)
    assert [(e["rank"], e["player_id"], e["nick"], e["rating"]) for e in board["entries"]] == [
        (1, a, "a", 1400),
        (2, b, "b", 1300),
        (3, f, "f", 1300),
    ]
    assert [e["rated_matches"] for e in board["entries"]] == [5, 9, 5]
    assert board["total"] == 3
    assert board["min_rated_matches"] == 5


def test_the_leaderboard_rounds_the_displayed_rating(client: TestClient, db: Db) -> None:
    db.player("a", rating=1500.0, rd=100.3, played=5)  # 1299.4
    db.player("b", rating=1500.0, rd=99.6, played=5)  # 1300.8
    assert [(e["nick"], e["rating"]) for e in get_board(client)["entries"]] == [
        ("b", 1301),
        ("a", 1299),
    ]


def test_the_leaderboard_is_limited_to_the_top_100(client: TestClient, db: Db) -> None:
    for i in range(105):
        db.player(f"p{i:03d}", rating=1500.0 + i, rd=50.0, played=5)
    board = get_board(client)
    assert len(board["entries"]) == 100
    assert board["total"] == 105
    assert board["entries"][0]["nick"] == "p104"  # the best of 105
    assert board["entries"][-1]["nick"] == "p005"  # the 100th: p104 down to p005
    assert board["entries"][-1]["rank"] == 100


def test_the_leaderboard_needs_the_configured_number_of_matches(settings: Settings, db: Db) -> None:
    with TestClient(create_app(settings.model_copy(update={"calibration_matches": 2}))) as client:
        other = Db(client)
        other.player("two", played=2)
        other.player("one", played=1)
        board = get_board(client)
    assert [e["nick"] for e in board["entries"]] == ["two"]
    assert board["min_rated_matches"] == 2


def test_the_leaderboard_row_has_the_record_of_the_rating_changing_matches(
    client: TestClient, db: Db
) -> None:
    a = db.player("a", rating=1600.0, rd=100.0, played=5)
    # Played 5 matches that changed the rating (2 wins, 2 losses, 1 draw). The invite and bot wins
    # do not change it and do not count; a loss against a guest is unrated too.
    guest = db.player("guest", password=False)
    opponent = db.player("opp", played=5)
    for result in ("win", "win", "loss", "loss", "draw"):
        db.match(
            Side(a, result=result, mode="rated", before=1000.0, after=1100.0),
            Side(opponent, result="loss"),
            rated=True,
        )
    db.match(Side(a, result="win"), Side(opponent, result="loss"))
    db.match(Side(a, result="win"), Side(bot="easy", result="loss"))
    db.match(
        Side(a, result="loss", reason="opponent_guest"),
        Side(guest, result="win", reason="guest"),
        rated=False,
    )
    # Unfinished matches are not in the record.
    db.match(Side(a, result="win"), Side(opponent, result="loss"), status="aborted")
    entry = get_board(client)["entries"][0]
    assert entry["nick"] == "a"
    assert entry["record"] == {"wins": 2, "losses": 2, "draws": 1}
    assert entry["rated_matches"] == 5


# Profile -------------------------------------------------------------------------------------


def test_a_ranked_profile(client: TestClient, db: Db) -> None:
    db.player("top", rating=1700.0, rd=50.0, played=7)  # 1600
    me = db.player("me", rating=1600.0, rd=100.0, played=5)  # 1400
    db.player("low", rating=1500.0, rd=100.0, played=5)  # 1300
    profile = get_profile(client, me)
    assert profile["nick"] == "me"
    assert profile["has_password"] is True
    assert profile["rating"] == 1400
    assert profile["rank"] == 2
    assert profile["calibration"] is None
    assert profile["rated_matches"] == 5
    assert profile["matches"] == []


def test_the_rank_counts_players_outside_the_top_100(client: TestClient, db: Db) -> None:
    for i in range(101):
        db.player(f"p{i:03d}", rating=1500.0 + i, rd=50.0, played=5)
    last = db.player("last", rating=1000.0, rd=50.0, played=5)
    assert get_profile(client, last)["rank"] == 102
    assert all(e["player_id"] != last for e in get_board(client)["entries"])


def test_a_calibrating_profile_hides_the_rating(client: TestClient, db: Db) -> None:
    me = db.player("me", rating=1900.0, rd=60.0, played=3)
    profile = get_profile(client, me)
    assert profile["rating"] is None
    assert profile["rank"] is None
    assert profile["calibration"] == {"played": 3, "total": 5}
    assert profile["rated_matches"] == 3


def test_a_profile_without_a_rating_row_starts_calibration_at_zero(
    client: TestClient, db: Db
) -> None:
    me = db.player("me")
    assert get_profile(client, me)["calibration"] == {"played": 0, "total": 5}


def test_a_guest_profile_has_no_rating_and_no_calibration(client: TestClient, db: Db) -> None:
    guest = db.player("guest", password=False, rating=1500.0, rd=100.0, played=9)
    profile = get_profile(client, guest)
    assert profile["has_password"] is False
    assert (profile["rating"], profile["rank"], profile["calibration"]) == (None, None, None)


def test_an_unknown_or_blocked_player_is_404(client: TestClient, db: Db) -> None:
    blocked = db.player("bad", blocked=True, played=9)
    assert client.get("/api/players/999").status_code == 404
    assert client.get(f"/api/players/{blocked}").status_code == 404
    assert client.get("/api/players/0").status_code == 422
    assert client.get("/api/players/abc").status_code == 422


def test_the_records_of_a_profile_split_all_matches_from_the_rating_changing_ones(
    client: TestClient, db: Db
) -> None:
    me = db.player("me", rating=1500.0, rd=100.0, played=5)
    opp = db.player("opp", played=5)
    for result in ("win", "win", "loss", "loss", "draw"):
        db.match(
            Side(me, result=result, mode="rated", before=1200.0, after=1210.0),
            Side(opp),
            rated=True,
        )
    db.match(Side(me, result="win"), Side(opp, result="loss"))
    db.match(Side(me, result="loss"), Side(bot="hard"))
    profile = get_profile(client, me)
    assert profile["rated_record"] == {"wins": 2, "losses": 2, "draws": 1}
    assert profile["record"] == {"wins": 3, "losses": 3, "draws": 1}


# Match history -------------------------------------------------------------------------------


def test_the_history_is_the_last_20_matches_newest_first(client: TestClient, db: Db) -> None:
    me = db.player("me")
    opp = db.player("opp")
    ids = [db.match(Side(me), Side(opp, result="loss")) for _ in range(25)]
    matches = get_profile(client, me)["matches"]
    assert [m["match_id"] for m in matches] == ids[:4:-1]
    assert len(matches) == 20


def test_the_history_skips_matches_that_are_not_finished(client: TestClient, db: Db) -> None:
    me = db.player("me")
    done = db.match(Side(me), Side(bot="easy", result="loss"))
    db.match(Side(me), Side(bot="easy"), status="running")
    db.match(Side(me), Side(bot="easy"), status="aborted")
    assert [m["match_id"] for m in get_profile(client, me)["matches"]] == [done]


def test_a_history_row_says_the_kind_the_opponent_and_the_result(
    client: TestClient, db: Db
) -> None:
    me = db.player("me", rating=1500.0, rd=100.0, played=6)
    opp = db.player("opp", played=5)
    guest = db.player("guest", password=False)
    casual = db.match(Side(me, result="loss"), Side(opp), map_id="diamond", ticks=1234)
    bot = db.match(Side(me), Side(bot="hard", result="loss"))
    unrated = db.match(
        Side(me, result="draw", reason="opponent_guest"), Side(guest, result="draw", reason="guest")
    )
    rated = db.match(
        Side(me, mode="rated", before=1000.0, after=1040.4), Side(opp, result="loss"), rated=True
    )
    rows = {m["match_id"]: m for m in get_profile(client, me)["matches"]}
    assert rows[casual]["kind"] == "casual"
    assert rows[casual]["result"] == "loss"
    assert rows[casual]["map_id"] == "diamond"
    assert rows[casual]["ticks"] == 1234
    assert rows[casual]["opponent"] == {"player_id": opp, "nick": "opp", "bot": False}
    assert rows[casual]["unrated_reason"] is None
    assert rows[bot]["kind"] == "bot"
    assert rows[bot]["opponent"] == {"player_id": None, "nick": "hard", "bot": True}
    assert rows[unrated]["kind"] == "unrated"
    assert rows[unrated]["unrated_reason"] == "opponent_guest"
    assert rows[unrated]["result"] == "draw"
    assert rows[unrated]["opponent"]["player_id"] == guest
    assert rows[rated]["kind"] == "rated"
    assert rows[rated]["rating_change"] == {"before": 1000, "after": 1040}
    assert rows[casual]["rating_change"] is None
    assert rows[rated]["ended_at"].endswith("Z") or rows[rated]["ended_at"].endswith("+00:00")


def test_calibration_matches_hide_the_rating_change_until_the_one_that_completes_it(
    client: TestClient, db: Db
) -> None:
    me = db.player("me", rating=1500.0, rd=100.0, played=6)
    opp = db.player("opp", played=9)
    ids = [
        db.match(
            Side(me, mode="calibration", before=800.0 + i, after=810.0 + i),
            Side(opp, result="loss"),
            rated=True,
        )
        for i in range(5)
    ]
    sixth = db.match(
        Side(me, mode="rated", before=900.0, after=910.0), Side(opp, result="loss"), rated=True
    )
    rows = {m["match_id"]: m for m in get_profile(client, me)["matches"]}
    assert [rows[i]["kind"] for i in ids] == ["calibration"] * 5
    # Matches 1 to 4 are hidden; the 5th completes the calibration and is shown, as in match_end.
    assert [rows[i]["rating_change"] for i in ids[:4]] == [None] * 4
    assert rows[ids[4]]["rating_change"] == {"before": 804, "after": 814}
    assert rows[sixth]["rating_change"] == {"before": 900, "after": 910}


def test_a_player_still_in_calibration_shows_no_rating_change_at_all(
    client: TestClient, db: Db
) -> None:
    me = db.player("me", rating=1500.0, rd=100.0, played=3)
    opp = db.player("opp", played=9)
    for i in range(3):
        db.match(
            Side(me, mode="calibration", before=800.0 + i, after=810.0 + i),
            Side(opp, result="loss"),
            rated=True,
        )
    assert [m["rating_change"] for m in get_profile(client, me)["matches"]] == [None] * 3


def test_a_rated_match_updates_the_profile_and_the_leaderboard(client: TestClient, db: Db) -> None:
    """The acceptance criterion: after a rated match both players see the change.

    Two calibrated accounts with the initial rating (1500 / 350 / 0.06) play one match; the new
    numbers are from the independent Glicko-2 example in ``test_rating_updates.py``: the winner
    goes from 800 to 1082, the loser from 800 to 757 (displayed ``r - 2 * RD``).
    """
    winner = db.player("winner", rating=1500.0, rd=350.0, played=5)
    loser = db.player("loser", rating=1500.0, rd=350.0, played=5)
    match = db.match(
        Side(winner, mode="rated"), Side(loser, result="loss", mode="rated"), rated=True
    )
    before = get_board(client)
    assert [(e["nick"], e["rating"]) for e in before["entries"]] == [
        ("winner", 800),
        ("loser", 800),
    ]
    with db.sessions.begin() as session:
        assert apply_match(session, match, LadderRules()) is True
    board = get_board(client)
    assert [(e["nick"], e["rating"], e["rated_matches"]) for e in board["entries"]] == [
        ("winner", 1082, 6),
        ("loser", 757, 6),
    ]
    assert board["entries"][0]["record"] == {"wins": 1, "losses": 0, "draws": 0}
    assert board["entries"][1]["record"] == {"wins": 0, "losses": 1, "draws": 0}
    won, lost = get_profile(client, winner), get_profile(client, loser)
    assert (won["rating"], won["rank"]) == (1082, 1)
    assert (lost["rating"], lost["rank"]) == (757, 2)
    assert won["matches"][0]["rating_change"] == {"before": 800, "after": 1082}
    assert lost["matches"][0]["rating_change"] == {"before": 800, "after": 757}
    assert won["matches"][0]["opponent"]["nick"] == "loser"


# Replay links --------------------------------------------------------------------------------


def test_replay_links_by_state(client: TestClient, db: Db, monkeypatch: pytest.MonkeyPatch) -> None:
    me = db.player("me")
    opp = db.player("opp")
    ready = db.match(Side(me), Side(opp, result="loss"), rated=True)
    expired = db.match(Side(me), Side(opp, result="loss"), rated=True, expired=True)
    missing = db.match(Side(me), Side(opp, result="loss"), rated=True, replay_path=None)
    building = db.match(Side(me), Side(opp, result="loss"), rated=True, replay_path=None)

    def is_building(_service: ReplayService, match_id: str) -> bool:
        return match_id == str(building)

    monkeypatch.setattr(ReplayService, "is_building", is_building)
    links = {m["match_id"]: m["replay"] for m in get_profile(client, me)["matches"]}
    assert links[ready] == {"state": "ready", "url": f"/api/replays/{ready}"}
    assert links[expired] == {"state": "expired", "url": None}
    assert links[missing] == {"state": "unavailable", "url": None}
    assert links[building] == {"state": "preparing", "url": f"/api/replays/{building}"}


def test_the_replay_of_an_unrated_match_is_only_a_link_for_its_players(
    client: TestClient, db: Db
) -> None:
    me = db.player("me")
    opp = db.player("opp")
    stranger = db.player("stranger")
    casual = db.match(Side(me), Side(opp, result="loss"))
    rated = db.match(Side(me), Side(opp, result="loss"), rated=True)
    bot = db.match(Side(me), Side(bot="easy", result="loss"))

    def states(token: str | None) -> dict[int, str]:
        return {
            m["match_id"]: m["replay"]["state"] for m in get_profile(client, me, token)["matches"]
        }

    # Rated replays are public (GET /api/replays/{id}); the others need to be a player.
    assert states(None) == {casual: "private", rated: "ready", bot: "private"}
    assert states("token-stranger") == {casual: "private", rated: "ready", bot: "private"}
    assert states("token-nobody") == {casual: "private", rated: "ready", bot: "private"}
    assert states("token-me") == {casual: "ready", rated: "ready", bot: "ready"}
    assert states("token-opp") == {casual: "ready", rated: "ready", bot: "private"}
    assert stranger > 0


def test_a_blocked_viewer_is_anonymous(client: TestClient, db: Db) -> None:
    me = db.player("me")
    db.player("viewer", blocked=True)
    casual = db.match(Side(me), Side(bot="easy", result="loss"))
    matches = get_profile(client, me, "token-viewer")["matches"]
    assert [(m["match_id"], m["replay"]["state"]) for m in matches] == [(casual, "private")]


# Rate limit ----------------------------------------------------------------------------------


@pytest.fixture
def limited(settings: Settings) -> Iterator[TestClient]:
    limits = {"public_read_rate_limit": 3, "public_read_rate_window_s": 60}
    with TestClient(create_app(settings.model_copy(update=limits))) as client:
        yield client


def test_the_public_reads_share_a_per_ip_limit(limited: TestClient) -> None:
    Db(limited).player("me")
    assert limited.get("/api/leaderboard").status_code == 200
    assert limited.get("/api/players/1").status_code == 200
    assert limited.get("/api/leaderboard").status_code == 200
    blocked = limited.get("/api/players/1")
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) >= 1
    assert limited.get("/api/leaderboard").status_code == 429
