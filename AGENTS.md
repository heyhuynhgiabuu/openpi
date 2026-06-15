# OpenPi Project Rules

**Purpose:** Project-level operating rules for building OpenPi: a desktop workbench for the Pi coding agent (`@earendil-works/pi-coding-agent` v0.79.3+).
**Audience:** human developers and AI coding agents.
**Related surfaces:**
- `STATUS.md` — current feature status, beta surface, known constraints.
- `~/.pi/agent/APPEND_SYSTEM.md` — global system prompt supplement (workflow routing, tool selection, persona). Loaded every turn. Project-local `.pi/APPEND_SYSTEM.md` is intentionally absent so the global takes effect.
- `node_modules/@earendil-works/pi-coding-agent/` — installed SDK; see `## Pi Documentation Sources` below for the canonical doc table.

---

## Product Direction

OpenPi is a desktop workbench for the Pi coding agent. It wraps Pi's session tree, agent events, extensions, skills, and customizations in an Electron + SolidJS UI — not a terminal emulator clone, not a VS Code replacement.

Target UX: sessions sidebar (workspace-grouped, token/cost badges, filter/sort popover) + agent conversation (model selector, tool cards, queue controls) + customizations panel (modal with AI wizard, Extensions/Skills/Prompts/Themes/Packages) + persistent Git source control panel (Changes/Files tabs, commit workflow) + split-pane diff viewer + bottom terminal panel (Output tab + Terminal tab) + OpenCode-style command palette for commands, files, and sessions.

---

## Recommended Stack

| Layer | Choice |
|---|---|
| Shell | Electron + electron-vite + electron-builder |
| Renderer | SolidJS + TypeScript + Vite |
| Styling | Tailwind CSS + Kobalte/Radix-style primitives + Lucide Icons |
| State | Solid signals/memos plus Electron-main read models |
| Validation | Zod at every IPC/JSON boundary |
| Terminal | xterm.js + node-pty in Electron main |
| Diff renderer | @pierre/diffs (replaceable renderer only) |
| Pi integration | @earendil-works/pi-coding-agent SDK (imported in Electron main) |
| Persistence | SQLite via better-sqlite3 in Electron main |
| Secrets | OS keychain via Electron safeStorage |

For current feature status, beta surface, and known constraints, see `STATUS.md`.

---

## Pi Integration Path

### SDK is primary (Pi's own recommendation for Node.js)

```typescript
// Electron main process
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession({
  cwd: workspacePath,
  sessionManager: SessionManager.create(workspacePath),
  authStorage: AuthStorage.create(),
  modelRegistry: ModelRegistry.create(authStorage),
});

session.subscribe((event: AgentSessionEvent) => {
  // Forward to renderer via IPC
  mainWindow.webContents.send("pi:event", event);
});

await session.prompt(text);
```

### RPC subprocess — only when process isolation is explicitly required

Pi's `--mode rpc` (strict JSONL over stdin/stdout) is the right choice when:
- process-level isolation is required (security constraint or separate process budget)
- integrating from a non-Node language

For OpenPi, start with SDK in Electron main. Switch to RPC subprocess only when a concrete reason requires it.

**RPC framing note:** Split records on `\n` only. Do not use Node `readline` — it also splits on Unicode separators inside JSON.

### Session replacement API

For new session, resume, fork, and clone flows, use `AgentSessionRuntime` — not `AgentSession` directly:

```typescript
import { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices } from "@earendil-works/pi-coding-agent";

const runtime = await createAgentSessionRuntime(
  async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({ cwd });
    return { ...await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent }), services, diagnostics: services.diagnostics };
  },
  { cwd, agentDir: getAgentDir(), sessionManager: SessionManager.create(cwd) }
);

await runtime.newSession();   // replaces active session
await runtime.switchSession(path);
await runtime.fork(entryId);  // creates new session file
```

Re-subscribe to `AgentSessionEvent` after every session replacement — subscriptions attach to a specific `AgentSession` instance.

---

## Process Model and Authority

### Renderer is not authority

Exists to render state and collect user intent only.

Must not directly:
- access the filesystem
- execute shell commands
- spawn processes
- apply patches or Git mutations
- read/write SQLite
- read secrets
- import Pi internals

### Electron main owns desktop authority

Electron main owns:
- app/window lifecycle and native menus/dialogs
- secure IPC routing and sender validation
- Pi SDK session host (creates, supervises, destroys AgentSession instances)
- PTY lifecycle via node-pty
- permission gate orchestration (before any mutation-capable action)
- Git authority: read (status, diff), stage (add specific files), commit, push, revert, checkout — all owned exclusively by Electron main via `simple-git` or child_process. Never via Pi tools, Pi SDK, or renderer code.
- SQLite read-model for workspaces, sessions index, blocks, preferences
- secret storage via safeStorage

