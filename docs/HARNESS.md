# OpenPi Harness

Goal/harness loop: **human intent → intake → story packet → agent loop → product delta → validation proof → harness delta → next intent**

OpenPi is a desktop workbench for the Pi coding agent (`@earendil-works/pi-coding-agent`). This harness documents how we build it.

## Operating Rules

- **Repo-local docs are durable product truth.** Conversations, specs, and tickets are ephemeral inputs; `docs/` is canonical.
- **Legacy `.pi/specs` entries are compatibility execution state only** — they exist for old waterfall flows, not as a planning source.
- **Every meaningful change produces a harness delta:** identify affected product docs, create/update a story packet, record decisions, and update the test matrix.
- **Prefer one safe action at a time:** inspect → classify → act → verify → report next `/goal`.
- **The `/goal` command is the public controller surface.** It routes to `harness_status`, `harness_intake`, `harness_init`, `harness_lint`, `story_create`, `decision_record`, and `test_matrix_update`.

## Tool Taxonomy

| Layer | Tools | Owner |
|---|---|---|
| Inspection | `harness_status`, `harness_lint` | Pi extension |
| Classification | `harness_intake` | Pi extension |
| Scaffolding | `harness_init` | Pi extension |
| Artifact creation | `story_create`, `decision_record`, `test_matrix_update` | Pi extension |
| Legacy compatibility | `spec_create`, `spec_next_phase`, `spec_run_task`, `spec_run_all`, `spec_status`, `spec_analyze`, `spec_sync_tasks` | Pi extension (adapter) |
| Controller | `/goal` command | Pi extension + sidecar |

## Process Model

1. User has an intent (feature, bugfix, question, etc.).
2. Run `/goal <intent>` — sidecar expands into the goal-harness controller prompt.
3. Agent inspects with `harness_status`, classifies with `harness_intake`.
4. Agent chooses one safe action: scaffold docs with `harness_init`, create a story with `story_create`, record a decision with `decision_record`, update the test matrix, write product docs, or execute legacy compatibility via `spec_run_task`.
5. After execution, agent verifies with `harness_lint` or `harness_status`.
6. Agent reports concise status + next suggested `/goal` intent.
