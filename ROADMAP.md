# OpenPi Roadmap

OpenPi is a native desktop workbench for the Pi coding agent. The goal: make Pi sessions visible, steerable, and safe in a local-first Electron app — not clone Warp, not replace VS Code.

**North star UI reference:** sessions sidebar grouped by workspace (token/cost badges, timestamps) + agent conversation with model selector + customizations panel (modal with AI wizard, Extensions/Skills/Prompts/Themes/Packages) + OpenCode-style command palette (`⇧⌘P`) + persistent Git source control panel (live file changes, M/A/D badges, commit button) + split-pane inline diff viewer (side-by-side, syntax-highlighted, N of M navigation). That's the product.

---

## Current Status (May 2026 beta) — v0.1.16

Done so far:
- Electron shell with secure preload bridge, Zod-backed IPC contracts, sandboxed renderer, and main-owned authority for filesystem, PTY, Git, and app metadata.
- SolidJS workbench UI with session sidebar, workspace rail, conversation pane, model controls, steering/follow-up queues, command palette, customizations modal, terminal/output panel (multi-tab), Git panel, file tree/search, file viewer, and split diff viewer.
- Session/workspace read model in SQLite, last-workspace restore, session search/sort/group controls, pinned/archive flows, and new-session hero metadata (workspace path, Git branch, last modified).
- Customizations inventory for Extensions, Skills, Prompts, Themes, Packages, Settings, General preferences, and Keybindings; command palette (`⇧⌘P`).
- **Goal/harness v2 loop**: `/goal` controller with 7 harness tools, product docs, story browser, decision records, test matrix.
- **Conversation polish**: live token counter, code line numbers, streaming cursor fix, entry animation, responsive images.
- **File editor improvements**: CodeMirror 6 editor, format-on-save (Biome), word wrap toggle, FORMAT_FILE IPC, find-with-replace.
- **Extensions UI**: enable/disable toggle per extension, preference persistence, reload button.
- **Terminal tabs**: renameable tabs, add/close/switch, process exit indicators.
- **Onboarding flow**: first-run detection, enhanced welcome screen with setup guide.
- **Harness lint pre-commit hook** and full docs/ product documentation directory.
- Runtime OpenPi branding: app name/version from Electron main, shared metadata, OpenPi icon set.
- CI/CD baseline: PR/main verification, tag-triggered beta release across macOS/Windows/Linux.
- **Built-in subagents**: three Pi SDK-native tools (`Agent`, `get_subagent_result`, `steer_subagent`) registered as `customTools` in the sidecar session. 5 built-in agent profiles: Worker, Explorer, Scout, Planner, Reviewer with dedicated prompt files and explicit tool allowlists (srcwalk, webclaw, pi-search per agent role). Background queueing (4 max concurrent) with real-time status streaming to the renderer.
- **Custom agent discovery**: `.pi/agents/*.md` + `~/.pi/agent/agents/*.md` files with full frontmatter support (display_name, tools, disallowed_tools, model, thinking, max_turns, prompt_mode, isolated, enabled). Project > global > builtin priority with workspace-trust gating for project agents.
- **Subagent widget**: live status tray with Bot icon, elapsed timer, expandable detail panel (ID/status/turns/tools/4K result preview), background completion notification banner. Status bugfixes: onToolEnd no longer overwrites background status; clearFinished preserves background agents.
- **@mention autocomplete**: `@` in composer shows subagents + files with section headers, Bot icon in accent box, capital-case display, keyboard navigation across combined list. Agent chip replaces raw text; `@name` prepended invisibly on send.
- **Agent prompt tuning**: tool description tells Pi to delegate on `@agent_name` patterns. All 5 agent prompts have explicit subagent identity headers. Structured termination contract (Result/Verification/Summary/Blockers) enforced via buildPrompt.

Still beta-blocking:
- macOS signing/notarization secrets and verified Windows signing are not configured yet.
- Permission gates, protected paths, workspace trust, and keychain-backed provider secrets remain Phase 6 hardening work.
- Full lint/test health must stay green in CI before broad beta distribution.

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│ SolidJS Renderer                                 │
│  sessions sidebar · conversation · customizations│
│  command palette · terminal · diff panel · settings│
│  xterm.js · Solid signals/memos · Zod            │
└──────────────────┬───────────────────────────────┘
                   │ contextBridge (preload)
