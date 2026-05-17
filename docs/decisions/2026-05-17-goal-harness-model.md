# Decision: Goal/Harness Model Replaces Waterfall Specs

Status: accepted
Date: 2026-05-17

## Context

The original `.pi/extensions/harness` extension provided waterfall-style spec phases (`spec_create` → `spec_next_phase` → `spec_run_task`) modeled after Pi's built-in spec workflow. This approach had several problems:

1. Specs lived in `.pi/specs/` — invisible to the user and disconnected from the repo.
2. The waterfall phases (`requirements-first`, `design-first`, `quick-plan`) encouraged sequential handoffs rather than iterative building.
3. There was no durable product truth outside the spec state — no stories, no decisions, no test matrix.
4. OpenAI/Codex research showed `/goal` is the correct public surface for long-running work, not `/specs`.

## Decision

Adopt a goal/harness model:

- **`/goal`** is the single public controller command, inspired by Codex's `/goal` semantics (Codex issues #20536/#22049, `codex-rs/tui/src/slash_command.rs`).
- **Harness v2 tools** (`harness_status`, `harness_intake`, `harness_init`, `harness_lint`, `story_create`, `decision_record`, `test_matrix_update`) are the primary interface for repo-local durable work.
- **Legacy `spec_*` adapters** remain callable for compatibility with existing `.pi/specs` state but are not part of the default goal loop.
- **Repo-local `docs/`** (HARNESS.md, FEATURE_INTAKE.md, TEST_MATRIX.md, product/, stories/, decisions/, templates/) is the durable product truth.

## Consequences

- Users have one command (`/goal`) instead of juggling `/specs-create`, `/specs-list`, `/specs-delete`, etc.
- Product knowledge survives session resets because it lives in `docs/`, not ephemeral spec state.
- Legacy `.pi/specs` entries can be migrated to docs/stories via `story_create` or manual conversion.
- The extension directory is still named `specs/` — should be renamed to `harness/` in a future cleanup pass.
- Existing `.pi/specs` state is backward-compatible via the legacy adapter tools.
