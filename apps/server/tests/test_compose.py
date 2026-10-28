"""Audit SRV-07: ``compose.yaml`` passes every operator-tunable ``Settings`` field to ``app``.

``Settings`` forbids unknown ``GOW_*`` variables and ``compose.yaml`` lists the ones that reach the
container, so a setting missing there is silently ignored when it is put into ``.env``.
"""

import re
from pathlib import Path
from typing import Final

import pytest

from gow_server.settings import Settings

COMPOSE: Final = Path(__file__).parents[3] / "compose.yaml"

CONTAINER_PATHS: Final = {
    "host",
    "port",
    "maps_dir",
    "database_url",
    "replays_dir",
    "rulesets_dir",
    "rulesets_bundled_dir",
}
"""Fixed by the image (``deploy/app.Dockerfile``): not for the operator to change."""

PRODUCTION_DIFFERENCES: Final = {"env", "ruleset_path"}
"""Where the production default intentionally is not the ``Settings`` default: the stack runs in
``prod`` and plays the real ruleset (``forwarded_allow_ips`` is fixed to Caddy, not a default)."""


def compose_defaults() -> dict[str, str]:
    """``GOW_X`` to the default of ``${GOW_X:-default}`` in the ``app`` service."""
    text = COMPOSE.read_text()
    return dict(re.findall(r"^\s+(GOW_[A-Z0-9_]+): \$\{GOW_[A-Z0-9_]+:-([^}]*)\}", text, re.M))


def test_every_operator_setting_is_passed_through() -> None:
    passed = {name.removeprefix("GOW_").lower() for name in compose_defaults()}
    # GOW_FORWARDED_ALLOW_IPS has a fixed value ("*") rather than a default: Caddy is the only peer.
    passed.add("forwarded_allow_ips")
    expected = set(Settings.model_fields) - CONTAINER_PATHS
    assert expected - passed == set(), "settings missing from compose.yaml"
    assert passed - expected == set(), "compose.yaml names settings that do not exist"


def test_compose_defaults_are_the_settings_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    baseline = Settings()
    for name, value in compose_defaults().items():
        monkeypatch.setenv(name, value)
    configured = Settings()
    differing = {
        name
        for name in Settings.model_fields
        if name not in CONTAINER_PATHS and getattr(configured, name) != getattr(baseline, name)
    }
    assert differing == PRODUCTION_DIFFERENCES
