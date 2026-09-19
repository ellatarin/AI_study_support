"""Tests for when two splitting runs' cuts are one cut site.

Both ways of finding cut sites — with a support count, and with the runs that
cut there — must answer the question the same way, or the reports built on each
can disagree about one lecture.
"""

import pytest

from division_support import cut_sites, cut_sites_with_runs


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
