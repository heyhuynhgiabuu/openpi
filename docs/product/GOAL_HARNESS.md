# Goal/Harness System

## Public Surface

- **`/goal`** slash command in the Composer — the one entry point.
- **Goal/Harness Loop** palette command (`⌘P`) — same as `/goal `.

## How It Works

1. User types `/goal <intent>` or clicks the palette entry.
2. Electron main sidecar (`electron/piSidecar.ts`) intercepts it via `expandGoalCommand` and expands into a structured controller prompt (`buildGoalHarnessPrompt`).
3. The prompt is queued as a steer message to Pi's agent session.
4. Pi's agent reads the prompt and uses the harness v2 extension tools from `.pi/extensions/harness/index.ts`:

   | Step | Tool | Purpose |
   |---|---|---|
   | Inspect | `harness_status` | Current docs, legacy specs, directories |
   | Classify | `harness_intake` | Intent type, risk, missing inputs |
   | Act | `harness_init` / `story_create` / `decision_record` / `test_matrix_update` / legacy `spec_*` | One safe step |
   | Verify | `harness_lint` / `harness_status` | Check for gaps |

5. Agent reports concise status with current evidence + next suggested `/goal`.

## Tool Ownership

- All harness tools live in `.pi/extensions/harness/index.ts` (the directory was renamed from `specs` to `harness` — the extension implements harness v2 tools with legacy spec adapters).
- Legacy `spec_*` tools remain callable for old `.pi/specs` state but are not part of the default `/goal` loop.
- The renderer never imports or invokes these tools directly — it only displays their output via tool cards.

## Stories

| Story | Status | File |
|---|---|---|
| Goal Status Indicator | implemented | docs/stories/goal-status-indicator.md |
| Story Browser | implemented | docs/stories/story-browser.md |
| Harness Lint Pre-commit Hook | implemented | docs/harness-lint-precommit.md |

## Key Constraints

- One safe action per `/goal` turn.
- Repo-local `docs/` is durable truth — tools write files, not SQLite or extension state.
- Never `spec_run_all` from `/goal` — requires explicit user request outside the loop.
