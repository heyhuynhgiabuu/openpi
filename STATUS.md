# OpenPi — Current Status

Surface state of the desktop workbench as of the latest release. Not a rule surface; for project rules see `AGENTS.md`. For direction and phases see `ROADMAP.md`.

## Mission

OpenPi is a **human-enabling workbench** for [Pi](https://pi.dev) (`@earendil-works/pi-coding-agent`): make sessions **visible** and **steerable**, keep the **MIT agent core** in Pi (not a second runtime), and treat the user as the **quality gate** — aligned with Pi’s minimal harness and inspectability goals. See **Philosophy** in `ROADMAP.md`.

## Beta (v0.2.9)

### Shipped

- Secure Electron main/preload boundary (Zod IPC, sandboxed renderer, main-owned FS/PTY/Git).
- Pi session host: streaming conversation, model controls, steer/follow-up queues, abort, fork, rename.
- Workspace/session sidebar: search/sort/group, pin/archive, token/cost badges, Git branch metadata.
- Customizations: Extensions, Skills, Prompts, Themes, Packages, Settings, General, Keybindings; Pi 0.85.0 `ModelRuntime` authentication with API-key and supported account-login flows.
- Command palette (`⇧⌘P`): commands, `fff` files, sessions.
- Git panel, file tree/search, CM6 file viewer, split diff viewer (main-owned Git).
- Terminal/output panel: multi-tab PTY, renameable tabs, exit indicators.
- **Trust (Phase 6):** workspace trust, extension/package install confirms, protected paths, high-risk shell/Git mutation prompts, secret redaction, diagnostics export bundle, SQLite hardening.
- **Pi-task delegation:** `@heyhuynhgiabuu/pi-task` `task` tool; task history + live task widget; click a `task` tool row to navigate to the sub-session; install via Pi packages (`pi install npm:@heyhuynhgiabuu/pi-task`).
 - Conversation polish: live token counter (streaming), code line numbers, tool cards.
 - Agent review: unified Review tab now has a source dropdown for `Git changes` vs `Last turn changes`; last-turn mode uses agent snapshots, file accordions, proper diff rendering, Keep/Revert/Revert all, coalesces repeated edits per file, and supports diff line comments with hover `+`, content-row multi-select, saved annotations, composer chips, and structured `<file_comment>` prompt context.
 - CI: PR/main checks; tag-triggered beta releases (macOS/Windows/Linux). **Signing/notarization not configured.**
- **Phase 7 P0:** live token/cost per turn in the composer badge, hunk-level Keep/Revert for last-turn review, empty history page while Pi flushes a new session (#7).

### Next (Phase 7 — see ROADMAP)

- **P0:** pre-apply diff review — implemented on `main` and unreleased as the opt-in `.pi/extensions/openpi-preapply-review/` gate, enabled from **Settings → General → Agent policy** (or `OPENPI_PREAPPLY_REVIEW=1` in the app environment; the sidecar reads it at spawn, so the change lands after an app restart). It uses Pi's `tool_call` hook to stop a write before it lands. Inside OpenPi the gate sends the hunks of an `edit` call to a review modal where the user picks which ones to keep (or skips review until the turn ends); unselected entries are dropped from the call, so Pi's own tool applies the rest and its result diff tells the model what was skipped. The review waits ten minutes instead of Pi's two-minute dialog default, and an unanswered review is reported rather than applied. `write` stays whole-file allow/deny (a rewrite has no hunk to drop) and is reviewed through a text confirm that now waits the same ten minutes; because a boolean confirm cannot tell a denial from an expiry, its refusal is worded for both and it does not notify, so routing `write` through the review modal is still open. `bash` writes stay ungated. Outside OpenPi the gate falls back to a text confirm. Broader critical-path `npm test` coverage. A deletion-only edit (`newText: ''`) and a write that truncates a file used to skip the gate entirely — an empty string was treated as a missing field — and both are now reviewed. Review snapshots and revert writes go through the same containment authority as file IPC, so a symlinked path can no longer read or write outside the workspace. A manual live check (real model in `pi --mode rpc`, gate on, only the first hunk approved) confirmed Pi applies exactly the approved subset and leaves the rest of the file untouched; the same run without `OPENPI_BRIDGE_APP` fell back to the text confirm instead of leaking the marker payload. That check is manual — it needs a model, so it cannot run in CI.

- **P1:** Session map v2 is implemented on `main` and unreleased: read-only tree overlay, keyboard navigation, jump to an entry, text filter, branch switching through Pi's tree navigation, live refresh while Pi writes entries. Remaining: subagent card polish.
- **P2:** Workbench context bridge, signed/notarized auto-update rollout.

## Open review follow-ups

- Per-turn usage attributes a summarization call to the last assistant turn in file order. A `model_change` between that turn and the compaction (15 of 160 locally) credits the summary's tokens to the earlier model in per-model buckets, and a branch switch could point at a turn on another branch; walking the compaction's parent chain would be the precise fix.
- Session totals count assistant messages plus the summarization calls on `compaction`/`branch_summary` entries. Pi's own `getSessionStats` also counts `toolResult` message usage; OpenPi does not, and no entry in the local corpus carries it, so it is a gap rather than a live discrepancy.
- Review reads a path, not a file descriptor, so a swap that lands after the resolver runs can still put outside content into a review diff. Display only — reverts re-resolve and refuse — and both `captureToolStart` and `captureToolEnd` have the window; closing it means reading through `readWorkspaceBytes`-style `O_NOFOLLOW` plus a dev/ino check.
- The gate ignores the tool-call signal while a modal is open, so an aborted run leaves the modal until it is answered or the ten-minute timeout expires. The write is never applied either way.
- `readWorkspaceBytes`'s dev/ino branch (a file replaced between open and check) has no test; it needs fs injection to be deterministic.
- The loader test pins which handlers the gate registers, not what they do: a no-op `session_start` handler would still pass it.
- The search fallback treats `mode: 'fuzzy'` as a literal search (it cannot rank fuzzy hits), returns one entry per occurrence where the native index returns one per line, and skips `dist`/`out`/`release` where the native index walks them. `timeBudgetMs: 0` means "stop now" rather than the native's "no limit", which the IPC schema cannot produce because it requires a positive value.
- The fallback checks its time budget once per directory, so one directory with a very large number of files is still walked to the end. The native index truncates a matched line at 512 bytes; the fallback does not.
- The search highlight range mapping assumes the line was decoded from the bytes the native offsets point into. That holds except for invalid UTF-8, where a lossy replacement character is treated as the single byte it came from; a genuinely invalid multi-byte sequence can still shift a highlight.
- `electron/git/ipc.ts:385` returns `{ message }` from the commit-message generator without the `generateCommitMessageResultSchema.parse(...)` its neighbouring handlers use.
- Extension discovery does not read a directory's `package.json` `pi.extensions` manifest, which is how Pi resolves a package-shaped extension directory: such an extension shows nothing in the panel, or shows its `index.ts` where Pi loads the manifest entries instead. It also lists files Pi will not load (gitignored entries, and siblings of a root-level `index.ts`), and a configured `settings.json` path pointing at a file other than `.ts`/`.js` is loaded by Pi but invisible here. All four are behavior changes in what the panel lists, so they wait for a decision.
- `gitCommitMessage.ts` scope rules `^electron/piSidecar` and `^src/components/session/` match no real path; the legacy `^electron/gitHost` rule is pinned by `tests/gitHostFileTree.test.ts`. Its test file also still builds fixtures with `as never` and the stale `additions`/`deletions` field names.

## Known constraints

- macOS primary; other platforms less tested.
- Pi SDK pinned at 0.85.0. Upstream packaging bug: `pi-coding-agent` 0.85.0 statically imports `@earendil-works/pi-server` from `main.js` without declaring it, so OpenPi hosts it as a direct dependency until upstream declares it (drop the pin after upgrading past the fix).
- Packaging via `electron-builder`; in-app updates are wired, but signed/notarized release artifacts remain required before broad rollout.
- Single-user, local-only, no cloud sync.
- Pi defaults to **YOLO**; OpenPi adds **optional** desktop policy rails — users can still install Pi [example extensions](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions) for TUI-style gates.

## References

- Pi posts: [coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/), [slow down](https://mariozechner.at/posts/2026-03-25-thoughts-on-slowing-the-fuck-down/), [Earendil](https://mariozechner.at/posts/2026-04-08-ive-sold-out/)
- Upstream: [earendil-works/pi](https://github.com/earendil-works/pi), [pi.dev](https://pi.dev)