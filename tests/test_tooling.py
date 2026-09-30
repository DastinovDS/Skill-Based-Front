"""Smoke tests for the shared Python tooling (INF-02)."""

import importlib
import os

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

WORKSPACE_PACKAGES = ["gow_sim", "gow_protocol", "gow_server", "gow_bots", "gow_maps"]


def _fields(profile: settings) -> tuple[object, object, object]:
    # hypothesis.settings properties lack return annotations: pyright strict sees them as
    # partially Unknown.
    return (profile.max_examples, profile.derandomize, profile.deadline)  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]


@pytest.mark.parametrize("name", WORKSPACE_PACKAGES)
def test_workspace_package_imports(name: str) -> None:
    assert importlib.import_module(name).__name__ == name


def test_hypothesis_profile_is_loaded_from_environment() -> None:
    name = os.environ.get("HYPOTHESIS_PROFILE", "dev")
    assert _fields(settings()) == _fields(settings.get_profile(name))


def test_ci_profile_is_reproducible() -> None:
    _, derandomize, deadline = _fields(settings.get_profile("ci"))
    assert derandomize is True
    assert deadline is None


@given(st.integers(min_value=0), st.integers(min_value=1))
def test_hypothesis_runs(value: int, divisor: int) -> None:
    assert (value // divisor) * divisor + value % divisor == value
