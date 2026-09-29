"""Tests for scoring grouping runs against the topic rulings, and carrying a ruling to another division.

The report is a command, named with a hyphen, so it is loaded by path.
"""

import importlib.util
import os

import pytest

from division_support import HERE

spec = importlib.util.spec_from_file_location(
    "report_topic_rulings", os.path.join(HERE, "report-topic-rulings.py")
)
report_topic_rulings = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report_topic_rulings)

Ruling = report_topic_rulings.Ruling


@pytest.mark.parametrize(
    ("grouping", "expected"),
    [
        ({2, 5}, True),
        ({2, 5, 7}, True),
        ({2}, False),
        ({2, 5, 9}, False),
    ],
)
def test_should_ignore_an_either_subtopic_when_a_grouping_is_matched(grouping, expected):
    # Arrange — topics start at 2 and 5; 7 may or may not.
    ruling = Ruling(starts=frozenset({2, 5}), either=frozenset({7}), one_of=())

    # Act
    matched = report_topic_rulings.matches(frozenset(grouping), ruling)

    # Assert
    assert matched is expected


@pytest.mark.parametrize(
    ("grouping", "expected"),
    [
        ({2, 14}, True),
        ({2, 15}, True),
        ({2, 14, 15}, False),
        ({2}, False),
    ],
)
def test_should_need_exactly_one_start_from_a_one_of_group_when_a_grouping_is_matched(grouping, expected):
    # Arrange
    ruling = Ruling(starts=frozenset({2}), either=frozenset(), one_of=(frozenset({14, 15}),))

    # Act
    matched = report_topic_rulings.matches(frozenset(grouping), ruling)

    # Assert
    assert matched is expected


def test_should_carry_a_ruling_by_position_when_the_target_division_numbers_subtopics_differently():
    # Arrange — the target adds a subtopic at 30%, so everything after it is renumbered,
    # and it has no subtopic at 70%, where the source's subtopic 4 starts.
    source = [0.0, 20.0, 50.0, 70.0]
    target = [0.0, 20.0, 30.0, 50.3]
    ruling = Ruling(starts=frozenset({2, 3, 4}), either=frozenset(), one_of=())

    # Act
    carried, lost = report_topic_rulings.carry(ruling, source=source, target=target)

    # Assert
    assert carried == Ruling(starts=frozenset({2, 4}), either=frozenset(), one_of=())
    assert lost == [4]


def test_should_carry_a_start_to_the_nearest_subtopic_when_two_start_within_the_tolerance():
    # Arrange — the target's subtopics 3 and 4 start under a point apart; the ruling starts a topic at 4.
    division = [0.0, 50.0, 98.34, 99.33]
    ruling = Ruling(starts=frozenset({4}), either=frozenset(), one_of=())

    # Act
    carried, lost = report_topic_rulings.carry(ruling, source=division, target=division)

    # Assert
    assert carried == ruling
    assert lost == []


def test_should_number_topic_starts_from_topic_sizes_when_a_run_is_read():
    # Arrange — three topics of 1, 3 and 2 subtopics start at subtopics 1, 2 and 5.
    sizes = [1, 3, 2]

    # Act
    starts = report_topic_rulings.topic_starts(sizes)

    # Assert
    assert starts == frozenset({2, 5})