### Pi SDK owns agent semantics

The Pi SDK (`@earendil-works/pi-coding-agent`) owns:
- model/provider behavior and model registry
- tool execution (read, bash, edit, write, grep, find, ls)
- session tree (JSONL v3 format, parentId-based branching)
- compaction (automatic and manual)
- extensions, skills, prompt templates, themes
- Pi packages (npm/git)
- message queue semantics (steering, follow-up)
- `AgentSessionEvent` stream

OpenPi does not reimplement any of this. It observes events and commands the SDK.

### Pi documentation sources

Use these to look up SDK behavior, never the broader internet, when the answer should be authoritative.

| Topic | Path |
|---|---|
| SDK overview, providers, modes | `node_modules/@earendil-works/pi-coding-agent/README.md` |
| SDK reference (sessions, runtime, exports) | `node_modules/@earendil-works/pi-coding-agent/docs/sdk.md` |
| RPC protocol (strict JSONL) | `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md` |
| Extension API surface | `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` |
| Session JSONL v3 format | `node_modules/@earendil-works/pi-coding-agent/docs/session-format.md` |
| Settings, settings.json schema | `node_modules/@earendil-works/pi-coding-agent/docs/settings.md` |
| Security, project trust, supply-chain | `node_modules/@earendil-works/pi-coding-agent/docs/security.md` |
| CLI usage flags | `node_modules/@earendil-works/pi-coding-agent/docs/usage.md` |
| Agent core types (`AgentToolResult`, events) | `node_modules/@earendil-works/pi-agent-core/README.md` |
| AI model registry and providers | `node_modules/@earendil-works/pi-ai/README.md` |

For upstream source when the installed version lags, mirror paths are at https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/.

---

## Pi Concepts You Must Understand

### Session format (JSONL v3 tree)

Sessions are stored as JSONL files at `~/.pi/agent/sessions/<path-slug>_<name>.jsonl`.

Every line is a `SessionEntry` with `type`, `id` (8-char hex), `parentId` (null for root), `timestamp` (ISO).

Entry types:
- `session` — file header (no id/parentId); has `version`, `id` (UUID), `cwd`
- `message` — `AgentMessage` payload (user, assistant, toolResult, bashExecution, custom, branchSummary, compactionSummary)
- `model_change` — provider + modelId
- `thinking_level_change` — thinkingLevel
- `compaction` — summary + firstKeptEntryId + tokensBefore
- `branch_summary` — fromId + summary
- `custom` — extension state persistence (NOT in LLM context)
- `custom_message` — extension-injected LLM context message
- `label` — user-defined bookmark on targetId
- `session_info` — display name set via `/name` or `setSessionName()`

Tree structure: each entry points to its parent via `parentId`. Branching creates new children from an earlier entry. The "leaf" is current position. `SessionManager` API: `getTree()`, `getBranch()`, `getLeafId()`, `getEntry(id)`, `getChildren(id)`, `getLabel(id)`.

**Do not flatten sessions into a chat log.** Preserve the tree.

### Message queue semantics

Pi processes messages in a queue with two delivery modes:
- **Steer** (`session.steer()` / `steer` RPC): delivered after current assistant turn finishes its tool calls, before the next LLM call
- **Follow-up** (`session.followUp()` / `follow_up` RPC): delivered only when agent fully stops (no pending tool calls)
- **Abort** (`session.abort()`): cancels current run; pending queue messages return to input

`queue_update` events stream the current pending steering/followUp arrays. Surface them visibly in the UI.

### AgentSessionEvent stream

Core events to drive the UI:
| Event | UI use |
|---|---|
| `agent_start` | show active indicator |
| `agent_end` | clear active indicator, show token/cost summary |
| `turn_start` / `turn_end` | track per-turn usage (turn_end has message + toolResults) |
| `message_start` / `message_end` | open/close message bubbles |
| `message_update` with `assistantMessageEvent` | stream text_delta, thinking_delta, toolcall_delta |
| `tool_execution_start` | open tool card with name + args |
| `tool_execution_update` | update tool card with streaming output |
| `tool_execution_end` | close tool card with result / error |
| `queue_update` | update pending message chips |
| `compaction_start` / `compaction_end` | show compaction status entry |
| `auto_retry_start` / `auto_retry_end` | show retry status with attempt count |
| `extension_error` | surface extension failure visibly |

### What Pi does NOT have built-in

