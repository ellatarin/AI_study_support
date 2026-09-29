"""Tests for when two splitting runs' cuts are one cut site, and when a panel keeps one.

Both ways of finding cut sites — with a support count, and with the runs that
cut there — must answer the question the same way, or the reports built on each
can disagree about one lecture.
"""

import pytest

from division_support import (
    central_run,
    cut_sites,
    cut_sites_with_runs,
    most_common_run,
    site_sets,
    survives,
    voted_cuts,
)


def sites_by_count(runs):
    """Cut sites as (position, support), from the count."""
    return [(round(position, 1), support) for position, support in cut_sites(runs)]


def sites_by_runs(runs):
    """Cut sites as (position, support), from the runs that cut there."""
    return [
        (round(position, 1), mask.bit_count())
        for position, mask in cut_sites_with_runs(runs)
    ]


# Three runs, each cutting 0.8 points after the last: every cut is within a
# point of its neighbour, but the outer two are 1.6 apart.
DRIFTING_CUTS = [[39.5], [40.3], [41.1]]


@pytest.mark.parametrize("find", [sites_by_count, sites_by_runs])
def test_should_start_a_new_cut_site_when_a_cut_is_over_a_point_from_the_sites_first_cut(find):
    # Arrange
    runs = DRIFTING_CUTS

    # Act
    sites = find(runs)

    # Assert
    assert sites == [(39.9, 2), (41.1, 1)]


@pytest.mark.parametrize("find", [sites_by_count, sites_by_runs])
def test_should_count_every_run_that_cut_at_a_site_when_the_cuts_are_close(find):
    # Arrange
    runs = [[25.0, 60.0], [25.2, 60.2], [24.8]]

    # Act
    sites = find(runs)

    # Assert
    assert sites == [(25.0, 3), (60.1, 2)]


# A cut site cut by runs 0 and 1, read by a panel of runs 0, 1 and 2.
SITE_CUT_BY_FIRST_TWO = 0b011
PANEL_OF_FIRST_THREE = 0b111


@pytest.mark.parametrize("bar, kept", [(1, True), (2, True), (3, False)])
def test_should_keep_a_cut_site_when_its_support_in_the_panel_reaches_the_bar(bar, kept):
    # Arrange
    site, panel = SITE_CUT_BY_FIRST_TWO, PANEL_OF_FIRST_THREE

    # Act
    result = survives(site, panel, bar)

    # Assert
    assert result is kept


# Three runs over a 1,000-character transcript. Two agree exactly at 250 and the
# third lands two characters later. Two cut near 600, two characters apart.
CUTS_IN_CHARACTERS = [[250, 600], [250, 602], [252]]
TRANSCRIPT_LENGTH = 1000


@pytest.mark.parametrize(
    "bar, expected",
    [
        (3, [250]),
        # 600 and 602 are each used once: the earlier wins the tie.
        (2, [250, 600]),
    ],
)
def test_should_cut_at_the_most_used_character_when_a_cut_site_reaches_the_bar(bar, expected):
    # Arrange
    runs = CUTS_IN_CHARACTERS

    # Act
    cuts = voted_cuts(runs, TRANSCRIPT_LENGTH, bar)

    # Assert
    assert cuts == expected


def test_should_give_each_run_the_cut_sites_it_cut_at_when_sites_carry_their_runs():
    # Arrange
    runs = [[25.0, 60.0], [25.2], [60.1, 80.0]]

    # Act
    sets = site_sets(cut_sites_with_runs(runs), len(runs))

    # Assert
    assert sets == [frozenset({0, 1}), frozenset({0}), frozenset({1, 2})]


# Each run's division as the cut sites it cuts at. Runs 0 and 1 make the same
# division, far from the rest; run 2 is closest to everyone.
SITES_PAIR_APART = [
    frozenset({9}),
    frozenset({9}),
    frozenset({1, 2}),
    frozenset({1, 2, 3}),
    frozenset({1, 2, 4}),
]
EVERY_RUN = range(len(SITES_PAIR_APART))


@pytest.mark.parametrize(
    "sets, panel, expected",
    [
        (SITES_PAIR_APART, EVERY_RUN, 2),
        # Runs 0 and 1 are equally close to the others: the earlier is taken.
        ([frozenset({1}), frozenset({2}), frozenset({9, 8})], range(3), 0),
        # Only the panel's runs count, both as candidates and as the others.
        (SITES_PAIR_APART, (0, 1, 3), 0),
    ],
)
def test_should_pick_the_run_closest_to_the_others_when_choosing_the_central_run(sets, panel, expected):
    # Arrange, in the parameters

    # Act
    chosen = central_run(sets, panel)

    # Assert
    assert chosen == expected


@pytest.mark.parametrize(
    "sets, panel, expected",
    [
        # Two runs make the same division; it is taken although run 2 is more central.
        (SITES_PAIR_APART, EVERY_RUN, 0),
        # Two divisions are made twice each: the one closer to the others wins.
        ([frozenset({9}), frozenset({9}), frozenset({1, 2}), frozenset({1, 2}), frozenset({1, 2, 3})], range(5), 2),
        # Every division made once: the most central run is taken.
        (SITES_PAIR_APART, (2, 3, 4), 2),
    ],
)
def test_should_pick_the_division_most_runs_made_when_choosing_the_most_common(sets, panel, expected):
    # Arrange, in the parameters

    # Act
    chosen = most_common_run(sets, panel)

    # Assert
    assert chosen == expected
