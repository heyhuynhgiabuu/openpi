# Story: History graph + branch picker

Status: in_progress

## Product Contract

Surface a visual Git history graph with interactive branch picker in the GitPanel, so users can navigate commits visually, switch branches, see commit details with file diffs, and open commits on GitHub — replacing the current ASCII graph rendering with proper visual lane rendering.

## Relevant Product Docs

- docs/product/: TBD

## Acceptance Criteria

- Visual commit graph renders proper graph lanes (colored dots for commits, vertical/horizontal connecting lines) instead of raw ASCII `<pre>` output
- Branch/remote label badges parsed from `%d` refs format displayed on commits (e.g. `main`, `origin/main`, `HEAD -> main`) with distinct styling per type
- Commit details pane shows full author, date, message, changed files with +N -N stats, and SHA (copyable)
- Clicking a changed file in commit details loads the diff for that commit and opens it in the DiffViewer (new GET_COMMIT_DIFF IPC or reuse existing)
- Open on GitHub button in commit details when remote origin URL is detected and is github.com
- Branch picker (RefsPickerPanel) supports create-branch action and stash apply/pop/drop
- History search filters commits by hash, message, author, or refs
- npm run typecheck && npm run lint pass zero errors

## Design Notes

- TBD

## Validation

| Check | Command / Evidence | Status |
| --- | --- | --- |
| Story validation | npm run typecheck && npm run lint. Visual verification on a repo with branches, multiple committers, and a non-linear history. | planned |

## Harness Delta

- Story packet created through story_create.

## Evidence

- Pending implementation evidence.
