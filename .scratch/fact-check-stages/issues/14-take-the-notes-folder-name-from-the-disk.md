# 14 — Take the name of the notes folder from the disk, not from the manifest

**Status:** ready-for-agent

**Blocked by:** none

**The problem:** three places name the lecture's folder in `Final output/` from `manifest.baseName`:

1. A reset from any stage deletes `Final output/<baseName>` with everything in it.
2. `build-notes-page` deletes the same folder before it writes the page again.
3. `build-notes-page` is complete when `Final output/<baseName>/notes.html` exists.

The manifest reader does not check `baseName`. `filenameSafe` runs only when the pipeline makes a base name from a title. `resolveManifestPath` checks only the recorded files of a completed stage, and it deletes nothing. So a hand-edited manifest with `baseName` set to `../..` makes a reset delete a folder above the module folder.

Technical design §4.4 says that a reset uses no path from the manifest, and that a damaged manifest cannot delete files outside the module. Places 1 and 2 break that rule.

**What the user agreed (2026-10-15):** take the name from the disk.

- Delete (places 1 and 2): find the notes folder by the lecture date, as `delete` does with `removeLectureFileByDate`. The name then comes from a folder listing.
- Write and the completion check (places 2 and 3): use the name of the workspace folder. The workspace folder has the lecture's base name, and the runner gets its path from a listing of `Pipeline processing/`.

Then §4.4 is true again and needs no change.

## Tests, in this order

- [ ] A reset from `build-notes-page`, with a manifest whose `baseName` is `../..`, deletes nothing outside `Final output/`. It deletes the notes folder that carries the lecture date.
- [ ] `build-notes-page`, with the same manifest, writes the notes into the folder with the workspace folder's name, and deletes nothing outside `Final output/`.
- [ ] The completion check of `build-notes-page` looks for `notes.html` under the workspace folder's name, not under the manifest's `baseName`.

A test that can delete outside the folder under test must stay inside a temporary folder. The `../..` must point to a folder inside that temporary folder.

## Comments
