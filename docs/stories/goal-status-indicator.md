# Story: Goal Status Indicator

Status: implemented

## Product Contract

Users need a persistent way to see the current active goal and loop step without scrolling up through the conversation. The `/goal` command sets context but that context is invisible once the agent responds.

## Relevant Product Docs

- docs/product/GOAL_HARNESS.md
- docs/decisions/2026-05-17-goal-harness-model.md

## Acceptance Criteria

1. When a goal is active, a subtle banner/badge appears in the composer header area showing the current objective text (truncated if long).
2. The banner shows which loop step the agent is on: `inspecting`, `classifying`, `acting`, `verifying`, or `idle`.
3. The banner is dismissible (click to hide until next `/goal`).
4. When no goal is active, no banner is shown.
5. `running` state and `idle` state are visually distinct.
6. Token cost / elapsed time for the current goal is optionally shown on hover.

## Design Notes

- Keep it minimal — one line, subtle color, no modals.
- This is a renderer-only change: the session event stream already has enough information (agent_start/agent_end, turn_start/turn_end, tool_execution_start/end) to derive loop state.
- Goal text comes from the `/goal` expansion — the sidecar could store the active intent and expose it via IPC.
- Consider using a SolidJS signal derived from the session store, not a new IPC channel.

## Validation

| Check | Command / Evidence | Status |
|---|---|---|
| Banner appears after `/goal` | Dev build, run `/goal fix login`, see banner | planned |
| Banner shows correct objective | `/goal fix login` shows "fix login" | planned |
| Loop step updates in real time | Observe step changes during agent execution | planned |
| Banner dismissible | Click dismiss, banner hides, session continues | planned |
| No banner when idle | Fresh session, no `/goal` set → no banner | planned |
| TypeScript clean | `npx tsc --noEmit` | planned |

## Harness Delta

- Create or update `docs/product/GOAL_HARNESS.md` with goal UI details.
- Update `docs/TEST_MATRIX.md` with goal status rows.
