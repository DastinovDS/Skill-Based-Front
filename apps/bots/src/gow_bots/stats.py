"""``gow-bots stats``: the statistics of a match as a table for a human (#375).

One block per replay, one column per player; the numbers are ``gow_sim.analysis.PlayerStats``
and ``MatchMetrics`` (definitions: its module docstring and ``docs/balance/README.md``). CP are
shown in whole CP with two decimals (the journal counts hundredths).

The rows follow the economy of the match (#690): under economy v2 the rows of v1 mechanics that
v2 rejects (stances, front markers, the rear minimum, transfers, road upgrades) and the marker
columns of the supply are left out; the mechanic counts (``usage``) list only the commands the
economy and the supply model of the match accept (``gow_bots.tournament.live_keys``). With
``[stances]`` (DEC-44) the stance rows are back, with the share of the match, the switches and the
CP and charges earned under each stance; under v2 the charges of the capital and of the built
factories always have a row.
"""

from collections.abc import Callable, Mapping, Sequence

from gow_bots.tournament import live_keys
from gow_sim.analysis import CP_CATEGORIES, PLACES, MatchMetrics, MatchStats, PlayerStats

__all__ = ["render_stats"]

_STANCE_SHORT = 4
"""Longest stance timeline printed in full; more changes show the first ones and a count."""
_TICKS_SHORT = 4
"""Ticks of one kind of action printed in the table."""
_V1_CP: tuple[str, ...] = ("road", "transfer")
"""CP categories of commands economy v2 rejects (``UpgradeRoad``, ``Transfer``)."""
_V1_PLACES: tuple[str, ...] = ("front_wh",)
"""Places of the stock that need front markers (economy v1)."""


def _cp(hundredths: int) -> str:
    sign = "-" if hundredths < 0 else ""
    whole, frac = divmod(abs(hundredths), 100)
    return f"{sign}{whole}.{frac:02d}"


def _centi(value: int | None) -> str:
    return "-" if value is None else _cp(value)


def _share(value: float | None) -> str:
    return "-" if value is None else f"{value * 100:.1f}%"


def _ticks(ticks: Sequence[int]) -> str:
    """The number of actions and the first ticks (all of them are in the JSONL of ``analyze``)."""
    if not ticks:
        return "0"
    shown = ", ".join(str(t) for t in ticks[:_TICKS_SHORT])
    return f"{len(ticks)} (t={shown}{', ...' if len(ticks) > _TICKS_SHORT else ''})"


def _timeline(p: PlayerStats) -> str:
    line = [f"{t}:{s}" for t, s in p.stance_timeline]
    if len(line) > _STANCE_SHORT:
        line = [*line[:_STANCE_SHORT], f"... ({len(p.stance_timeline) - 1} changes)"]
    return " ".join(line)


_Row = tuple[str, Callable[[PlayerStats], str]]


def _stance_row(stance: str) -> _Row:
    return f"ticks in {stance}", lambda p: str(dict(p.stance_ticks)[stance])


def _share_row(stance: str) -> _Row:
    return f"share of time in {stance}", lambda p: _share(dict(p.stance_share)[stance])


def _earned_cp_row(stance: str) -> _Row:
    return f"CP earned in {stance}", lambda p: _cp(dict(p.cp_by_stance)[stance])


def _earned_charges_row(stance: str) -> _Row:
    def cell(p: PlayerStats) -> str:
        capital, built = next((c, b) for s, c, b in p.charges_by_stance if s == stance)
        return f"{capital} / {built}"

    return f"charges in {stance} (capital / built)", cell


def _cp_row(category: str) -> _Row:
    return f"CP {category}", lambda p: _cp(dict(p.cp_by_category)[category])


