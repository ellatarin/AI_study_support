"""Tests for how alike two panels' voted divisions are, at each bar.

The report is a command, named with a hyphen, so it is loaded by path.
"""

import importlib.util
import os

from division_support import HERE

spec = importlib.util.spec_from_file_location(
    "report_consistency", os.path.join(HERE, "report-consistency.py")
)
report_consistency = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report_consistency)


def test_should_agree_at_every_bar_when_every_run_cuts_at_the_same_sites():
    # Arrange
    runs = [[20.0, 60.0]] * 4

    # Act
    by_bar = report_consistency.halves_by_bar(runs, panel=2)

    # Assert
    assert by_bar == {
        1: report_consistency.BarConsistency(disagreeing=0, identical=1.0, kept=2),
        2: report_consistency.BarConsistency(disagreeing=0, identical=1.0, kept=2),
    }


def test_should_disagree_in_every_split_when_a_sites_support_is_one_short_of_twice_the_bar():
    # Arrange — three of four runs cut at 40%, so every split into halves of two
    # gives one half two votes and the other one.
    runs = [[40.0], [40.0], [40.0], []]

    # Act
    by_bar = report_consistency.halves_by_bar(runs, panel=2)

    # Assert
    assert by_bar[1] == report_consistency.BarConsistency(disagreeing=0, identical=1.0, kept=1)
    assert by_bar[2] == report_consistency.BarConsistency(disagreeing=1, identical=0.0, kept=0.5)
