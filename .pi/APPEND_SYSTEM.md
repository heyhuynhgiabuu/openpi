# OpenPi — Additive System Instructions

These instructions are appended to Pi's default system prompt for the OpenPi project.

## Pi Documentation Sources

Pi provides its own documentation for SDK, extensions, themes, skills, and TUI. Read these before implementing anything Pi-related — they are the authoritative reference.

| Topic | Source |
|---|---|
| SDK API, session management, tools | `pi-coding-agent/README.md` |
| SDK internals, RPC, session format, extensions | `pi-coding-agent/docs/` |
| Extension examples (subagent, tool registration) | `pi-coding-agent/examples/extensions/` |
| Extensions API | `pi-coding-agent/docs/extensions.md` + `examples/extensions/` |
| Themes | `pi-coding-agent/docs/themes.md` |
| Skills | `pi-coding-agent/docs/skills.md` |
| Prompt templates | `pi-coding-agent/docs/prompt-templates.md` |
| TUI components | `pi-coding-agent/docs/tui.md` |
| Keybindings | `pi-coding-agent/docs/keybindings.md` |

Always read `.md` files completely and follow links to related docs before implementing. Do not guess Pi SDK APIs, extension patterns, or theme formats from memory.

## Verification Before Completion

Before claiming any work complete:

- Run `npm run typecheck` — zero errors
- Run `npm run lint` — zero warnings
- Run targeted tests for the changed surface
- Electron smoke launch when changing main/preload
- If you create or modify a test file, run it and iterate until it passes
- For IPC changes: verify Zod schemas parse correctly in both directions

## Code Quality

Read `AGENTS.md` in full — it is the complete project rule surface. The Development Principles, TypeScript quality rules, editing rules, and non-negotiable boundaries there are mandatory.

## OpenPi Subagent System

OpenPi provides built-in subagents as three Pi SDK `customTools` registered on the sidecar session, NOT as Pi extensions:

| Tool | Purpose |
|---|---|
| `Agent` | Launch a subagent (foreground for immediate result, `run_in_background` for async). Params: `prompt`, `description`, `subagent_type`, `model`, `thinking`, `max_turns`, `run_in_background`, `resume` |
| `get_subagent_result` | Poll or wait for a background agent's output. Params: `agent_id`, `wait`, `verbose` |
| `steer_subagent` | Send a steering message to a running subagent. Params: `agent_id`, `message` |

Tool description tells Pi to delegate when it sees `@agent_name` patterns in the user's prompt (e.g. `@explorer find API routes`).

### Built-in agent types

| Agent | Role | Tools | Extensions |
|---|---|---|---|
| `worker` | Surgical implementer (1-3 files) | Pi defaults | Blocked |
| `explorer` | Read-only codebase cartographer | read/grep/find/ls/bash + srcwalk_* | Allowed |
| `scout` | External research specialist | read/grep/find/ls/bash + pi-search + webclaw + limited srcwalk | Allowed |
| `planner` | Architecture & implementation plans | read/grep/find/ls/bash + srcwalk_* | Allowed |
| `reviewer` | Code review & debugging | read/grep/find/ls/bash + srcwalk_* | Allowed |

Each subagent runs as an in-memory Pi SDK session (`SessionManager.inMemory`) with its own model, tools, settings, and resource loader — no nested Pi CLI, no child session files on disk.

### Custom agents via `.pi/agents/*.md`

Define custom agent types in:
- `~/.pi/agent/agents/<name>.md` (global, available in every workspace)  
- `<cwd>/.pi/agents/<name>.md` (project-specific, requires workspace trust)

Frontmatter fields:

| Field | Type | Description |
|---|---|---|
| `display_name` | string | Human-readable label |
| `description` | string | Shown in tool schema |
| `tools` | `[string]` | Explicit tool allowlist (blocks all others) |
| `disallowed_tools` | `[string]` | Blocklist (applied after allowlist) |
| `model` | string | Default model (`provider/modelId`) |
| `thinking` | string | `off` \| `minimal` \| `low` \| `medium` \| `high` \| `xhigh` |
| `max_turns` | number | Abort after N turns |
| `prompt_mode` | `replace` \| `append` | How the prompt body is used |
| `isolated` | boolean | Block all extension tools |
| `enabled` | boolean | Flag to disable without deleting |

Priority: project > global > builtin. Disabled agents (`enabled: false`) are filtered out.

### Architecture

- **Sidecar** (`electron/openPiSubagents.ts`): `SubagentManager` with queue, concurrency (max 4), lifecycle events streamed to renderer via `onSubagentUpdate` callback. SDK sessions created with `createAgentSession({ sessionManager: SessionManager.inMemory(cwd), ... })`.
- **Renderer** (`src/lib/extensionTrackers.ts`): `SubagentTracker` consumes `openpi_subagent_update` events from sidecar. `onSubagentUpdate` is the authority for background agent status (not `onToolEnd`, which only sets `agentId` for matching).
- **Widget** (`src/components/SubagentWidget.tsx`): Live elapsed timer, expandable details, status icons (⠹/✓/✗/…), completion notification banner with 8s auto-dismiss.
- **Composer** (`src/components/Composer.tsx`): `@` mention picker shows subagents + files with Bot icon, capital-case names, keyboard navigation. Selecting inserts `@name` text invisibly on send.

### What NOT to do

- Do not import `@earendil-works/pi-coding-agent` in the renderer to use subagent APIs.
- Do not fork Pi's agent runtime — the SDK provides everything needed.
- Do not implement permission gates or result injection at the Pi layer — these belong in Electron main IPC handlers.
- Do not reuse Pi session files for subagent sessions — always use `SessionManager.inMemory`.
