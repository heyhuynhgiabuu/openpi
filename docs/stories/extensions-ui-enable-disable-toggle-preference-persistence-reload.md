# Story: Extensions UI — enable/disable toggle, preference persistence, reload

Status: planned

## Product Contract

Add enable/disable toggle to extension cards in the customizations panel, persist preferences, and add reload button

## Relevant Product Docs

- docs/product/: TBD

## Acceptance Criteria

- Extension cards show a toggle switch instead of static Active/Inactive status chip
- Toggling an extension saves the preference via IPC and updates the UI immediately
- Preferences persist across app restarts (stored in ~/.pi/agent/openpi-extension-preferences.json)
- Toggle changes show a 'restart session to apply' hint on the card
- Reload extensions button requests Pi session restart
- All verification: tsc --noEmit, biome check pass

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