Pi intentionally ships without: MCP, permission gates, plan mode, background bash. OpenPi provides built-in subagents (see § OpenPi Subagent System) — registered as `customTools` on the sidecar session, not as Pi extensions. All are buildable via extensions. OpenPi must not assume these exist or fake them at the Pi layer. If OpenPi needs permission gates, it implements them at the Electron main boundary — not by pretending Pi has them.

### Extensions

TypeScript modules with **full system permissions**. They execute arbitrary code, call any Node API, and make network requests. Pi's extension API: `ExtensionAPI` with `registerTool`, `registerCommand`, `registerShortcut`, `on(event, handler)`, `sendMessage`, `appendEntry`, `setActiveTools`, `registerProvider`, etc.

Security obligations:
- Show provenance (path, scope, package origin) before enabling
- Require workspace trust for project-local extensions
- Never silently install or execute third-party packages
- Extensions must run through Pi SDK, not be loaded directly by the renderer
- Never pass extension factory functions across the IPC boundary

### Customizations (correct Pi terminology)

| OpenPi UI | Pi concept | Discovery |
|---|---|---|
| Extensions | Extensions (.ts files) | `~/.pi/agent/extensions/`, `.pi/extensions/` |
| Skills | Skills (SKILL.md dirs) | `~/.pi/agent/skills/`, `.pi/skills/`, ancestor dirs |
| Prompts | Prompt Templates (.md) | `~/.pi/agent/prompts/`, `.pi/prompts/` |
| Themes | Themes | `~/.pi/agent/themes/`, `.pi/themes/` |
| Packages | Pi Packages (npm/git) | `settings.json` packages array |

Do not use OpenCode/Copilot terminology ("Instructions", "Hooks", "Plugins", "Agents" count) for Pi resources. Use Pi's actual names.

### Context files

Pi loads `AGENTS.md` (or `CLAUDE.md`) walking up from cwd plus `~/.pi/agent/AGENTS.md`. They concatenate. Keep project-local AGENTS.md concise and operational. Project `.pi/SYSTEM.md` replaces the default system prompt; `.pi/APPEND_SYSTEM.md` appends to it.

### Settings

Two scopes: `~/.pi/agent/settings.json` (global) and `.pi/settings.json` (project, overrides global). Key settings: `compaction.enabled`, `retry.enabled`, `steeringMode`, `followUpMode`, `transport`, `packages`, `extensions`. Use `SettingsManager.create(cwd)` for SDK access.

## Electron Security Rules

Mandatory defaults — not optional:

- `contextIsolation: true`
- `nodeIntegration: false` in renderer
- `sandbox: true` where practical
- preload exposes only an explicit, typed, Zod-validated API surface
- validate IPC sender (frame origin) for every privileged handler
- strict Content Security Policy
- no remote content by default
- no renderer access to raw Node built-ins
- sandbox exceptions must be documented and scope-limited

---

## OpenPi Subagent System

Pi intentionally ships without: MCP, permission gates, plan mode, background bash. **OpenPi provides built-in subagents** — registered as `customTools` on the sidecar session, not as Pi extensions. All are buildable via extensions. OpenPi must not assume these exist or fake them at the Pi layer. If OpenPi needs permission gates, it implements them at the Electron main boundary — not by pretending Pi has them.

### Architecture

| Layer | File(s) | Role |
|---|---|---|
| **Sidecar host** | `electron/pi/sidecar.ts` | Electron `utilityProcess` running the Pi SDK; owns `createAgentSession`, `DefaultResourceLoader`, `SettingsManager`, `SessionManager`, `AuthStorage`, `ModelRegistry` |
| **Subagent core** | `electron/subagent/class.ts`, `electron/subagent/schemas.ts`, `electron/subagent/types.ts` | Custom tool definitions (worker, explorer, scout, planner, reviewer) injected via the sidecar's `customTools` option |
| **Main bridge** | `electron/services/piSidecar.ts` | Wraps subagent invocation, builds the system prompt fragment, forwards user input |
| **Renderer shell** | `src/components/SubagentWidget.tsx`, `src/components/conversation/ToolCardView.tsx` | Renders the subagent and tool cards in the conversation timeline |
| **State bridge** | `src/lib/syncBridge.ts` | Bridges session state from the electron main to the renderer |

### Built-in agent types

| Type | Surface | Notes |
|---|---|---|
| `worker` | LLM tool | Default general-purpose subagent |
| `explorer` | LLM tool | Read-only investigation, no writes |
| `scout` | LLM tool | Cheap, fast reconnaissance |
| `planner` | LLM tool | Decomposes objectives into plans, no execution |
| `reviewer` | LLM tool | Code review and quality assessment |

