# Story: Terminal tabs polish — rename, exit indicators, UX

Status: planned

## Product Contract

Polish the existing multi-terminal tabs: tab rename, process exit indicator, better UX. The tab infrastructure (add/close/switch) already works.

## Relevant Product Docs

- docs/product/: TBD

## Acceptance Criteria

- Tab shows the shell type (zsh/bash) and working directory basename as label
- Clicking a tab switches to that terminal
- Each terminal maintains its own PTY lifecycle — closing a tab kills the process
- Process exit indicator (green/red dot) on each tab
- Double-click a tab label to rename it inline
- New terminal via + button or ⌘J
- Terminal output still renders correctly when switching tabs (ResizeObserver handles re-fit)

## Design Notes

- TBD

## Validation

| Check | Command / Evidence | Status |
| --- | --- | --- |
| Story validation | TBD | planned |

## Harness Delta

- Story packet created through story_create.

## Evidence

- Pending implementation evidence.
