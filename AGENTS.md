# OpenPi Project Rules

**Purpose:** Operating rules for building OpenPi: a desktop workbench for the Pi coding agent.
**Audience:** human developers and AI coding agents.
**Related surfaces:** `ROADMAP.md` (philosophy, phases, non-goals), `STATUS.md` (current status), `node_modules/@earendil-works/pi-coding-agent/` (installed SDK; canonical docs table below).

---

## Product Direction

OpenPi is a **local-first desktop workbench** for [Pi](https://pi.dev) (`@earendil-works/pi-coding-agent`, upstream [earendil-works/pi](https://github.com/earendil-works/pi) by Mario Zechner). Electron main hosts the MIT agent and renders sessions, tools, Git, editor, and terminal. OpenPi is a workbench, not an agent runtime and not a full IDE.

**Direction (owner decision 2026-10-27, [#33](https://github.com/heyhuynhgiabuu/openpi/issues/33)):** the agent runtime migrates to `@earendil-works/pi-durable` (first-party, ROADMAP Phase 8), then staged remote surfaces ship: SSH + a PWA mobile **client**, read-only → approvals → prompt (Phase 9). The phone is an untrusted client — never the host, never runs the agent. Security requirements in `docs/decisions/2026-09-13-remote-access-deferred.md` stay binding; sequencing in `docs/decisions/2026-10-27-durable-runtime-remote-surfaces.md`.

Pi is intentionally **minimal** (small prompt, four core tools, YOLO by default). Plan mode, todos, permission gates, and sub-agents stay out of core — they belong in user extensions. MCP, codemode, and tool-search are built-in extensions: surface them through the SDK, never reimplement or wrap them. OpenPi adds **inspectability** (UI, tokens, Git/diff) and **optional desktop policy** (protected paths, high-risk confirms in main). Treat the **human as the quality gate**.

**Delegation:** use the `@heyhuynhgiabuu/pi-task` package. OpenPi registers no built-in `Agent` customTools; `.pi/extensions/openpi-task-guard.ts` strips invalid IDs. `task_id` must be a pi-task-generated short ID; `conversation_id` may be any caller-chosen name. Full UUIDs are rejected as `task_id`.

Target UX: sessions sidebar (workspace-grouped, token/cost) + conversation (steer/follow-up/abort, tool cards) + customizations modal + Git panel + split diff + terminal + command palette (`⇧⌘P`).

---

## Stack

| Layer | Choice |
|---|---|
| Shell | Electron + electron-vite + electron-builder |
| Renderer | SolidJS + TypeScript + Vite |
| Styling | Tailwind CSS + Kobalte-style primitives + Lucide Icons |
| State | Solid signals/memos + Electron-main read models |
| Validation | Zod at every IPC/JSON boundary |
| Terminal | xterm.js + node-pty in Electron main |
| Diff renderer | @pierre/diffs (replaceable renderer only) |
| Pi integration (current) | @earendil-works/pi-coding-agent SDK in Electron main |
| Pi integration (Phase 8 target) | @earendil-works/pi-durable Harness behind adapter modules, pinned exact version |
| Persistence | SQLite via better-sqlite3 in Electron main |
| Secrets | OS keychain via Electron safeStorage |

---

## Process Model and Authority

**Renderer is not authority.** It renders state and collects intent only: no filesystem, shell, processes, patches, Git mutations, SQLite, secrets, or Pi imports.

**Electron main owns desktop authority:** app/window lifecycle, secure IPC (sender validation), the Pi session host, PTY lifecycle, permission gates before any mutation-capable action, **all Git operations** (via `simple-git`/`child_process` — never via Pi tools or renderer code), SQLite read models, secret storage.

**Pi owns agent semantics:** model/provider registry, tool execution, session tree (JSONL v3), compaction, extensions/skills/prompts/themes/packages, message queue semantics, the event stream. OpenPi observes events and commands the SDK — it never reimplements these.

**Session replacement:** use `AgentSessionRuntime` (`createAgentSessionRuntime`), not `AgentSession` directly, for new/resume/fork/clone. Re-subscribe to `AgentSessionEvent` after every replacement — subscriptions attach to a specific instance.

**RPC subprocess** (`--mode rpc`, strict JSONL over stdin/stdout) only when process isolation is explicitly required. Split records on `\n` only — never Node `readline` (it also splits on Unicode separators inside JSON).

### Target runtime (Phase 8): pi-durable

`@earendil-works/pi-durable` is the Pi author's own durable runtime (same monorepo, lockstep-versioned, **Experimental**). Until the cutover gate passes, the SDK path above stays shipped. Rules: pin the exact version; confine every pi-durable import to adapter modules; the Harness lives in Electron main; never lose session history (one-time JSONL v3 importer, originals preserved). Phase 9 remote surfaces build on `watch()` ops; evaluate first-party `pi-server`/`pi-client` before writing an OpenPi-owned transport.

### Pi documentation sources

Use these for SDK behavior — not the broader internet — when the answer must be authoritative.

| Topic | Path |
|---|---|
| SDK overview, providers, modes | `node_modules/@earendil-works/pi-coding-agent/README.md` |
| SDK reference (sessions, runtime, exports) | `node_modules/@earendil-works/pi-coding-agent/docs/sdk.md` |
| RPC protocol | `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md` |
| Extension API | `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` |
| Session JSONL v3 format | `node_modules/@earendil-works/pi-coding-agent/docs/session-format.md` |
| Settings schema | `node_modules/@earendil-works/pi-coding-agent/docs/settings.md` |
| Security, project trust | `node_modules/@earendil-works/pi-coding-agent/docs/security.md` |
| Agent core types | `node_modules/@earendil-works/pi-agent-core/README.md` |
| Model registry and providers | `node_modules/@earendil-works/pi-ai/README.md` |

If the installed version lags upstream, mirror paths: https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/

---

## Pi Concepts

### Session format (JSONL v3 tree)

Sessions live at `~/.pi/agent/sessions/<path-slug>_<name>.jsonl`. Every line is a `SessionEntry` with `type`, `id` (8-char hex), `parentId` (null = root), `timestamp`. Entry types: `session` (header), `message`, `model_change`, `thinking_level_change`, `compaction`, `branch_summary`, `custom` (extension state, not in LLM context), `custom_message`, `label`, `session_info`. New kinds arrive across versions — unknown kinds must parse as opaque entries, never invalidate a session. Branching = new children from an earlier entry; the leaf is the current position. `SessionManager`: `getTree()`, `getBranch()`, `getLeafId()`, `getEntry()`, `getChildren()`, `getLabel()`.

**Do not flatten sessions into a chat log. Preserve the tree.**

### Message queue semantics

- **Steer** (`session.steer()`): delivered after the current turn's tool calls, before the next LLM call.
- **Follow-up** (`session.followUp()`): delivered only when the agent fully stops.
- **Abort** (`session.abort()`): cancels the run; pending queue messages return to input.
- `queue_update` events stream pending arrays — surface them in the UI.

### Events that drive the UI

`agent_start/end` (active indicator, token/cost summary) · `turn_start/end` (per-turn usage) · `message_start/update/end` (`assistantMessageEvent` deltas: text/thinking/toolcall) · `tool_execution_start/update/end` (tool cards) · `queue_update` (pending chips) · `compaction_start/end` · `auto_retry_start/end` · `extension_error` (surface visibly).

### Customizations (Pi's actual names)

| OpenPi UI | Pi concept | Discovery |
|---|---|---|
| Extensions | Extensions (.ts files) | `~/.pi/agent/extensions/`, `.pi/extensions/` |
| Skills | Skills (SKILL.md dirs) | `~/.pi/agent/skills/`, `.pi/skills/`, ancestors |
| Prompts | Prompt Templates (.md) | `~/.pi/agent/prompts/`, `.pi/prompts/` |
| Themes | Themes | `~/.pi/agent/themes/`, `.pi/themes/` |
| Packages | Pi Packages (npm/git) | `settings.json` packages array |

Extensions have full system permissions: show provenance before enabling, require workspace trust for project-local ones, never silently install, never load them in the renderer, never pass factory functions over IPC.

Context files: Pi loads `AGENTS.md` (or `CLAUDE.md`) walking up from cwd plus `~/.pi/agent/AGENTS.md`. Settings: `~/.pi/agent/settings.json` (global), `.pi/settings.json` (project overrides) — access via `SettingsManager.create(cwd)`.

---

## Electron Security Rules (mandatory)

`contextIsolation: true` · `nodeIntegration: false` in renderer · `sandbox: true` where practical · preload exposes only an explicit typed Zod-validated API · validate IPC sender for every privileged handler · strict CSP · no remote content by default · no raw Node built-ins in renderer · sandbox exceptions documented and scope-limited.

---

## Product Boundaries

- **Renderer is render-only.** Anything needing a Node built-in belongs in Electron main.
- **Git panel:** persistent live source control; file rows with `+N -N` and M/A/D badges; commit workflow stages **specific paths only** — never `git add .`/`git add -A`. All Git mutations in Electron main; the diff viewer collects intent, main executes it.
- **File preview** docks in the center surface (not a blocking modal, not a new permanent pane). Left drawer: navigation; center: conversation or preview; right: Git/tree/diff; bottom: terminal.
- **Customizations panel:** modal with sidebar nav + model selector + AI wizard. The wizard prompts the active Pi session, which writes resource files with Pi's own tools — no direct file-writing API from renderer or main. Show provenance before enabling; never silently install.
- **Pi owns session semantics.** OpenPi observes and presents.

---

## Development Principles

1. **SDK first.** If Pi can do it, use it; read the SDK docs before writing custom logic.
2. **Small verified slices.** One vertical slice (renderer → IPC → main → Pi) per PR; verify before expanding.
3. **Zod at every boundary; TypeScript at every contract.**
4. **Permission before mutation.** OpenPi-owned writes go through main-process policy. Pi tool execution stays YOLO by default — desktop policy lives in Electron main IPC, not as Pi `registerTool` shims.
5. **Human bottleneck.** Ship inspect/review/test evidence over velocity features; the user reviews agent output.
6. **No speculative work.** macOS first; no cloud, marketplace, or collaboration until the local workbench is excellent.
7. **File size — max 300 LOC per handwritten file.** Refactor into single-purpose modules; extract helpers, constants, types, subcomponents. Exempt: generated files, CSS, framework-contract files, and the rule surfaces (`AGENTS.md`, `ROADMAP.md`, `STATUS.md`).
8. **File naming** — 1 word preferred. Components PascalCase (`Sidebar.tsx`); hooks `useX.ts`; utilities/types/constants camelCase (`formatDate.ts`, `ipc.ts`); tests match source + `.test.ts`; framework contracts keep expected names (`vite.config.ts`).
9. **TypeScript quality:**
   - No `any` — use `unknown`, narrow with predicates or Zod.
   - `interface` for object shapes; `type` for unions/intersections/aliases.
   - Exhaustive switches with a `never` default.
   - No non-null assertions (`!`) — use `?.` / `??`, or a runtime check.
   - Discriminated unions with a `type` field over optional booleans.
   - Validate with Zod instead of casting `as X`; `as const` for literal type sources; `import type` for type-only imports.

---

## Release and Changelog Rules

Before tagging or claiming a release:

1. `git log --oneline <previous-tag>..HEAD` — inspect every included commit.
2. Update `CHANGELOG.md` with concrete user-facing notes grouped under `Added` / `Fixed` / `Changed`; one-line bullets with PR/issue links or short commit ids; no placeholder-only entries.
3. Re-check release automation: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `scripts/release.mjs`, `scripts/extract-release-notes.mjs`, `electron-builder.json` changelog packaging (`CHANGELOG.md` must stay in `extraResources` and readable by the What's New modal).

---

## Editing Rules

1. Read relevant files before editing.
2. Surgical diffs — one concern per PR.
3. Prefer existing patterns over new abstractions; no new dependencies without a clear reason (approval for direction-changing ones).
4. One owner per concept — renderer/main/Pi ownership lines are the primary constraint.
5. Verify before claiming completion.
6. **Issue-first PRs:** approved issue → branch from `origin/main` → tests → PR. No direct commits to `main`, no auto-merge, no AI approval in place of a human. Triage review comments with evidence. See `docs/development/prWorkflow.md`.

---

## What Not To Do

- Do not flatten Pi session trees into plain chat history.
- Do not let renderer code be the patch, secret, or Git authority.
- Do not import `@earendil-works/pi-coding-agent` in the renderer.
- Do not implement Pi-core features (plan mode, todos, permission gates, sub-agents) inside the agent path, and do not rebuild Pi's built-in MCP/codemode/tool-search with custom equivalents.
- Do not add a second agent runtime or fork `pi-coding-agent`. (Adopting the first-party `pi-durable` runtime per Phase 8 is the approved exception.)
- Do not hand-roll a remote transport while first-party `pi-server`/`pi-client` fit; if they don't at Phase 9 time, record why in a decision doc first.
- Do not silently install or enable third-party Pi packages.
- Do not rewrite Pi's agent runtime, session manager, or tool execution.
- Do not ship `nodeIntegration: true` or disable `contextIsolation`.
- Do not add features without a `ROADMAP.md` rationale.
