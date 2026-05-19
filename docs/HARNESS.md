# OpenPi Goal System

Session-level objective + plan management for the Pi coding agent.

## Architecture

The goal system runs as a Pi extension (`.pi/extensions/harness/index.ts`) and integrates with OpenPi's Electron main process via a shared JSON file.

### Extension Layer (Pi SDK)

- **5 LLM tools**: `get_goal`, `create_goal`, `update_goal`, `clear_goal`, `update_plan`
- **Context injection**: `<goal_context>`, `<budget_limit>`, `<objective_updated>` fragments
- **Ephemeral plan state**: `update_plan` tracks the current short-lived execution plan only
- **Plan approval**: `<proposed_plan>` streaming detection + overlay
- **`/goal` slash command**: set, edit, pause, resume, clear, budget

### Electron Main Layer

- **Goal file watcher**: polls `.openpi-goal.json`, forwards to renderer via IPC
- **GoalStatusIndicator**: compact footer badge in BottomBar

## User Commands

| Command | Action |
|---|---|
| `/goal <objective>` | Set a new active goal |
| `/goal` | Show current goal summary |
| `/goal edit` | Edit goal objective inline |
| `/goal pause` | Pause active goal |
| `/goal resume` | Resume paused goal |
| `/goal clear` | Clear the goal and ephemeral plan |
| `/goal budget N` | Set token budget |

## Agent Tools

| Tool | Description |
|---|---|
| `get_goal` | Read current goal status + remaining budget |
| `create_goal` | Create new goal (fails if one exists) |
| `update_goal` | Mark goal complete |
| `clear_goal` | Clear current goal and ephemeral plan |
| `update_plan` | Track the current ephemeral execution plan with steps |

## Plan vs Tasks

`update_plan` is intentionally **not** a task manager. It is the current agent execution plan: short-lived, overwritten freely, no IDs, no dependencies, no ownership, no subagent execution.

Durable work belongs to `@tintinweb/pi-tasks`: use `TaskCreate`, `TaskUpdate`, and `TaskExecute` for tracked tasks, dependency graphs, ownership, and subagent-backed execution.

## Goal Lifecycle

```
No Goal ── /goal "do X" ──→ Active ── /goal pause ──→ Paused
                               │                          │
                               │                     /goal resume
                               │                          │
                          budget exceeded            Active
                               │
                               ▼
                        BudgetLimited ── /goal clear ──→ Complete
```

## Session Persistence

Goal state is persisted to the session JSONL via `pi.appendEntry("goal_set", ...)`. On resume or fork, the extension restores the goal from session entries.
