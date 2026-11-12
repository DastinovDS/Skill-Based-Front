"""scripts/snapshot_size.py (#482, ARP-08): the snapshot size report on a pool map."""

import importlib.util
from pathlib import Path

from gow_sim.maps import load_map

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("snapshot_size", ROOT / "scripts" / "snapshot_size.py")
assert _spec is not None and _spec.loader is not None
snapshot_size = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(snapshot_size)


def test_deflate_matches_the_server_setting() -> None:
    """The report assumes what ``uvicorn`` configures for the match WebSocket; a change of its
    window or memory level must change the script with it."""
    from uvicorn.protocols.websockets import websockets_sansio_impl

    source = Path(websockets_sansio_impl.__file__).read_text(encoding="utf-8")
    assert f"server_max_window_bits={snapshot_size.WBITS}" in source
    assert f'"memLevel": {snapshot_size.MEM_LEVEL}' in source


def test_report_on_a_short_match() -> None:
    mapdef = load_map(ROOT / "maps" / "narrows.json")
    sizes, played = snapshot_size.measure(mapdef, 120)
    assert played == 120
    assert len(sizes.raw) == len(sizes.streaming) == len(sizes.once) == 240
    assert all(0 < s < r for s, r in zip(sizes.streaming, sizes.raw, strict=True))
    text = snapshot_size.report("narrows", mapdef, sizes, played)
    assert "### narrows (29 nodes, 50 roads), 120 ticks, 240 frames" in text
    assert "deflate, streaming" in text
