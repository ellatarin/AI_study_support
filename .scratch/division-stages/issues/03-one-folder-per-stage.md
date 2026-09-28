# 03 — One folder per stage

**What to build:** every existing stage's code, prompt files, readable-view code and tests move into a folder of their own, so a stage made of several source files — as the four new ones will be — has a place to keep them. Behaviour does not change: a pipeline run produces exactly what it did before.

**Blocked by:** 02 — both touch every stage file, so the renaming lands first and this commit is a pure move: file locations and import paths only.

**Status:** resolved

- [x] Each existing stage lives in its own folder, following the layout ticket 01 wrote down; shared stage machinery (the stage factory, the shared model-call code) has one home the stage folders reach.
- [x] No barrel files are introduced.
- [x] The architectural lint rules still hold, and are updated wherever they name old paths.
- [x] Every existing test passes unchanged in what it asserts; only import paths move.
- [x] Docs that name a moved file are updated in the same commit.
- [x] The full gate (Biome, ESLint, tsc, tests, jscpd) passes.
