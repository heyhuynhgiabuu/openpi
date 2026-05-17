# Story: File Editor Improvements — format, word wrap, editing UX

Status: planned

## Product Contract

Make the FilePreviewPane editor feel polished: format-on-save with Biome, word wrap toggle, and better editing interface

## Relevant Product Docs

- docs/product/: TBD

## Acceptance Criteria

- Format-on-save toggle in the top bar formats the file with `biome format --write` after each save, updating the displayed content to the formatted version
- Format button runs `biome format --write` on the current file without saving
- Word wrap toggle switches between wrapping and no-wrap mode in the editor textarea
- Format feedback shows formatting status (formatting.../formatted/error)
- Toggle states persist within the session for each file
- Keyboard shortcut for format (Cmd+Shift+F) works
- All existing save/find/replace/edit functionality remains intact
- Editor properly handles large files (>1MB) without formatting

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
