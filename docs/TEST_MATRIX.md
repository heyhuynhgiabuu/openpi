# OpenPi Test Matrix

Map product behavior to proof. Statuses: `planned`, `in_progress`, `implemented`, `changed`, `retired`.

| Area | Behavior | Status | Evidence | Notes |
|---|---|---|---|---|
| Goal | Goal/harness loop is discoverable via `/goal` | implemented | `registerCommand('goal')` in extension | |
| Goal | `/goal <text>` sets active goal | implemented | Extension `/goal` handler | |
| Goal | `/goal` bare shows summary widget | implemented | `showGoalWidget()` via `ctx.ui.setWidget` | |
| Goal | `/goal edit` opens inline input | implemented | `ctx.ui.input()` in extension | |
| Goal | `/goal pause` pauses active goal | implemented | Status transition `active→paused` | |
| Goal | `/goal resume` resumes paused goal | implemented | Status transition `paused→active` | |
| Goal | `/goal clear` marks complete | implemented | Status transition → `complete` | |
| Goal | `/goal budget N` sets token budget | implemented | Auto `budget_limited` when exceeded | |
| Goal | `get_goal` LLM tool returns goal status | implemented | `registerTool('get_goal')` | |
| Goal | `create_goal` LLM tool creates goal | implemented | `registerTool('create_goal')`, fails if exists | |
| Goal | `update_goal` LLM tool marks complete | implemented | `registerTool('update_goal')`, status=complete only | |
| Goal | `update_plan` LLM tool tracks steps | implemented | `registerTool('update_plan')`, step statuses | |
| Goal | Context injection: `<goal_context>` | implemented | `on('context')` handler | |
| Goal | Context injection: `<budget_limit>` | implemented | Single-shot when budget exceeded | |
| Goal | Context injection: `<objective_updated>` | implemented | Detects objective edits | |
| Goal | Token tracking via turn accounting | implemented | `turn_end` + `agent_end` events | |
| Goal | Time tracking via turn timing | implemented | `turn_start` − `turn_end` delta | |
| Goal | Budget enforcement auto-transitions | implemented | `tokensUsed >= tokenBudget` → `budget_limited` | |
| Goal | Goal persists across session resume | implemented | `pi.appendEntry('goal_set')` + restore from entries | |
| Goal | `<proposed_plan>` streaming detection | implemented | `extractProposedPlan` parser | |
| Goal | Plan approval overlay | implemented | `ctx.ui.custom()` with Yes/Clear/No | |
| Goal | Goal status footer indicator (Pi TUI) | implemented | `ctx.ui.setStatus('goal', ...)` | |
| Goal | Goal state file for OpenPi Electron | implemented | `.openpi-goal.json` written by extension | |
| Goal | OpenPi GoalStatusIndicator in BottomBar | implemented | Goal dot + label in BottomBar.tsx | |
| Goal | Goal state IPC: `electron/main.ts` polls file | implemented | `checkGoalFile()` timer | |
| Goal | Goal state IPC: `preload.ts` exposes `onGoalUpdate` | implemented | `IPC.GOAL_UPDATE` channel | |
| Goal | Goal state IPC: `useOpenPiSession` exposes `goalUpdate` | implemented | Signal + getter | |
| Tool Cards | `get_goal` tool card renders | implemented | `harnessActionForTool` in ToolCardView.tsx | |
| Tool Cards | `create_goal` tool card renders | implemented | `harnessActionForTool` in ToolCardView.tsx | |
| Tool Cards | `update_goal` tool card renders | implemented | `harnessActionForTool` in ToolCardView.tsx | |
| Tool Cards | `update_plan` tool card renders | implemented | `harnessActionForTool` in ToolCardView.tsx | |
| Composer | `/goal` slash command is surfaced | implemented | Slash commands in Composer.tsx | |
| Extension | Extension typechecks with bundler resolution | implemented | CI verification command | |
| Tests | IPC Zod schemas roundtrip correctly | implemented | `tests/ipcRoundtrip.test.ts` | 56 tests |
| Tests | PTY host lifecycle (create/resize/close) | implemented | `tests/ptyHost.test.ts` | 8 tests |
| Tests | Session index SQLite upsert and query | implemented | `tests/sessionIndex.test.ts` | 7 tests |
| Tests | Permission gates block sensitive paths | implemented | `tests/protectedPaths.test.ts` | 13 tests |
| Tests | Session events compaction rendering | implemented | `tests/sessionEvents.test.ts` | 3 tests |
| Tests | Git host file tree and status | implemented | `tests/gitHostFileTree.test.ts` | 17 tests |
| Tests | Secret redaction on paths | implemented | `tests/secretRedact.test.ts` | 10 tests |
| Tests | Session prompt parsing | implemented | `tests/sessionPrompt.test.ts` | 7 tests |
