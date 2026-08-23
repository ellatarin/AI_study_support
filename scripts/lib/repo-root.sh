# shellcheck shell=bash
#
# Sets `repo_root` to this repository's root.
#
# Resolved from this file's own location, so it holds however the sourcing script
# was invoked and whatever the working directory is — a script deriving it from
# the cwd instead is dead the moment the cwd is not the repo root.
#
# Sourced rather than repeated: `cd "$(dirname …)" && pwd` was written out in
# every bash script here, each with its own count of `..` to get right, and a
# script moved between directories would go on resolving somewhere plausible
# rather than failing. A caller now states only where this library is, which is
# a fact about that caller; how the root is derived is stated here.
#
# The node hooks have the same thing in scripts/hooks/lib/repo-root.mjs.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
