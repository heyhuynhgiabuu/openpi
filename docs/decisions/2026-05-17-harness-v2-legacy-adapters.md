# Decision: Harness v2 with Legacy Adapters, Not Destructive Migration

Status: accepted
Date: 2026-05-17

## Context

After building harness v2 tools (`harness_status`, `harness_intake`, `harness_init`, `harness_lint`), the question was whether to:

1. Delete `spec_*` adapters immediately and force-migrate all state.
2. Keep `spec_*` as callable legacy adapters indefinitely.
3. Keep `spec_*` adapters but strip them from all guidance/documentation, making them opt-in compatibility-only.

## Decision

Option 3: Keep `spec_*` callable but invisible from the default `/goal` loop.

Rationale:
- Active `.pi/specs` state may exist in user projects — breaking it without migration is hostile.
- Old conversation transcripts reference `spec_*` tool names — deleting them would break rendering.
- The harness v2 tools (`story_create`, `decision_record`, `test_matrix_update`) provide the durable alternative, but legacy adapters cost nothing to keep.
- V2 tools are not yet complete — we need `story_create`, `decision_record`, `test_matrix_update` before anyone can fully migrate off `spec_*`. Now they exist.

## Consequences

- `/goal` guidance never names `spec_next_phase` or `spec_run_all`.
- `spec_*` tool metadata says "Legacy compatibility adapter" and points users at harness v2 alternatives.
- Renderer labels `spec_*` as `legacy` in tool cards.
- Future deletion of `spec_*` should wait until: 1) active `.pi/specs` state is migrated, 2) no guidance references them, 3) old transcripts are archived.
