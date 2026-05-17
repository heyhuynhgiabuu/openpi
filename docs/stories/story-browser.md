# Story: Story Browser

Status: implemented

## Product Contract

Browse docs/stories/ from a dedicated sidebar panel with status badges, search, and click-to-preview.

## Relevant Product Docs

- docs/product/: TBD

## Acceptance Criteria

- Left drawer shows Stories panel when stories mode is toggled from BottomBar
- Lists all .md files from docs/stories/ directory
- Parses frontmatter for title and status badge
- Status badges: planned (muted), in_progress (yellow), implemented (green), changed (blue), retired (red)
- Clicking a story opens it in the file preview pane
- Empty state when no stories exist

## Design Notes

- TBD

## Validation

| Check | Command / Evidence | Status |
| --- | --- | --- |
| Story validation | npm run lint && npx tsc --noEmit | planned |

## Harness Delta

- Story packet created through story_create.

## Evidence

- Pending implementation evidence.
