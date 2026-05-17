# Decision: History graph + branch picker implementation approach

Status: accepted
Date: 2026-05-17

## Context

The GitPanel has a History tab with commit list rendering raw ASCII graph lanes from `git log --graph`, a `getGitHistory` backend, and a `RefsPickerPanel` branch/stash picker. The roadmap calls for a proper visual commit graph with rendered lanes (colored dots, connection lines), branch/remote label badges, commit→diff viewer integration, Open on GitHub, and enhanced branch picker (create branch, stash apply/pop/drop).

## Decision

Implement in three independent slices: (1) SVG commit graph renderer replacing the raw `<pre>` ASCII display with proper lane rendering ─ using SOH (\x01) delimiter to avoid | ambiguity, structured graphRows data model, and SVG lane rendering with colored dots. (2) Commit-detail enhancements: add GET_COMMIT_DIFF IPC, wire file-click in GitHistoryDetailsPane to DiffViewer, add Open on GitHub. (3) Branch picker enhancements: add CREATE_BRANCH and stash-manipulation IPC handlers, wire into RefsPickerPanel.

## Consequences

(+) Slice 1 implemented with SVG rendering replacing raw ASCII <pre> display. Backend switched to \x01 delimiter with structured graphRows data. Ref badges parsed from %D format with type-specific styling (HEAD, branch, remote, tag). Typecheck, lint, and all 68 tests pass. (-) Slice 2 and 3 remain for future work. (-) SVG rendering may need tuning for dense graphs with many columns.

## Evidence

- Recorded through decision_record.