def _rows(stats: MatchStats, v1: bool) -> list[_Row]:
    v1_rows: list[_Row] = [
        ("stance (tick:stance)", _timeline),
        *(_stance_row(s) for s, _ in stats.players[0].stance_ticks),
    ]
    supply_v1: list[_Row] = [
        ("SetFront", lambda p: _ticks(p.front_ticks)),
        ("SetRearMin", lambda p: _ticks(p.rear_min_ticks)),
        ("Transfer (charges)", lambda p: f"{len(p.transfer_ticks)} ({p.transfer_charges})"),
    ]
    stances = [s for s, _ in stats.players[0].stance_ticks]
    stance_rows: list[_Row] = [
        *v1_rows,
        ("stance switches", lambda p: str(p.stance_switches)),
        *(_share_row(s) for s in stances),
        *(_earned_cp_row(s) for s in stances),
        *(_earned_charges_row(s) for s in stances),
    ]
    categories = [c for c in CP_CATEGORIES if v1 or c not in _V1_CP]
    return [
        *(stance_rows if stats.stances else v1_rows if v1 else []),
        ("commands (rejected)", lambda p: f"{p.commands} ({p.rejected})"),
        ("APM avg", lambda p: "-" if p.apm_avg is None else f"{p.apm_avg:.2f}"),
        ("APM peak (a minute)", lambda p: str(p.apm_peak)),
        ("APM by minute", lambda p: " ".join(str(n) for n in p.apm_by_minute)),
        *(supply_v1 if v1 else []),
        ("orders (planned)", lambda p: f"{p.orders} ({p.planned_orders})"),
        ("planned share", lambda p: _share(p.planned_share)),
        ("planned siege share (gate, #590)", lambda p: _share(p.planned_siege_share)),
        ("planned share of all attacks", lambda p: _share(p.planned_attack_share)),
        *(_cp_row(c) for c in categories),
        ("CP refunded (in recruit)", lambda p: _cp(p.cp_refunded)),
        ("CP total", lambda p: _cp(p.cp_total)),
    ]


def _permille(value: int | None) -> str:
    return "-" if value is None else f"{value / 10:.1f}%"


def _sent_cell(m: MatchMetrics, i: int) -> str:
    f = m.flow[i]
    return f"{f.sent} / {f.delivered} / {f.delivered_front}"


