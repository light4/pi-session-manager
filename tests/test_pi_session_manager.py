"""Smoke tests for the package scaffold."""

import pi_session_manager


def test_package_has_description() -> None:
    assert pi_session_manager.__doc__
