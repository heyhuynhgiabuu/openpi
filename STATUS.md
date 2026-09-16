# OpenPi — Current Status

Surface state of the desktop workbench as of the latest release. Not a rule surface; for project rules see `AGENTS.md`. For direction and phases see `ROADMAP.md`.

## Mission

OpenPi is a **human-enabling workbench** for [Pi](https://pi.dev) (`@earendil-works/pi-coding-agent`): make sessions **visible** and **steerable**, keep the **MIT agent core** in Pi (not a second runtime), and treat the user as the **quality gate** — aligned with Pi’s minimal harness and inspectability goals. See **Philosophy** in `ROADMAP.md`.

## Beta (v0.2.13)

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
 - Pi-task agent catalog in the composer: `@mention` suggestions come from pi-task's own discovery (bundled < user < project precedence, hidden agents excluded) with provenance and read-only badges; empty when pi-task is not installed.
 - Session export (`/export-session`): byte-exact Pi JSONL copy + referenced pi-task sub-sessions + SHA-256 manifest, written by Electron main to a user-picked folder with a secrets warning; path authority reuses the session containment rules.
 - Trajectory ledger: the session map overlay toggles between the branch tree and a chronological ledger of the current branch with per-entry timing/tokens/cost from the session index; rows deep-link into the conversation.
 - Agent review: unified Review tab now has a source dropdown for `Git changes` vs `Last turn changes`; last-turn mode uses agent snapshots, file accordions, proper diff rendering, Keep/Revert/Revert all, coalesces repeated edits per file, and supports diff line comments with hover `+`, content-row multi-select, saved annotations, composer chips, and structured `<file_comment>` prompt context.
 - Pre-apply review (v0.2.11): opt-in gate (**Settings → General → Agent policy**, or `OPENPI_PREAPPLY_REVIEW=1`; the sidecar reads it at spawn, so it lands after an app restart) that stops Pi's `edit`/`write` before the write lands. Inside OpenPi an `edit` opens a hunk review where unselected hunks are dropped from the call, so Pi's own tool applies exactly what was kept; `write` is whole-file allow/deny through a text confirm; `bash` writes stay ungated.
 - Session map (v0.2.10): `/map` opens the whole session tree as an overlay — every root-to-leaf branch, the current-leaf marker, jump to an entry, text filter, branch switching through Pi's tree navigation, and live refresh while Pi writes entries.
 - CI: PR/main checks (lint, typecheck, tests on Ubuntu and Windows, build on four platforms, Electron launch smoke on Linux); tag-triggered beta releases (macOS/Windows/Linux). **Signing/notarization not configured.**
- **Phase 7 P0:** live token/cost per turn in the composer badge, hunk-level Keep/Revert for last-turn review, empty history page while Pi flushes a new session (#7).

### Next (Phase 7 — see ROADMAP)

- **P0:** broader critical-path `npm test` coverage. Pre-apply gate: `write` now routes through the hunk review modal (one contiguous region, all-or-nothing; unanswered reviews warn and deny); `bash` writes stay ungated by decision. The gate's end-to-end check needs a model, so it stays manual — a live run in `pi --mode rpc` with the gate on confirmed Pi applies exactly the approved hunk subset, and a run without `OPENPI_BRIDGE_APP` fell back to the text confirm instead of leaking the marker payload; CI covers the gate per seam.

- **P1:** subagent/task card polish — the live tray's elapsed timer now ticks (it froze at first render); the conversation card already carries expand/collapse, background-task cancel, and sub-session navigation.
- **P2:** terminal-snippet leg of the workbench context bridge, signed/notarized auto-update rollout.

## Open review follow-ups

- Per-turn usage attributes a summarization call to the last assistant turn in file order. A `model_change` between that turn and the compaction (15 of 160 locally) credits the summary's tokens to the earlier model in per-model buckets, and a branch switch could point at a turn on another branch; walking the compaction's parent chain would be the precise fix.
- Session totals count assistant messages plus the summarization calls on `compaction`/`branch_summary` entries. Pi's own `getSessionStats` also counts `toolResult` message usage; OpenPi does not, and no entry in the local corpus carries it, so it is a gap rather than a live discrepancy.
- The loader test runs the loaded `tool_call` handler through Pi's extension loader (the deny path), but `session_start` and `turn_end` are still only counted there, not executed; their behavior is covered by the direct unit tests.
- The search fallback treats `mode: 'fuzzy'` as a literal search (it cannot rank fuzzy hits), returns one entry per occurrence where the native index returns one per line, and skips `dist`/`out`/`release` where the native index walks them. `timeBudgetMs: 0` means "stop now" rather than the native's "no limit", which the IPC schema cannot produce because it requires a positive value.
- The fallback checks its time budget once per directory, so one directory with a very large number of files is still walked to the end. The native index truncates a matched line at 512 bytes; the fallback does not.
- The search highlight range mapping assumes the line was decoded from the bytes the native offsets point into. That holds except for invalid UTF-8, where a lossy replacement character is treated as the single byte it came from; a genuinely invalid multi-byte sequence can still shift a highlight.
- `isThemeApplied()` reports true for a palette whose tokens OpenPi cannot map, because `applyThemeTokens` still mirrors the six `index.css` shiki defaults into a stored snapshot. Nothing from such a theme reaches the UI, so the Customizations pane claims a custom theme is active. Whether that should count needs a product decision; the tests pin today's behaviour.
- "Collapse All Groups" is marked deferred in `ROADMAP.md` (Phase 1): the state that would have driven it was removed as dead code, so if it is still intended it has to be built, not re-wired.
- `GitFileDiff.isNew` and `isDeleted` have no consumer in `src/` — only the IPC schema declares them. `isNew` is also computed inconsistently: the unstaged, auto and branch scopes plus `getGitStagedDiff`/`getGitBranchDiff` derive it from `added > 0 && removed === 0` (so an existing file with only additions is marked new), while the staged file scope and `getGitCommitDiff` always send `false`. Deciding what they should mean, or deleting them, needs a product call.
- `getGitStatus` combines staged and working-tree line counts for files with index changes, so a file that is staged and then modified again (`MM`) shows both deltas in one row. Because `GitChangedFile` has one count pair, that row can differ from a scope-specific diff pane.
- Branch scope builds its patch from `git diff base...HEAD` but reads `newContent` from the working tree, so the split view can show content the patch does not describe while the tree is dirty. The patch's old side is the merge base, not `base` itself, which `oldContent` also ignores. Which of the two the review should show needs a decision; `tests/scopeDiff.test.ts` pins today's behavior only for a clean tree.
- The line counters live in `src/lib/diffCount.ts`, shared by the Git host and the renderer. Hunk-state tracking replaced prefix sniffing, so content that is exactly `-- ` or `++ ` counts, and lines outside a hunk do not. A combined hunk from an unmerged path counts its first column, which is stage 2 ("ours") and matches `git diff HEAD --numstat` for the same path; the tests assert that agreement across three conflict shapes rather than a hand-picked total.
- Forced colour defeats both counters: with `color.ui=always` every patch line carries an ANSI prefix, so no hunk header is recognised and the counts come out zero. `simple-git` pipes stdout so `auto` never colourises, and no git call passes `--no-color`.
- `splitRawPatch` splits on `@@ ` headers, so a combined (`@@@`) patch from an unmerged path yields no hunk rows and the hunk-action list is silently empty there, with no per-hunk count to disagree with the pane.
- `EditToolRow` renders its own `+N/-N` from the edit's old and new text, which counts content lines rather than patch lines, and has no test. `agentReviewDiff` counts its own `line.kind` values on purpose. Neither is a second patch counter.
- An unmerged path reports its row counts from the staged numstat map (`0/0`) while the diff pane shows the combined-diff count, so the Git panel row and the pane header disagree until the conflict is resolved.
- For a conflict that has been resolved in the working tree but not staged, git emits a combined patch with headers and no hunk at all, so the pane shows no diff and `isDeleted` stays false while `git diff HEAD --numstat` reports the deletion. Diffing an unmerged path against `HEAD` or `AUTO_MERGE` instead would show the resolution; the counter is faithful to the patch it is given.
- `resolveGitDir`'s relative-path branch cannot be pinned portably: `path.resolve` and `path.join` differ only on Windows, where `git rev-parse --git-dir` prints a drive-qualified absolute path, and the helper uses the ambient `node:path`.
- `getGitFileDiff` repeats the same untracked-fallback block in its `unstaged` and `auto` branches, and `electron/git/gitDiffStatus.ts` is 528 lines against the 300-line rule.
- `useOpenPiSession` also forwards `groupBy`, `sortBy`, `showRecent`, `sessionQuery`, `setGroupBy`, `setSortBy`, `setShowRecent`, `setSessionQuery`, `loadWorkspacePreview` and `setSelectedWorkspacePath` with no component reader. The same evidence method that retired `collapsedGroups` applies to them; removing them is a separate decision.
- `src/hooks/useOpenPiSession.ts` is over 800 lines against the 300-line rule, so its read-model surface and its session wiring still need splitting.
- Session IPC authorization and read-model handlers were extracted from `electron/session/ipc.ts` into `sessionAuth.ts` / `inspectionIpc.ts` / `lifecycleIpc.ts` (ipc.ts is now 230 lines). `electron/pi/sidecar.ts` (1056 → 183, split into context/env/slash-prompt/event-bridge/lifecycle plus four command-domain modules) and `src/hooks/useOpenPiSession.ts` (814 → 296, split into event pipe / actions / IPC wiring / task polling / task-card resolvers) are decomposed. A full scan now finds 25 files over the cap (~2,900 excess lines); the largest remaining: `FileTree.tsx` 504, `git/ipc.ts` 494, `keybindings.ts` 487, `Composer.tsx` 485 — all modest overruns rather than megafiles. The monotonic policy audit is recorded in `docs/audits/2026-09-15-monotonic-policy-audit.md`.
- Nothing renders a workspace group label: the only caller that reads one is `Homescreen.tsx`, which groups by time. The workspace branch of `groupSessions` is exercised only by tests.
- `src/components/FileTabBar.tsx` has no component test, so its diff-tab icon branch is only covered indirectly through `src/lib/previewTabs.ts`'s tests (which now pin the literal tab id).
- `src/components/conversation/ConversationPane.tsx` keeps a second `formatRelativeTime` with a different style (`5 minutes ago` vs `5m`) and a non-finite guard the shared helper lacked before this change. Consolidating them means choosing one style for both surfaces.
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