### Custom agents

Subagents can be added under `~/.pi/agent/agents/<name>/` with an `AGENTS.md` frontmatter block:

```yaml
---
name: my-agent
description: One-line purpose
model: anthropic/claude-sonnet-4-6
thinking: medium
tools: [read, grep, find]
---
```

The frontmatter is parsed by `DefaultResourceLoader` and registered as a subagent tool. The body becomes the system prompt fragment.

### Subagent-specific don'ts

- Do not import `@earendil-works/pi-coding-agent` in the renderer to use subagent APIs.
- Do not reuse a `customTools` array across sessions; rebuild per `createAgentSession` call.
- Do not let the model decide which subagent to invoke without an explicit user trigger; the surface is opt-in.
- Do not wire subagent prompts that bypass the sidecar; all subagent invocation goes through `electron/pi/sidecar.ts` so Electron main owns lifecycle.


---

## Non-Negotiable Product Boundaries

### Renderer is render-only

Never add filesystem, shell, process, patch, SQLite, secret, or Git logic to renderer code. If it requires a Node built-in, it belongs in Electron main.

### Diff viewer and Git source control panel

The right panel is a **persistent live git source control panel** (always visible, not just after agent runs):
- File-level changes with `+N -N` line counts and M/A/D status badges
- Branch total delta in header
- Commit workflow (stage + commit message + commit button) — all mutations in Electron main
- `simple-git` or direct `child_process` for all git commands in Electron main

`@pierre/diffs` renders the split-pane diff viewer (side-by-side old/new, syntax-highlighted, N of M file navigation). Electron main computes diffs and applies/rejects hunks. The diff viewer collects intent; Electron main executes it.

**Critical:** Commit workflow must never use `git add .` or `git add -A`. Always pass specific file paths.

### File preview is a center workbench surface

Normal source/file preview should be docked in the main center surface, not opened as a blocking modal. Keep the workbench spatial model Zed-like:
- Left drawer: Threads or Workspace navigation.
- Center surface: Conversation by default, or a temporary/pinned file preview surface.
- Right panel: Git/file tree/diff utilities.
- Bottom: terminal/output plus compact status/action bar.

Do not add another modal for routine file preview. Do not create another permanent side pane for preview. Do not turn OpenPi into a full IDE; file preview supports agent context and review workflows, while Pi remains the source of agent semantics.

### Customizations panel is a modal with an AI wizard

The customizations panel opens as a full modal/overlay with:
- Sidebar nav: Extensions, Skills, Prompts, Themes, Packages (count badges)
- Model selector at the top of the panel
- **AI generation wizard**: user describes preferences in natural language → OpenPi sends as a structured Pi session prompt → agent writes resource files into the correct Pi directories
- Per-resource management with `New…` scaffold actions and `Browse…` for packages

The AI wizard does NOT call any file-writing API directly from the renderer or Electron main. It prompts the active Pi session which uses Pi's own tools (write, edit) to create the files. OpenPi then triggers a resource reload.

Show provenance before enabling. Require workspace trust for project-local extensions. Never silently install. Extensions run through Pi SDK in Electron main — they are never loaded in the renderer.

### Pi SDK owns session semantics

Never reimplement session tree, compaction, message queuing, or tool execution in OpenPi. These belong to Pi. OpenPi observes and presents.

---

## Development Principles

1. **SDK before reimplementation.** If Pi SDK can do it, use it. Read the SDK docs before writing custom logic.
2. **Small verified slices.** Build one vertical slice (renderer → IPC → main → Pi SDK) at a time. Verify before expanding.
3. **Boundary-first type safety.** Zod at every IPC payload. TypeScript at every contract.
4. **Preserve session tree semantics.** Never flatten JSONL trees into plain message arrays for persistence.
5. **Permission before mutation.** Any action that writes files, applies patches, mutates Git state, executes shell commands, or runs extensions needs explicit policy in Electron main before execution.
6. **No speculative work.** Build macOS first. Add platforms after core stability. No cloud, marketplace, or collaboration until local workflows are excellent.
7. **File size limit — max 300 LOC per file.** Files over 300 lines must be refactored into smaller modules with clear single responsibilities. Extract helpers, constants, types, and subcomponents into separate files. Every file should have one obvious purpose. Exception: generated files, CSS, auto-detected/auto-configured files, and the project rule surface (`AGENTS.md`, `STATUS.md`) are exempt.
8. **File naming — 1 word preferred, PascalCase for components, camelCase for modules.**
   - **Components (.tsx)**: PascalCase, 1 word — `Sidebar.tsx`, `Composer.tsx`, `FileTree.tsx`. Not `sidebarPanel.tsx` or `FilePreviewPanel.tsx`.
   - **Hooks**: camelCase with `use` prefix — `useSession.ts`, `useFileTree.ts`.
   - **Utilities/helpers**: camelCase — `formatDate.ts`, `sessionEvents.ts`.
   - **Types/schemas**: camelCase — `ipc.ts`, `extensionTrackers.ts`.
   - **Constants/config**: camelCase — `keybindings.ts`, `notificationPreferences.ts`.
   - **Test files**: match source file name + `.test.ts` — `Composer.test.tsx`.
   - **Exception**: files extending a framework contract keep the expected name (`vite.config.ts`, `electron-builder.json`).