def _place_cell(place: str) -> Callable[[MatchMetrics, int], str]:
    """Mean stock in a place over the whole match: the mean of the minutes that have samples."""

    def cell(m: MatchMetrics, i: int) -> str:
        known = [v for name, vs in m.flow[i].stock_by_place_minute if name == place for v in vs]
        known = [v for v in known if v is not None]
        return _cp(sum(known) // len(known)) if known else "-"

    return cell


_FlowRow = tuple[str, Callable[[MatchMetrics, int], str]]


def _contested(m: MatchMetrics, i: int) -> str:
    return f"{m.contested_sieges[i]} ({m.contested_sieges_won[i]})"


def _charge_rows(v1: bool, stats: MatchStats) -> list[_FlowRow]:
    v2_sources: list[_FlowRow] = [
        ("charges from the capital", lambda _, i: str(stats.players[i].charges_capital)),
        ("charges from built factories", lambda _, i: str(stats.players[i].charges_built)),
    ]
    v2_sinks: list[_FlowRow] = [
        ("charges into buildings", lambda m, i: str(m.flow[i].built)),
        ("charges into buildings lost", lambda m, i: str(m.charges_built_lost[i])),
        ("charges into plans", lambda m, i: str(m.flow[i].plans)),
        ("charges to road tolls", lambda m, i: str(m.flow[i].tolls)),
    ]
    markers: list[_FlowRow] = [
        ("sent / delivered / to markers", _sent_cell),
        ("marker city empty", lambda m, i: _permille(m.flow[i].front_empty_permille)),
        (
            "  and capital has charges",
            lambda m, i: _permille(m.flow[i].front_empty_cap_has_permille),
        ),
    ]
    flow: list[_FlowRow] = [
        ("sent / delivered", lambda m, i: f"{m.flow[i].sent} / {m.flow[i].delivered}"),
        ("tolls paid / taken", lambda m, i: f"{m.flow[i].tolls_paid} / {m.flow[1 - i].tolls_paid}"),
        ("road forts built", lambda m, i: str(m.flow[i].forts_built)),
    ]
    places = [p for p in PLACES if v1 or p not in _V1_PLACES]
    return [
        ("charges start", lambda m, i: str(m.flow[i].start)),
        ("charges produced", lambda m, i: str(m.charges_produced[i])),
        *([] if v1 else v2_sources),
        ("charges burned (overflow)", lambda m, i: str(m.charges_burned[i])),
        ("charges spent in fights", lambda m, i: str(m.flow[i].fights)),
        ("charges spent on captures", lambda m, i: str(m.flow[i].captures)),
        ("charges lost in packets", lambda m, i: str(m.flow[i].packets_lost)),
        ("charges lost with warehouses", lambda m, i: str(m.flow[i].warehouses_lost)),
        ("charges starved", lambda m, i: str(m.flow[i].starved)),
        ("charges died with units", lambda m, i: str(m.flow[i].attrition)),
        *([] if v1 else v2_sinks),
        ("charges at the end", lambda m, i: str(m.flow[i].end)),
        ("ledger residual (0 = balanced)", lambda m, i: str(m.flow[i].residual)),
        *(markers if v1 else flow),
        ("capital full (ticks)", lambda m, i: str(m.flow[i].cap_full_ticks)),
        ("enemy units killed", lambda m, i: str(m.units_killed[i])),
        ("charges per kill", lambda m, i: _centi(m.charges_per_kill_centi[i])),
        ("siege fights / walk-ins", lambda m, i: f"{m.siege_fights[i]} / {m.siege_walk_ins[i]}"),
        ("contested sieges (won)", _contested),
        ("CP of cancelled moves", lambda m, i: _cp(m.cp_cancelled[i])),
        ("CP burned at the cap", lambda m, i: _cp(m.cp_burned[i])),
        ("ticks at the CP cap", lambda m, i: str(m.cp_cap_ticks[i])),
        ("idle discharged, connected", lambda m, i: str(m.idle_discharged_connected[i])),
        ("idle discharged, in pockets", lambda m, i: str(m.idle_discharged_pocket[i])),
        *((f"mean stock {place}", _place_cell(place)) for place in places),
    ]


def render_stats(
    name: str,
    metrics: MatchMetrics,
    stats: MatchStats,
    usage: Sequence[Mapping[str, int]] | None = None,
) -> str:
    """The table of one match: a title line and one row per statistic, a column per player.

    ``usage`` (``gow_bots.tournament.usage`` of the log) adds a row per mechanic the economy of
    the match accepts; without it there are no mechanic rows.
    """
    winner = "draw/none" if metrics.winner is None else f"player {metrics.winner}"
    contact = metrics.first_contact_tick
    lines = [
        f"{name}: {metrics.ticks} ticks ({metrics.duration_s:g} s), "
        f"winner {winner} ({metrics.reason}); economy {metrics.economy_model}"
        + ("" if metrics.economy_model == "v1" else f", supply {metrics.supply_model}")
        + f"; first contact {'none' if contact is None else f'at tick {contact}'}"
    ]
    v1 = metrics.economy_model == "v1"
    rows = [(label, [fmt(p) for p in stats.players]) for label, fmt in _rows(stats, v1)]
    if usage is not None:
        keys = live_keys(metrics.economy_model, metrics.supply_model, stats.stances)
        rows += [(f"{k} (accepted)", [str(u.get(k, 0)) for u in usage]) for k in keys]
    rows += [
        (label, [fmt(metrics, i) for i in range(len(stats.players))])
        for label, fmt in _charge_rows(v1, stats)
    ]
    width = max(len(label) for label, _ in rows)
    cols = [max(len(cells[i]) for _, cells in rows) for i in range(len(stats.players))]
    head = "player".ljust(width) + "".join(f"  {i:<{cols[i]}}" for i in range(len(cols)))
    lines.append(head)
    for label, cells in rows:
        lines.append(label.ljust(width) + "".join(f"  {c:<{cols[i]}}" for i, c in enumerate(cells)))
    return "\n".join(lines)
