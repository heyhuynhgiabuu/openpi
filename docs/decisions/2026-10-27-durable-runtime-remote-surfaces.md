# Durable Runtime Migration and Remote Surfaces (SSH + Mobile)

- **Date:** 2026-10-27
- **Status:** Accepted (owner decision)
- **Supersedes:** the *deferral* in `2026-09-13-remote-access-deferred.md` (that document's security requirements remain binding; its "not now" verdict is lifted in staged form)
- **Tracking issue:** [#33](https://github.com/heyhuynhgiabuu/openpi/issues/33)

## Context

OpenPi today hosts `@earendil-works/pi-coding-agent` (SDK surface: `createAgentSession`, `SessionManager`, JSONL v3 session trees) in Electron main. Two product directions were approved by the owner on 2026-10-27:

1. Migrate the agent runtime from the pi-coding-agent SDK session surface to `@earendil-works/pi-durable`.
2. Add remote surfaces: SSH connectivity and a mobile client (phone as a **client**, desktop as the **host**).

Research that grounds this decision (all verified against sources, not inferred):

- **pi-durable is first-party**: same monorepo as Pi (`earendil-works/pi`, `packages/durable`), lockstep-versioned (1.4.0 alongside pi-coding-agent 1.4.0). README: <https://github.com/earendil-works/pi/blob/main/packages/durable/README.md>. It is marked **Experimental — "The API changes without notice between releases."**
- It provides a durable `Harness` over pluggable storage (Node SQLite with WAL, JSONL, Cloudflare Durable Objects, IndexedDB), crash-resumable tasks with restart limits and parking, `requestId` submission dedupe, `resume()` after process death, and `readOnly: true` sessions for viewer processes.
- It has feature parity with what OpenPi consumes today: `CodingTools` (read/write/edit/bash), codemode (QuickJS sandbox, restart-safe journals), `tool_search` with deferred tools, MCP as namespaced tools called via `api.executeTool` bridges, per-conversation agent choices, forks, compaction, subagents/child tasks, usage/spend documents.
- It is built for UIs and remote clients: `watch()` returns a structural view plus folded commit ops ("for example to a remote client that applies them"), and partial progress is committed on a bounded interval.
- The first-party remote stack exists but lags: `pi-server` 1.1.0 ("experimental local server that routes clients to application-hosted durable Sessions") and `pi-client` 1.1.0 ("Transport-neutral client for remote pi sessions over framed CBOR bytes").
- Prior art audit: `badlogic/pi-termux-mobile` (a fork of `jeamy/pi-termux-mobile`; no license, self-described prototype) demonstrates the Android-host + SSH-attach pattern and, equally important, supplies a **negative checklist**: bearer tokens in query strings, wildcard interface binds, a static shared secret for exec, and no approval gates anywhere. None of these patterns may be copied.

## Decision

1. **Adopt pi-durable as the target agent runtime**, migrated in stages (ROADMAP Phase 8) with the pi-coding-agent SDK path retained until cutover completes. This is not a second homegrown runtime: pi-durable is the Pi author's own runtime in the same repository.
2. **Build remote surfaces in stages** (ROADMAP Phase 9): desktop host exposes a paired, authenticated feed of `watch()` ops over SSH forwarding; a PWA mobile client goes read-only monitoring → approval gates → prompt/steer. Android/Termux local agent execution stays out of scope — the phone never runs the agent.
3. **Session history migrates, originals stay**: a one-time importer converts existing JSONL v3 sessions into durable conversations (SQLite); original files are never deleted or rewritten.

## Consequences and requirements

- **Experimental API churn is the top risk.** Pin the exact pi-durable version in `package.json` (same policy as the SDK pin, `SUPPORTED_PI_VERSION`); adapter modules own every pi-durable import so version bumps touch one directory; CI runs the shipped-path suites on every bump.
- **Parity obligations before cutover** (each currently provided by the SDK path): customizations (skills/prompts/themes become OpenPi-owned prompt sections and tools reading the existing directories), extension loading (user/project `.ts` extensions map to registry installs behind a compatibility loader), MCP config compat (`.pi/mcp.json` → bridges), trust/policy gates (`beforeTool` block hooks replace the pre-apply review extension), and the session tree browser (durable forks/resets render on the new model).
- **Renderer stays render-only.** The Harness lives in Electron main; the renderer keeps talking Zod-validated IPC. Remote clients are untrusted renderers: they go through the same main-process authorization, never around it.
- **Security requirements carried over from `2026-09-13-remote-access-deferred.md`**, plus the termux negative checklist: no tokens in URLs/query strings, no wildcard-interface binds, no static shared secrets, per-device pairing with revocable credentials, approval gates before any mutation surface is exposed remotely, and read-only before read-write in every stage.
- **Rollback**: if pi-durable proves unshippable (API churn, parity gaps), the cutover is a setting flip back to the SDK path. Scope of the promise: history created **before** migration is intact (originals preserved; the durable store is additive). Conversations created or extended **in** the durable store do not appear in the SDK session list — before cutover, a JSONL export path for durable conversations must exist, and rollback keeps the durable store openable read-only. No user data is lost, but newer history needs the export/viewer path to stay reachable.