9. **TypeScript quality.**
   - **No `any`** — use `unknown` and narrow with type predicates or schema validation (Zod).
   - **Prefer `interface` over `type`** for object shapes (extends semantics, merged declarations, better error messages). Use `type` for unions, intersections, and aliases only.
   - **Exhaustive switches** — always include a `never` default to catch unhandled variants at compile time:
     ```ts
     switch (status) {
       case 'running': ...
       case 'completed': ...
       default: const _exhaustive: never = status; break;
     }
     ```
   - **No non-null assertions (`!`)** — handle `undefined` with optional chaining (`?.`) and nullish coalescing (`??`). If a value must exist, assert with a runtime check, not `!`.
   - **Discriminated unions over optional fields** — use a `type` field to distinguish variants instead of having 3 optional booleans:
     ```ts
     // Good
     type Result = { status: 'success'; data: T } | { status: 'error'; error: Error }
     // Bad
     type Result = { isSuccess?: boolean; data?: T; error?: Error }
     ```
   - **Zod over raw type assertions** — every IPC payload, config file, and external boundary must validate with Zod before use. Never cast `as X` without validation.
   - **`const` assertions for literals** — use `as const` on arrays and objects used as type sources, not manual type literals.
   - **Import types with `type` modifier** — `import type { X } from './y'` to avoid runtime bundling of unused type imports.

---

## Release and Changelog Rules

Before tagging, pushing, or claiming any version release:

1. Run `git log --oneline <previous-version-tag>..HEAD` and inspect every commit included in the release.
2. Update `CHANGELOG.md` for the version with concrete, user-facing release notes grouped under headings such as `Added`, `Fixed`, and `Changed`.
3. Write release notes in a concise Zed-style format: optional one-sentence overview, then grouped one-line bullets where each line summarizes the user-visible change simply and includes a PR/issue link or short commit id when available.
4. Mention relevant implementation/ops changes when they affect users or maintainers: CI, packaging, updater behavior, Git/workspace behavior, file attachments, Pi package loading, docs, and beta caveats.
5. Before finalizing release notes, re-check release automation inputs and outputs: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `scripts/release.mjs`, `scripts/extract-release-notes.mjs`, and `electron-builder.json` changelog packaging.
6. Never leave a placeholder-only entry such as `Release OpenPi vX.Y.Z.` for a released version.
7. Verify the packaged changelog path when release UI changes: `CHANGELOG.md` must be included in `electron-builder.json` `extraResources` and readable by the app's What's New modal.
8. If release automation creates a placeholder entry, edit it into full notes before creating or pushing the tag.

---

## Editing Rules

1. Read relevant files before editing.
2. Keep diffs surgical — one concern per PR.
3. Prefer existing patterns over new abstractions.
4. Do not add dependencies without a clear reason; get user approval for dependencies that change project direction.
5. Define one owner per concept — renderer/main/Pi SDK ownership lines are the primary constraint.
6. Run verification before claiming completion.
7. Do not duplicate Pi SDK functionality in OpenPi. Check the SDK first.

---

## What Not To Do

- Do not flatten Pi session trees into plain chat history.
- Do not let renderer code be the patch, secret, or Git authority.
- Do not import `@earendil-works/pi-coding-agent` in the renderer.
- Do not implement permission gates at the Pi SDK layer — do it at the Electron main IPC boundary.
- Do not silently install or enable third-party Pi packages.
- Do not build a subprocess RPC client before proving SDK in main is insufficient.
- Do not rewrite Pi's agent runtime, session manager, or tool execution.
- Do not fork Warp or OpenWarp as the app base.
- Do not ship `nodeIntegration: true` or disable `contextIsolation` as a convenience shortcut.
- Do not use OpenCode/Copilot terminology for Pi's resources (Instructions → Prompts, Agents → Extensions, Hooks → Extension events, Plugins → Packages).


