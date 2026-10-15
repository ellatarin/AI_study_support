# 01 — Override the three config switches from the command line

**Status:** needs-triage

**Blocked by:** none

**The problem:** the three switches of 2026-10-14 are in `pipeline-config.json` only:

- `stages.correct-factual-errors.bypass`
- `finalOutput.pageViews`
- `finalOutput.highlightSlideSentences`

To change one switch for one run, the user must edit the config file and then edit it back. On 2026-10-15 the user wanted a Cell Biology lecture 4 run with the fact correction on, and a page with all four views. Their config has the bypass on and two views.

**What the user agreed (2026-10-15):** `run` gets three flags. Each flag overrides its config value for this run only. The config file does not change. With no flag, the config value applies.

| Flag | Values | Overrides |
|---|---|---|
| `--fact-correction` | `run` or `bypass` | `stages.correct-factual-errors.bypass` |
| `--page-views` | a list with commas, such as `notes,transcript`, or `all` | `finalOutput.pageViews` |
| `--highlight-slide-sentences` | `on` or `off` | `finalOutput.highlightSlideSentences` |

- `--page-views` uses the view names of `finalOutput.pageViews`, with the same checks. The list must include `notes`. `all` means all four views. `all` cannot be in a list with names.
- A flag with an unknown value is a usage error. The error names the values that the flag accepts.
- A flag changes only the stages that run. A complete stage does not run again because of a flag. This is the same as `--concurrency`. To rebuild a page, the user adds `--from-stage build-notes-page`. To run the fact correction again, the user adds `--from-stage correct-factual-errors`, and the reset question applies as usual.
- The run log records the value that each stage used. `correct-factual-errors` records `bypass` already. `build-notes-page` records no config today. It is to record its page views and its highlight switch.

**To agree before the code:** the keys in the run log of `build-notes-page`. The proposal is `configUsed: { "pageViews": [...], "highlightSlideSentences": true }`, with the names of the config keys.

- [ ] The usage text lists the three flags of `run`.
- [ ] Each flag overrides its config value for one run, and the config file does not change.
- [ ] A bad value of each flag is a usage error that names the accepted values.
- [ ] `--page-views all` gives all four views. A list without `notes` is an error.
- [ ] The run log of `build-notes-page` records the page views and the highlight switch.
- [ ] The technical design and the requirements describe the three flags.

## Comments
