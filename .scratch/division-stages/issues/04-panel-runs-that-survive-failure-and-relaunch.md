# 04 — Panel runs that survive failure and relaunch

**What to build:** any stage can make a panel of N independent runs and rely on shared behaviour for everything around the model call. Today a stage is all-or-nothing, makes one call, and fails on the first empty or malformed reply — yet the prototype saw an empty reply (a successful response with no content) in roughly 1 call in 12, and a plain resend always worked.

**Blocked by:** 03

**Status:** resolved

- [x] A stage can ask for N runs and receives them all or a named failure — never a partial panel.
- [x] Runs are made a few at a time; the number in flight is bounded, not all N at once.
- [x] Each run is saved to its own file the moment it finishes, so a crash loses only runs in flight.
- [x] A relaunch reads the runs already saved and makes only the missing ones.
- [x] A reply that is empty, not JSON, or the wrong shape is sent again after a pause that grows with each attempt, up to 3 sends. After the third failure the stage fails with a named error naming the run and the last cause.
- [x] Cost from every send, failed sends included, is added into the stage's cost.
- [x] A saved run file that cannot be read on relaunch is a named error, not silently remade.
- [x] Proven by tests on a stand-in stage: all runs succeed; one run fails twice then succeeds; one run fails three times and the stage fails; a relaunch after some runs were saved makes only the rest; the number in flight never exceeds the bound.
- [x] The existing single-call stages behave exactly as before.