┌──────────────────▼───────────────────────────────┐
│ Electron Main                                    │
│  app/window lifecycle · secure IPC routing       │
│  Pi SDK session host · node-pty PTY bridge       │
│  permission orchestration · Git read/stage/commit │
│  SQLite read-model (session index, workspaces)   │
└──────────────────────────────────────────────────┘
            │ SDK import (same process)
┌───────────▼──────────────────────────────────────┐
│ Pi SDK (@earendil-works/pi-coding-agent)         │
│  AgentSession · SessionManager · ResourceLoader  │
│  AuthStorage · ModelRegistry · extensions        │
│  tools · compaction · session tree (JSONL v3)    │
└──────────────────────────────────────────────────┘
```

**Key authority split:**
- **Renderer**: render state, collect intent. No Node access. No Pi imports.
- **Electron main**: IPC routing, app lifecycle, PTY, Pi SDK session host, Git read/stage/commit, SQLite, permission gates.
- **Pi SDK** (in Electron main): agent loop, session tree, tools, extensions, compaction, models. Not reimplemented. Not wrapped in a separate process for MVP.

**Why SDK in Electron main (not subprocess RPC):** Pi's own docs say "if you're building a Node.js application, consider using AgentSession directly." We are. Type-safe, zero framing overhead, full access to `AgentSessionEvent` types. Switch to subprocess isolation if resource/security pressure demands it later.

---

## Stack

| Layer | Choice |
|---|---|
| Shell | Electron + electron-vite + electron-builder |
| Renderer | SolidJS + TypeScript + Vite |
| Styling | Tailwind CSS + Kobalte/Radix-style primitives + Lucide Icons |
| State | Solid signals/memos plus Electron-main read models |
| Validation | Zod at every IPC/JSON boundary |
| Terminal | xterm.js + node-pty in main |
| Editor | CodeMirror 6 |
| Diff | @pierre/diffs (replaceable renderer only) |
| Pi integration | @earendil-works/pi-coding-agent SDK (direct import in main) |
| Persistence | SQLite via better-sqlite3 in main process |
| Secrets | OS keychain via Electron safeStorage |

---

## Reference Study — Terax AI

Source: [`crynta/terax-ai`](https://github.com/crynta/terax-ai), reviewed at commit `4f5dbe452ae193f0aa152f421b8dccd2a322f11a`.

What is worth learning:
- **Feature-module architecture:** Terax groups major workbench surfaces under `src/modules/` (`ai`, `editor`, `explorer`, `terminal`, `preview`, `source-control`, `git-history`, `tabs`, `settings`). OpenPi should keep using feature slices for large surfaces instead of growing a monolithic app component.
- **Native authority boundary:** Terax registers PTY, filesystem, search, Git, shell, secrets, networking, and workspace authorization as native commands in `src-tauri/src/lib.rs`. OpenPi's equivalent remains Electron main + typed preload IPC; renderer stays intent-only.
- **Workbench surfaces stay alive:** Terax keeps terminals/editors/previews/diffs mounted and hides inactive panes so long-running state keeps streaming. OpenPi should apply the same rule to terminal tabs, diff/file preview surfaces, and agent conversation state.
- **Capability-tiered agent approvals:** Terax auto-runs read-only tools behind secret-path guards, while mutating tools require explicit approval and edits require prior `read_file`. OpenPi should express this at the Electron-main permission gate, not inside the renderer.
- **Scoped read-only subagents:** Terax's subagents are role-based and tool-whitelisted. OpenPi should treat Pi subagents/task widgets as first-class UI, with read-only defaults and explicit escalation for mutation-capable work.
- **Pragmatic package ideas:** Terax validates CodeMirror 6 as the editor base and uses optional editor add-ons (`@codemirror/merge`, `@codemirror/lint`, `@replit/codemirror-vim`, multiple `@uiw` themes), xterm.js add-ons, OS keychain storage, and explicit workspace authorization. Adopt only where they support OpenPi's Pi-first product boundary.

Roadmap implications:
- Add a documented privileged-command registry for Electron main/preload IPC, with each command classified as read, write, shell, Git, secret, or extension/package mutation.
- Keep long-lived workbench surfaces mounted when switching center surfaces or tabs; hide instead of remounting when preserving streaming/process state matters.
- Add read-before-edit and protected-path enforcement to any OpenPi-owned mutation flow, including Git hunk application, file saves, terminal shell actions, and future Pi resource generators.
- Represent agent-proposed edits as reviewable diff cards/tabs before apply, rather than burying patch intent inside generic tool output.
- Consider a later editor-enhancement slice for CM6 merge/lint/Vim/theme-pack support; do not let this turn OpenPi into a full IDE.

---

## Pi Integration Reality (v0.74.0)

These facts must drive implementation. Do not guess or approximate.

### SDK primary path
```typescript
import { createAgentSession, SessionManager, AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
const { session } = await createAgentSession({ sessionManager: SessionManager.create(cwd) });
session.subscribe((event) => { /* AgentSessionEvent stream */ });
await session.prompt("...");
```

### Session format (JSONL v3 tree)
- Stored at `~/.pi/agent/sessions/<path-slug>_<name>.jsonl`
- Each line: `SessionEntry` with `type`, `id` (8-char hex), `parentId`, `timestamp`
- Entry types: `session` (header), `message`, `model_change`, `thinking_level_change`, `compaction`, `branch_summary`, `custom`, `custom_message`, `label`, `session_info`
- Tree structure: `parentId: null` = root; branching = new children from earlier entry
- `SessionManager.list(cwd)` — sessions for a directory
- `SessionManager.listAll()` — all sessions across all projects

### Event types
`agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update` (with `assistantMessageEvent` deltas), `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `queue_update`, `compaction_start`, `compaction_end`, `auto_retry_start`, `auto_retry_end`, `extension_error`

### Message queue semantics
- `session.steer(text)` — delivered after current tool calls complete, before next LLM call
- `session.followUp(text)` — delivered only when agent fully stops
- `session.abort()` — cancel current run
- `queue_update` event streams pending steering/followUp arrays

### What Pi does NOT have built-in
Pi intentionally has no: sub-agents, MCP, permission gates, plan mode, background bash. All are buildable via extensions. OpenPi must not assume these exist and must not fake them in the Pi layer.

### Customizations (Pi's real names)
| OpenPi UI label | Pi concept | Discovery path |
|---|---|---|
| Extensions | Extensions (TypeScript modules) | `~/.pi/agent/extensions/`, `.pi/extensions/` |
| Skills | Skills (SKILL.md markdown) | `~/.pi/agent/skills/`, `.pi/skills/` |
| Prompts | Prompt Templates (.md files) | `~/.pi/agent/prompts/`, `.pi/prompts/` |
| Themes | Themes | `~/.pi/agent/themes/`, `.pi/themes/` |
| Packages | Pi Packages (npm/git) | `settings.json` packages array |

### Extension security
Extensions are TypeScript modules that run with **full system permissions**. They can execute arbitrary code, call any Node API, and make network requests. Treat them like executable code — show provenance, require workspace trust, never silently install third-party packages.

### Session stats (from `get_session_stats` RPC / `session.agent.state`)
Token input/output/cacheRead/cacheWrite, cost, contextUsage (tokens, contextWindow, percent). These drive the token badges visible in the session list.

---

## Product Principles

1. **Sessions are trees, not flat chats.** Visualize parentId links, branches, compactions, labels, model changes.
2. **Renderer renders; main decides.** Permission gates, patch authority, secrets, SQLite — all in main.
3. **Preserve Pi queue semantics.** Steering, follow-up, abort are first-class UX concepts.
4. **Customizations are first-class.** Users need to see, manage, and trust their extensions/skills/packages.
5. **Local-first.** Works offline. No cloud sync required.
6. **Extensions are dangerous.** Provenance before enablement. Never silent install.
7. **Terminal and agent modes are distinct.** Shell terminal ≠ implicit Pi control surface.

---

## Electron Security Baseline (mandatory, not optional)

- `contextIsolation: true`
- `nodeIntegration: false` in renderer
- `sandbox: true` where practical
- Narrow preload surface with explicit Zod-validated allowlist
- IPC sender validation for all privileged handlers
- Strict CSP
- No renderer access to Node built-ins

---

## Phase 0 — Electron Shell + Pi SDK Bridge

**Goal:** prove the Electron shell can host a Pi session and stream events to the renderer safely.

Build:
- Electron + React + Vite + Tailwind app shell
- Secure preload bridge with typed, Zod-validated IPC channel map
- `SessionHost` in Electron main: creates Pi `AgentSession`, pipes `AgentSessionEvent` stream to renderer via IPC, handles prompt/steer/followUp/abort commands
- Basic agent conversation view: streaming text, thinking blocks, tool execution cards (name + expandable output)
- Model selector using `ModelRegistry.getAvailable()`
- Token/cost display from `turn_end` usage events
- Abort button wired to `session.abort()`
- Workspace folder picker (uses `cwd` for Pi session)

Acceptance criteria:
- User picks a folder, sends a prompt, sees streamed assistant response
- Tool calls appear as cards (name, collapsible output)
- Token usage and cost update after each turn
- User can abort a running turn
- Worker crash or SDK throw does not crash the app
- Renderer has zero access to Node APIs
- Every IPC payload is Zod-validated at receive

Out of scope: session persistence, session list, customizations, terminal.

---

## Phase 1 — Workspace + Session Tree Browser

**Goal:** build the sessions sidebar shown in the reference UI — workspace-grouped, with token badges, session names, timestamps.

Build:
- Workspace model in SQLite (Electron main): canonical resolved path, display name, last opened
- Recent workspaces list + open new folder flow
- Session index read-model in SQLite: scan `~/.pi/agent/sessions/`, extract header + last session_info + total tokens/cost + last message timestamp, upsert by session file path
- Session list sidebar: workspace sections, session names (from `session_info` entries or first user message), token/cost badge, relative timestamp, active indicator
- Resume existing session via `SessionManager.open(path)`
- New session in current workspace
- **Session list filter/sort popover** (triggered from `≡` icon in sessions header):
  - Sort by Created (default, checkmarked) / Sort by Updated
  - Group by Workspace (default, checkmarked) / Group by Time
  - Show Recent Sessions (default) / Show All Sessions
  - Collapse All Groups
- Session search/filter by name
- Git branch detection for active workspace (read-only, no staging)

Acceptance criteria:
- App reopens last workspace and its sessions on restart
- Session list groups by workspace (default), with toggle to group by time
- Sort by Created and Sort by Updated both work correctly
- "Show Recent Sessions" filters to sessions from the last N days; "Show All Sessions" shows the full list
- "Collapse All Groups" folds all workspace sections
- Token/cost badges match Pi's own session stats
- Duplicate/symlinked workspace paths do not create identity conflicts
- Resuming a session restores the correct session file and continues the tree
- Session tree structure is NOT flattened — parentId links are preserved in SQLite index for later tree view

---

## Phase 2 — Customizations Panel

**Goal:** surface Pi's extensibility model (extensions, skills, prompts, themes, packages) with provenance, trust controls, and first-class resource creation.

Build:
- **Customizations modal/overlay** with sidebar nav: Extensions, Skills, Prompts, Themes, Packages — full-panel design with sidebar navigation
- Sidebar shows count badges per resource type
- **Model selector** at the top of the panel (shows active provider/model, allows switching within the panel)
- **AI generation wizard**: natural-language description input at top (e.g. "Prefer concise commits, thorough reviews, and tested code") → auto-generates extension/skill/prompt file content as a starting point. OpenPi sends the description to the active Pi session as a structured prompt; the agent writes the resource files into the correct Pi directories.
- Per-resource sections with descriptions and `New…` / `Browse…` actions:
  - **Extensions**: define custom tools, event hooks, compaction logic — `New…` opens an editor scaffold (TypeScript with `ExtensionAPI` type stub)
  - **Skills**: create SKILL.md files for domain workflows — `New…` with template
  - **Prompts**: create `.md` prompt templates — `New…` with frontmatter scaffold
  - **Themes**: theme JSON files — `New…`
  - **Packages**: browse/install Pi Packages from npm/git — `Browse…` opens package search
- Use Pi SDK `DefaultResourceLoader` to discover all resources; watch for filesystem changes and reload
- Per-entry metadata: name, source path, scope (user/project), package origin, enabled/disabled toggle
- Provenance badge: user-global vs project-local vs installed package
- **Extension trust gate**: show source path + warning + require explicit confirmation before enabling any extension

Acceptance criteria:
- Count badges match actual discovered resources from Pi directories
- AI wizard generates plausible resource file content via Pi session prompt; files land in correct Pi directories
- Extensions from project-local paths vs global paths are visually distinct
- Enabling a new extension shows source path and requires one-click confirmation
- `New…` scaffolds open with correct file template in an embedded editor
- Installing/uninstalling packages requires explicit user action (no silent installs)
- Reload resources updates all counts without app restart

---

## Phase 3 — Agent Mode + Message Queue Semantics

**Goal:** preserve Pi's steering/follow-up behavior in desktop UX.

Build:
- Visible message queue: steering queue entries and follow-up queue entries shown separately
- Steer input: available while agent is running, sent via `session.steer()`
- Follow-up input: queued for after agent stops, sent via `session.followUp()`
- Queue state driven by `queue_update` events
- Alt+Enter / keyboard shortcut to switch between steer and follow-up modes
- Clear queue button
- Pending message chips showing queued items
- Abort button restores pending messages to input
- Session tree view: navigate branches via `SessionManager.getTree()`, jump to entry, see compaction entries and branch summaries
- `/tree` equivalent: select earlier entry, continue from there (via `session.navigateTree()`)
- Fork session action (via `AgentSessionRuntime.fork()`)
- Session name editor (via `set_session_name` / `pi.setSessionName()`)
- Compaction status indicator (compaction_start/end events)

Acceptance criteria:
- User can send steering message while agent is mid-turn; it delivers after tool calls complete
- Follow-up appears in queue and delivers after agent stops
- Queue state is visible and clearable
- Session tree view shows parent/child relationships, not flat chat
- Forking creates a new session file with correct parentSession reference
- Compaction events are surfaced (e.g., "context compacted" entry in conversation)
- Abort clears pending queue to input field

---

## Phase 4 — Terminal Pane

**Goal:** production-quality shell terminal as a **bottom panel**, kept strictly separate from agent mode.

### Layout

The terminal lives in a **resizable bottom panel** below the agent conversation area — not a side-by-side pane. This matches the reference screenshot layout.

- Vertical split: agent conversation (top, flex) + terminal panel (bottom, resizable via drag handle)
- Panel has two tabs: **`Output`** and **`Terminal`**
- **`Output` tab**: streams Pi SDK stdout/stderr and OpenPi app logs (extension errors, SDK warnings, IPC diagnostics). Read-only. Auto-scrolls.
- **`Terminal` tab**: interactive shell (xterm.js + node-pty)
- Tab bar (top-right of panel): active tab name (e.g. `zsh - copilot-proxy`) + `+` new terminal + split dropdown + detach + close tab + close panel buttons
- Panel can be fully hidden (keyboard shortcut) and restored

Build:
- xterm.js terminal with fit/webLinks/search addons
- node-pty PTY lifecycle in Electron main: spawn, resize, write, close
- Shell auto-detection (user's default shell from env)
- Copy/paste/right-click context menu
- Multiple terminal instances (tabs) with per-tab title from process cwd
- Resizable split panel (store height in SQLite prefs; restore on relaunch)
- **`Output` tab**: subscribe to Pi SDK `extension_error` events and app-level IPC error channel; line-buffered display with timestamp prefix
- Command/output block capture: group command + output + exit code + cwd + timestamp
- Blocks stored in SQLite for session history
- Terminal mode is a distinct mode from Agent Mode — shell terminal is not a Pi input surface

Acceptance criteria:
- Terminal opens in bottom panel (not a modal or side pane)
- Output tab shows Pi SDK extension_error events and app logs in real time
- PTY resizes correctly when panel is resized
- Panel height persists across app restarts
- Multiple terminal tabs each spawn an independent PTY
- Terminal process exits cleanly when tab closes
- Terminal pane has zero knowledge of Pi session state or agent events

---

## Phase 5 — Git Source Control Panel + Diff Viewer

**Goal:** make agent file edits visible, reviewable, and committable — persistent right panel + inline split diff.

### Git Source Control Panel (persistent right panel)

This panel is always visible alongside the conversation, not just post-agent-run:

Build:
- **"Changes" tab**: live `git status` watch via `chokidar` on the workspace `.git` directory
- File list with per-file: relative path, parent directory, status badge (M = modified, A = added, D = deleted, R = renamed), `+N -N` line-count delta
- **Branch Changes** header: total `+N -N` across all changed files
- File click → opens split-pane diff viewer in the center panel
- **Commit workflow** (all executed in Electron main, never renderer):
  - Stage individual files or all files
  - Commit message input
  - `Commit` button → runs `git add <specific-files> && git commit -m "..."` via Electron main
  - Commit dropdown: Commit, Commit & Push, Amend
- **"Files" tab**: project file tree browser
- All git mutations (stage, commit, push, revert) run exclusively in Electron main via `simple-git` or direct child_process — never via Pi tools, Pi SDK, or renderer code

### Split-Pane Diff Viewer (center panel, activated by file click)

Build:
- **Side-by-side split view**: old (left) + new (right) columns — matching the reference screenshot
- Syntax-highlighted code using workspace language detection
- **"N of M" file navigation** with ← → arrows cycling through all changed files in order
- Diff lines: red for removed, green for added, neutral for context lines
- Collapsed sections for large unchanged regions (e.g. `26 hidden lines`)
- Hunk-level accept/reject: UI collects intent; Electron main executes `git apply` or `git checkout -- <file>`
- Diff computation in Electron main via `simple-git diff`, sends structured hunk data to renderer — never raw git output
- `@pierre/diffs` renders hunk blocks; swap point is the adapter between hunk data and renderer
- Session-linked diff: agent run → changed files list auto-updates the panel

Acceptance criteria:
- Changes panel updates within 1s of a file write in the workspace
- File badges (M/A/D) and `+N -N` counts match `git diff --stat` output
- Clicking a file opens its split-pane diff in the center panel
- `N of M` navigation cycles through all changed files in order
- Commit workflow stages only the specified files — no accidental `git add .`
- Renderer never calls git directly; all mutations go through Electron main IPC
- `@pierre/diffs` can be swapped via a local adapter without touching git logic
- Hunk accept/reject correctly applies or reverts the specific hunk

### Comprehensive Git Workflow Roadmap (Zed-style reference, adapted)

**Goal:** make OpenPi's Git surface mature enough for agent-assisted development: inspect history, understand branch/remote state, review agent edits, stage safely, commit cleanly, and sync deliberately without leaving the workbench. Zed is the interaction reference, but OpenPi must adapt it around agent safety, main-owned Git authority, and review-before-commit workflows.

**Brutal screenshot audit — what is worth copying:**
- Zed's Git graph works because history, branch labels, author/date/short SHA, selected commit details, changed-file list, and `View on GitHub` are visible in one flow; OpenPi needs that same traceability before users trust agent commits.
- Branch and stash pickers are compact and keyboard-friendly: `Branches` / `Stash` tabs, search-first switching, current-branch checkmark, remote rows, and empty stash state. OpenPi should copy the workflow, not the exact visual density.
- The right source-control dock has strong state signaling: empty `No changes to commit`, disabled `Stage All`, branch chip, fetch/sync dropdown, commit message box, and commit-mode dropdown. OpenPi should keep these affordances because they reduce accidental Git actions.
- Remote operations are explicit menu choices (`Fetch`, `Fetch From`, `Pull`, `Pull (Rebase)`, `Push`, `Push To`, `Force Push`) with shortcuts shown. OpenPi should expose the choices but gate destructive/high-risk actions.
- Commit actions include `Commit Tracked`, `Amend`, and `Signoff`; OpenPi should support these as deliberate modes only after staged/tracked file semantics are clear.

**What not to copy blindly:**
- Do not turn OpenPi into a full Zed/VS Code clone: no broad source editor, no always-primary history graph, and no Git feature that competes with the agent conversation unless it improves review/commit safety.
- Do not expose `Force Push`, checkout, reset, discard, amend, or rebase as one-click actions; require confirmation, clear affected branch/remote labels, and main-process policy checks.
- Do not let renderer code compute Git truth or execute Git commands. Renderer shows intent only; Electron main owns status, refs, diffs, staging, commits, sync, and conflict detection.
- Do not hide empty/error states. `No changes`, `No stashes`, detached HEAD, missing upstream, merge/rebase in progress, and auth failures need explicit UI states.

**Build in thin slices:**
1. **Git read model v2:** main-owned snapshot containing worktree status, staged vs unstaged files, branch, upstream, ahead/behind counts, remotes, tags, stash count, merge/rebase/cherry-pick state, and last fetch time.
2. **Source-control panel v2:** grouped `Staged` / `Unstaged` / `Untracked` sections, per-file stage/unstage/discard intent buttons, `Stage All` disabled when unsafe, empty-state copy, and visible branch/upstream/ahead-behind status.
3. **Commit composer v2:** commit summary/body fields, author preview, signoff toggle, amend mode, commit tracked vs commit staged distinction, validation for empty messages/no staged files, and optional AI draft commit message based on the selected diff.
4. **Remote sync menu:** fetch, fetch-from, pull, pull-rebase, push, push-to, and force-push entries with disabled states, shortcut hints, progress output, and protected-branch/high-risk confirmation gates.
5. **Branch/stash picker:** search-first branch switcher with local/remote grouping, current branch checkmark, create branch action, checkout confirmation for dirty worktrees, stash list/apply/pop/drop with empty/error states.
6. **History graph:** searchable commit list with simple graph lanes, branch/remote labels, author/date/short SHA columns, selected commit details, changed files with stats, and GitHub/open-remote links when a remote URL is recognized.
7. **Review-first diff integration:** selected history commit or changed file opens the split diff viewer; hunk stage/unstage/revert operates through main-owned patch application with preview and rollback on failure.
8. **Conflict and operation states:** show merge/rebase/cherry-pick in progress, conflicted files, continue/abort intent buttons, and clear blockers instead of pretending normal commit flow still applies.
9. **Agent-aware Git workflow:** after a Pi turn modifies files, pin the changed-file set, offer `Review agent changes`, optionally generate a commit message from the diff, and never commit files outside the user's selected scope.

**Acceptance criteria:**
- Worktree status matches `git status --porcelain=v2 --branch` and staged/unstaged sections match `git diff --name-status` / `git diff --cached --name-status` fixture repos.
- Ahead/behind, upstream, remotes, and branch labels match `git branch -vv` and `git for-each-ref` fixtures, including detached HEAD and no-upstream cases.
- Remote sync actions surface progress and failures; force push, rebase, reset/discard, and checkout with dirty worktree require explicit confirmation.
- Commit actions never use `git add .` or `git add -A`; tests assert only selected paths are staged or committed.
- History graph can open selected commit details and changed-file diffs without blocking the live source-control panel.
- Stash and branch pickers have keyboard search, empty states, and safe dirty-worktree behavior.
- Agent-generated commit messages are suggestions only; user can inspect diff and edit before committing.
- Renderer has no Git execution path; all Git tests exercise Electron-main modules or pure adapters with fixture repos.

---

## Phase 6 — Trust, Policy, and Release Hardening

**Status:** ✅ Implemented (9/10 — see blocker below). Build slices 1–9 are done: workspace trust model, resource provenance inventory, extension/package enablement gates, protected path policy, high-risk mutation confirmation, secret storage and redaction, settings/capability surface, diagnostics/export bundle, and SQLite durability/startup safety. All live in `electron/protectedPaths.ts`, `electron/secretRedact.ts`, `electron/customizations.ts`, `electron/sessionIndex.ts`, and their IPC handlers in `electron/main.ts`.

**Remaining blocker:** slice 10 (release signing/notarization) requires Apple Developer secrets and a Windows signing plan — secrets that OpenPi cannot provision in code. CI infra is ready (`.github/workflows/release.yml:76-80`); the org needs to supply APPLE_ID, CSC_LINK, etc. The roadmap will be updated when signing is live.

---

## Phase 7 — Agent Workbench Quality

**Goal:** make OpenPi feel like a polished workbench, not a Pi SDK shell. The trust layer is solid (Phase 6); now invest in the surfaces the user touches every session.

Build in thin slices:

1. **Testing strategy execution** — `docs/TEST_MATRIX.md` has 34 rows missing evidence. Write the missing tests: IPC Zod roundtrips, fake AgentSession fixtures, SQLite session-index upserts, PTY smoke, permission gate tests. Clear the harness lint warning as a gating step.
2. **Subagent/task card widgets** — Pi SDK emits `Agent`/`TaskCreate`/`TaskExecute` events. Render them as first-class interactive cards: expand/collapse agent output, show task dependencies and status, expose abort/kill/re-execute.
3. **Diff review cards** — when Pi proposes an edit, show a side-by-side diff card before apply, with accept/reject/hunk-selection controls. Stage reviews in a queue; batch into a commit workflow from the review surface.
4. **Session map v2** — visualize session tree branches, fork points, compaction summaries, labels. Click-to-navigate, inline fork/create actions from any node.
5. **Plan overlay polish** — live step tracking with elapsed-time per step, mini progress bar, abort-step button. Persist plan state across session reloads so interrupted plans survive app restart.
6. **Workbench context bridge** — lazily supply cwd, visible file path, and recent terminal output to the agent's tool context (following Terax's `ToolContext` pattern). Let the agent know what the user is looking at.
7. **Live token/cost per turn** — surface turn-level token counts and estimated cost in the conversation header during streaming, not only in a post-agent-end summary.
8. **Electron auto-updater wire-up** — connect `electron-updater` to the release workflow for in-app update notifications with delta/blockmap support.

Acceptance criteria:
- `npm test` passes and includes tests for IPC, session index, PTY, and permission gates.
- Harness test-matrix lint reports 0 missing evidence rows.
- Subagent/task cards render agent output with expand/collapse and abort controls.
- Agent-proposed edits appear as reviewable diff cards before touching disk.
- Session tree view shows branching with click-to-navigate and fork actions.
- Plan overlay shows live step state with elapsed-time per step.
- Auto-updater notifies on new release and installs without user intervention beyond confirmation.

---

## Testing Strategy

Each phase gets the smallest reliable verification for its slice.

| Layer | Tests |
|---|---|
| IPC contracts | Zod schema roundtrip tests for every channel |
| Pi SDK integration | Fake `AgentSession` with deterministic event fixtures |
| Session index | SQLite upsert/query tests with fixture JSONL files |
| Renderer | Component tests for critical state (streaming, queue, tool cards) |
| PTY | Smoke tests: spawn shell, echo command, resize, exit |
| Diff/patch | Unit tests with fixture repos; accept/reject via git apply |
| Permission | Gate tests: blocked paths, destructive command detection |
| E2E | Playwright: open workspace → prompt → see tool cards → diff |

---

## Non-Goals Until Proven Necessary

- Subprocess RPC isolation for Pi SDK (add when process isolation is proven needed)
- Cloud sync or collaboration
- Plugin marketplace
- Full IDE (Monaco for editing, not for replacing VS Code)
- Custom Rust UI renderer
- Mobile
- Scheduler / cloud agents
- Automatic third-party package installation
- Rewriting Pi's agent runtime
- Forking Warp or OpenWarp
