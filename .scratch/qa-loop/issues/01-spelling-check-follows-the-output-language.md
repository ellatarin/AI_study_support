# 01 — The spelling check follows the output language

**What to build:** a decision first. The QA loop's deficiency type for spelling, punctuation and idiom is named `british-english`. The config lets the notes be written in American English (`finalOutput.language: "en-US"`). With that setting, the prompts tell the model to write American English. The checker would then look for British English.

Options to decide between:

- Give the deficiency type a name that does not name a language, such as `spelling`, and tell the checker which language to expect from `finalOutput.language`.
- Keep `british-english` and remove `en-US` from the languages that the config allows.

**Blocked by:** the QA loop is not built.

**Status:** needs-triage

Found in comment-rewrite ticket 03. See `.scratch/comment-rewrite/divergences.md`, D14.
