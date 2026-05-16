# Changelog

## [Unreleased]

### Added

- **Rich compaction card** — compaction events now surface the full file context that Pi's TUI shows. After auto-compact, a collapsible "files" badge appears inline with the `Compacted from N tokens` pill. Expanding it shows `Modified` and `Read` file lists (pill-tagged with amber/neutral colours) extracted from the SDK `CompactionResult.details`. The `reason` field (`manual`/`threshold`/`overflow`) is also reflected in the card text (e.g. "Manually compacted from N tokens").

### Fixed

- **Add context file picker invisible** — `overflow: hidden` on `.composer-toolbar` and `.composer-toolbar-left` was clipping the absolutely-positioned `.ctx-picker` before it could extend above the toolbar. Changed both to `overflow: visible`; per-label text truncation (`.composer-tool-label`) is unaffected since it has its own `max-width`/`overflow: hidden`/`text-overflow: ellipsis`.

## [0.1.13] - 2026-05-16

OpenPi v0.1.13 focuses on the desktop workbench experience: persistent file preview tabs, a bottom utility bar, safer archived-session cleanup, smoother composer history recall, and more reliable markdown/code rendering.

### Added

- **Center file preview pane** — workspace files now open in the main workbench surface with tabs, editable line-numbered text, markdown/code preview, image preview, save support, find/replace, minimap, and file-line comment chips for agent context.
- **Bottom utility bar** — added a compact bottom bar for thread/workspace navigation, Git/file/terminal panel toggles, app update status, and live Git sync feedback.
- **Workspace pane** — added a workspace-focused left drawer showing recent project roots, active workspace state, session counts, and quick “new thread in workspace” actions.
- **Movable Git panel** — the source-control panel can be dragged to the left or right of the conversation pane, with its side persisted across launches.
- **Branch/stash picker overlay** — Git refs now open from the top bar as a floating picker for local branches, remote branches, and stashes.
- **Composer prompt history** — pressing ↑ in the composer recalls previous user prompts, with ↓ returning toward the saved draft.
- **Output history buffer** — startup, sidecar, update, and crash output emitted before the Output pane opens is now replayed when the pane mounts.

### Changed

- **Git layout** — split the Git file tree into its own file panel and streamlined the source-control panel around changes, history, commit composition, and sync actions.
- **Markdown rendering** — message markdown now uses a cached Shiki-backed parser, code-block copy buttons, table wrappers, language alias handling, and theme-aware syntax colors.
- **Shiki loading** — syntax highlighting uses bundled dark/light themes and the JavaScript regex engine to avoid CSP/WebAssembly startup failures.
- **File preview search controls** — replaced the show/hide replace, replace-next, and replace-all controls with clearer Lucide icons.
- **Sidebar filter menu** — anchored the filter/sort menu to the sidebar toolbar so it no longer clips off-screen.

### Fixed

- **Archived session deletion safety** — deleting archived sessions now requires confirmation, only accepts `.jsonl.archived` files under Pi’s sessions directory, validates symlinks with real paths, and moves files to the system Trash instead of permanently unlinking them.
- **Workspace image preview boundary** — `localfile://` image serving is constrained to regular files inside the active workspace, preventing renderer-originated previews from reading arbitrary local paths.
- **Markdown injection hardening** — code-block language labels and fallback code HTML are escaped, and rendered markdown is sanitized before insertion into the renderer.
- **Release lint gate** — reformatted changed files so `npm run lint` is clean before the version bump.

## [0.1.12] - 2026-05-15

OpenPi v0.1.12 fixes fork-from-message crashes, the GitHub Copilot device-code login flow, and a silent extension-loading failure that caused global Pi extensions (e.g. `copilot-provider.ts`) to be bypassed even when shown as Active. Also fixes slash prompt/skill expansion and refreshes icon assets.

### Fixed

- **Fork from message** — forking a conversation from a streamed assistant message no longer throws `Entry u-<timestamp> not found`. Streamed messages carry synthetic `u-`/`a-`-prefixed IDs; the sidecar now resolves these back to real 8-char hex entry IDs by matching timestamps against the Pi session tree before calling `createBranchedSession`.
- **GitHub Copilot device-code login** — the OAuth `auth` event (carrying the device verification URL and user code) was silently dropped when it fired while the modal was in the `prompting` phase (the enterprise-domain prompt precedes the device-code step). The `auth` handler now also accepts `phase === 'prompting'`, and the user code is extracted from the `instructions` string and shown with a copy button instead of as raw text.
- **Global extensions not loading when workspace is untrusted** — `additionalExtensionPaths` was passed `agentDir/extensions/` (the extensions folder itself). The Pi SDK treats that argument as a package root and looks for an `extensions/extensions/` subdirectory inside it; finding none, it falls back to adding the directory path as a file, which `jiti.import` then fails to load silently. The extension never registers its OAuth provider, so Pi falls back to built-in Copilot auth. Fixed by passing `agentDir` instead so the SDK correctly scans `agentDir/extensions/` for `.ts` files.
- **Slash prompt expansion** — selecting `/review` now sends exactly one leading slash, so Pi expands prompt templates from `.pi/prompts`, `~/.pi/agent/prompts`, settings, and packages instead of sending `//review` or plain text (`1baa166`).
- **Slash prompt context handling** — attached files, line comments, and loaded context are now combined after prompt-template expansion, so `/review` still applies the Markdown template when context is attached (`1baa166`).
- **Slash skill expansion** — `/skill:name` autocomplete and typed skill commands now use Pi's sidecar `DefaultResourceLoader` and expand before attached context is prepended, matching Pi SDK behavior (`1baa166`).

### Added

- **Task widget** — when a Pi session uses `pi-tasks`, a collapsible widget above the composer tracks live task state (pending → in-progress → completed) with subject, active form, and ✓/●/○ icons; clears automatically on new session.
- **Ask User Question modal** — when `pi-askuserquestion` poses structured questions, a floating modal above the composer renders radio/checkbox option rows, a free-text row, and N-of-M progress dots. Answers are forwarded via `steer()` while the agent is running or `followUp()` when idle, so responses reach Pi even when the extension self-disables in headless mode.
- **Subagent status widget** — when `pi-subagents` spawns background or foreground agents, a collapsible widget shows each agent's type, description, elapsed time, and status (running/queued/completed/failed) with a pulsing indicator for active agents.
- **Extension Active/Inactive status chips** — each extension card in the Customizations panel now shows an Active or Inactive chip. User-scope global extensions (`~/.pi/agent/extensions/`) are always Active; project-local extensions show Inactive with an inline trust banner when the workspace is not yet trusted.

### Changed

- **App icon refresh** — replaced packaged icon assets across macOS, Windows, Linux, and multi-size PNG outputs for the 0.1.12 beta.

## [0.1.11] - 2026-05-15

OpenPi v0.1.11 ships Phase 6: Trust, Policy, and Release Hardening — putting explicit security boundaries around Pi extensions, packages, file mutations, secrets, and release artifacts.

### Added

- **Workspace trust model** — new workspaces are untrusted by default; project-local extensions and packages are disabled until the user explicitly trusts the workspace (`a80e60c`). Trust state persisted in Electron-main–owned SQLite with an additive `trusted_at` column migration.
- **Resource provenance inventory** — every Extension, Skill, Prompt, Theme, and Package now shows path, scope (global/project/package), origin, risk level (`high`/`medium`/`low`), and last-modified timestamp in the Customizations panel (`f5d09cb`).
- **Extension/package enablement gates** — enabling project-local extensions displays a confirmation panel listing each extension path before trust is granted (`f328e4e`). Installing a Pi package shows a two-step confirmation with source, scope, and full-system-permissions warning before the install proceeds.
- **Protected path policy** — Electron main blocks or confirms writes to sensitive locations including `~/.ssh`, `~/.gnupg`, Pi AuthStorage, shell profiles, `.gitconfig`, `.git/objects`, and paths outside the trusted workspace (`f5d09cb`). Git stage and commit paths are validated before reaching `simple-git`.
- **High-risk mutation confirmations** — destructive shell commands (`rm -rf`, `git reset --hard`, `git clean`, force-push, rebase-abort, disk commands, `chmod 777`, `chown -R`) routed through Pi sidecar are intercepted and require Electron-main approval before forwarding (`c8a16b1`). Same gate applied to Git discard/revert, package install/remove, and workspace trust promotion.
- **Secret storage and redaction** — `electron/secretRedact.ts` redacts GitHub tokens, Anthropic/OpenAI API keys, AWS access keys, Bearer auth headers, and generic env-var assignments from logs, IPC output, and diagnostics bundles (`f5d09cb`).
- **Diagnostics export bundle** — General → Beta support diagnostics copies a redacted JSON bundle to clipboard with app/runtime/OS metadata, sidecar+session state, workspace trust, resource inventory, Git status, and SQLite file stats. Provider credentials owned by Pi AuthStorage are never read (`f328e4e`).
- **MCP capability clarification** — extension security note explicitly states that MCP server integration requires a Pi extension or package; Pi does not natively embed MCP (`297f279`).
- **SQLite durability hardening** — `PRAGMA synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000` applied on open; `wal_checkpoint(TRUNCATE)` on close; migration loop now covers all columns (`last_model`, `file_mtime`, `trusted_at`) so missing-column ALTER TABLE errors no longer crash cold starts (`f5d09cb`).
- **Release CI hardening** — per-platform artifact size verification (≥1MB), SHA-256 checksum merging into `checksums.txt`, macOS notarization conditional on `CSC_LINK` secret, Windows signing conditional on `WIN_CSC_LINK`, Homebrew tap post-update verification (`f5d09cb`).

### Changed

- Settings pane adds Model & Thinking, Compaction, Retry, Message Delivery, UI, Terminal, Shell, Sessions, and Resources sections driven by a declarative field schema — replaces the previous minimal form.
- `installPackage` / `removePackage` IPC handlers gate on Electron-main `confirmHighRiskMutation` dialog in addition to the renderer-side two-step confirmation.

### Fixed

- Cold-start SQLite crash when `last_model` or `file_mtime` columns were absent from an older DB.
- Trust state not invalidating cached Pi resource loader — cache key now includes `workspaceTrusted` so session restart after trust grant picks up extensions correctly.

## [0.1.10] - 2026-05-14

OpenPi v0.1.10 consolidates the CI hermetic fixes, packaged-app sidecar launch fix, Homebrew release automation, and Electron security upgrade.

### Added

- **Homebrew tap automation** — release publishing now updates `heyhuynhgiabuu/homebrew-openpi` automatically from the packaged arm64 DMG when `BREW_TAP_TOKEN` is configured (`1d7cab8`)

### Fixed

- **Packaged Pi sidecar launch crash** — packaged builds now force `utilityProcess.fork()` so the sidecar can load from Electron ASAR archives instead of crashing under standalone system `node` (`7ff4263`)
- **Electron security audit** — upgraded Electron from 37.x to 41.6.0 to resolve the high-severity advisories reported by `npm audit`, including AppleScript injection (`GHSA-5rqw-r77c-jp79`) and service-worker IPC spoofing (`GHSA-xj5x-m3f3-5x3h`), while staying on the latest native-addon-compatible stable line; `npm audit` now reports 0 vulnerabilities (`1a49f0b`)
- **Deprecated rebuild dependency** — removed unused `electron-rebuild@3.2.9` and replaced it with `@electron/rebuild@4.0.4`, eliminating transitive CVEs from outdated `tar`, `cacache`, and `node-gyp` versions (`1a49f0b`)
- **Native addon rebuild hook** — `npm ci` now runs `electron-rebuild -f -w better-sqlite3` so the development app starts with Electron's Node ABI instead of crashing on a host-Node build (`b7e4351`)
- **CI: npm lockfile sync** — regenerated `package-lock.json` with npm 10 peer/optional resolution so `npm ci` installs the Electron 41 and electron-builder 26 dependency graph cleanly on GitHub Actions (`d7dc5d5`)
- **Release workflow Homebrew guard** — moved the optional `BREW_TAP_TOKEN` check through job env so GitHub Actions no longer rejects the workflow before jobs are created (`ad13f54`)
- **CI: bare remote default branch** — `git init --bare` on ubuntu-latest defaults to `master`; tests now pass `-b main` explicitly so the bare remote's HEAD matches the branch we push (`19d670a`)
- **CI: hermetic git identity** — pin `GIT_AUTHOR_*` / `GIT_COMMITTER_*` env vars in the git integration test file so runners with no global git identity don't fail commits (`6558204`)


## [0.1.9] - 2026-05-14

OpenPi v0.1.9 ships Phase 5 Git workflow, merge conflict resolution UI, and two critical bug fixes for slash commands and skill injection.

### Added

- **Git: enriched status** — upstream tracking, detached HEAD detection, conflict chip, in-progress operation (merge/rebase/cherry-pick), stash count in panel header (`12354bb`)
- **Git: remote sync menu** — fetch, pull, pull-rebase, push with confirmation gates; icon-only sync button (`7885eee`)
- **Git: branch and stash picker** — search-first; dirty-worktree guard blocks unsafe checkout (`4858694`)
- **Git: history graph tab** — `git log --graph` ASCII lane rendering, commit search, selected commit details pane with per-file `+N/-N` stats (`70c3134`, `86312a4`, `ce4dc18`)
- **Git: side-by-side diff viewer** — replaced custom unified renderer with `@pierre/diffs` `FileDiff`; `containerWrapper` mount path so shadow DOM split layout applies correctly (`e4d69f0`)
- **Git: agent-aware commit workflow** — `AGENT_CHANGED_FILES` event fires after `agent_end` when uncommitted changes exist; dismissible banner in Changes tab; ✨ sparkle button generates conventional-commit messages via local heuristics (`e4d69f0`)
- **Git: Zed-style commit composer** — dark composer box, segmented Commit Staged / options / push control; amend and signoff toggles wired through `git commit --amend/--signoff` in Electron main (`e4d69f0`)
- **Git: file save in viewer** — `WRITE_FILE` IPC (path-traversal validated, main-owned); Save button + `⌘S`; dirty/saved/error status badges in file viewer toolbar (`e4d69f0`)
- **Git: merge conflict resolution** — `ConflictResolverModal` using `@pierre/diffs` `UnresolvedFile`; conflicted files grouped under a Conflicts section (red heading) above Staged/Changes; accept current/incoming/both buttons; saves resolved content via `WRITE_FILE` and refreshes git status (`e4d69f0`)
- **Customizations: Pi package management** — install and remove Pi packages from the Packages pane (`27eadd1`)

### Fixed

- **Slash command / prompt template activation** — selecting from the `/` picker stripped the leading slash so `session.prompt()` received `review` instead of `/review`; the Pi SDK's `expandPromptTemplates` guard (`text.startsWith("/")`) skipped expansion entirely; restored `/${cmd.name}` prefix (`5b49015`)
- **Skill injection format** — chip-based skill context sent raw frontmatter and omitted the `location` attribute and `References are relative to …` note; now matches Pi SDK `_expandSkillCommand()` output exactly so relative script paths in skills resolve correctly (`b21a8a3`)
- **Compaction token wording** — copy now correctly shows `tokensBefore` context size rather than implying freed tokens (`1faf5a1`)
- **Native module ABI** — `better-sqlite3` and other native modules rebuilt against Electron's Node.js ABI via `electron-rebuild`; fixes packaged app crash on startup (`b7e4351`)
- **Pi SDK process isolation** — Pi SDK now runs in an isolated Node child process via the sidecar to avoid Electron renderer conflicts (`c390c9b`)

### Changed

- Sync and search buttons in Git panel header are icon-only for a cleaner toolbar (`dc622bc`)


## [0.1.8] - 2026-05-14

OpenPi v0.1.8 adds Homebrew cask distribution and makes the update chip point users toward Homebrew upgrades.

### Added

- **Homebrew cask distribution** — OpenPi can now be installed and upgraded from the `heyhuynhgiabuu/openpi` Homebrew tap with `brew install --cask openpi` and `brew upgrade --cask openpi`.

### Changed

- **Update chip behavior** — The in-app update chip now copies the Homebrew upgrade command instead of opening the GitHub release page, reducing manual download/install noise for beta users.

## [0.1.7] - 2026-05-14

OpenPi v0.1.7 fixes packaged-app fff native loading from ASAR/unpacked paths.

### Fixed

- **Packaged fff native loading** — Packaged macOS builds now import `@ff-labs/fff-node` from `app.asar.unpacked` so its `libfff_c.dylib` path resolves to a real file instead of the virtual `app.asar` archive path. `FileFinder.create()` is also guarded so native loader failures always fall back to filesystem search instead of surfacing as empty picker results.
- **fff cwd contract** — fff IPC now requires an explicit absolute workspace cwd from the renderer and no longer silently falls back to mutable Electron main session state.

## [0.1.6] - 2026-05-13

OpenPi v0.1.6 fixes fff-backed file search across workspace switches and hardens beta release publishing.

### Fixed

- **fff workspace targeting** — File search, content search, command palette file search, plus-button context picker, and inline `@` file mentions now pass the renderer's active workspace cwd through IPC instead of relying on Electron main's mutable session state. This prevents searches from running against a stale or wrong cwd while the visible UI is on another workspace.
- **fff empty-query and grep fallback** — Empty file searches now fall back to filesystem listing when native fff returns no items, and content grep has a bounded filesystem fallback when native fff is unavailable or returns no matches.

### Changed

- **Native fff packaging** — The `@ff-labs`, `ffi-rs`, and `@yuuang` native packages are explicitly unpacked from ASAR so their platform dylibs/binaries can be loaded reliably in packaged Electron builds.
- **Release artifact actions** — Beta release artifact upload/download steps use current GitHub action major versions to avoid Node 20 runtime deprecation warnings on future release runs.
- **Latest release visibility** — Beta release publishing uses normal GitHub Releases instead of prereleases so OpenPi's existing `/releases/latest` update check can see newly published versions.

## [0.1.5] - 2026-05-13

OpenPi v0.1.5 fixes the packaged-app file mention fallback path and hardens release automation so GitHub Releases always publish current changelog content.

### Fixed

- **File mention fallback after native fff import failure** — The fff host no longer imports `@ff-labs/fff-node` at module load time. If the native package fails to import in a packaged app, OpenPi now still loads the host module and uses filesystem fallback search instead of returning no file mention results.
- **GitHub release notes source** — The beta release workflow now extracts release bodies from the matching `CHANGELOG.md` version section, preventing stale `RELEASE_NOTES.md` content from being published to new GitHub Releases.
- **CI action runtime warnings** — CI and beta release workflows use current GitHub action major versions to avoid Node 20 deprecation warnings on GitHub-hosted runners.

### Changed

- **Release helper safeguards** — `scripts/release.mjs` now requires explicit release notes and refuses to generate placeholder-only changelog entries.

## [0.1.4] - 2026-05-13

OpenPi v0.1.4 hardens the file attachment picker, fixes workspace startup scoping, and documents stricter release-note requirements.

### Fixed

- **File mention picker reliability** — `@` file attachments now wait briefly for fff's cold-start scan and fall back to a bounded filesystem search if the native fff package is unavailable, quarantined, or temporarily returns no matches. This keeps queries like `@AG` finding `AGENTS.md` instead of showing a permanent "No files match" state.
- **Workspace startup scope** — startup restore and the workspace rail now use only workspaces explicitly opened in OpenPi. Historical Pi session directories discovered during indexing no longer pollute the rail or cause OpenPi to auto-restore the wrong workspace.
- **Ignore generated artifacts correctly** — `.gitignore` now uses standalone comments instead of inline comments after patterns, so generated `out/` and `release/` directories are actually ignored by Git.

### Changed

- **Release discipline** — Project rules now require every release to inspect commits since the previous tag and replace automation-generated placeholder changelog entries with concrete user-facing notes before tagging.

## [0.1.3] - 2026-05-13

OpenPi v0.1.3 improves update visibility, CI reliability, file attachments, Git/workspace synchronization, and beta documentation.

### Added

- **App self-update check** — OpenPi now checks GitHub Releases on cold start and exposes a sidebar update chip when a newer version is available. Unsigned beta builds open the release page in the browser instead of attempting an in-app auto-install.
- **What's New modal** — Added a sidebar changelog button that reads bundled `CHANGELOG.md` from app resources and renders release notes inside OpenPi.

### Fixed

- **Git panel workspace switching** — Git status polling and file-tree watching now restart on every `session_ready` event, so the persistent Git panel follows the active workspace instead of showing stale data from a previous workspace.
- **Initial `@` file picker failure** — Removed stale fff initialization tracking that could permanently return `[]` after a failed native `FileFinder.create()` attempt.
- **CI test environment** — Added a deterministic in-memory `localStorage` stub for Vitest and removed the undeclared optional `@testing-library/jest-dom` setup import, restoring clean `npm ci && npm test` behavior on GitHub Actions.
- **CI workflow compatibility** — Updated CI to use valid GitHub Actions versions, run verification with verbose test output, and compile on macOS, Linux, and Windows after verification passes.
- **Release version correction** — Deleted the accidental `v0.1.4` tag and restored the intended `v0.1.3` release line.

### Changed

- **Public wording** — Removed misleading "native" wording from docs and product text; OpenPi is described accurately as an Electron desktop workbench.
- **Release packaging** — Bundled `CHANGELOG.md` via `electron-builder` `extraResources` so packaged apps can show release notes offline.

## [0.1.2] - 2026-05-13

OpenPi v0.1.2 enables Pi package extensions in sessions and makes package-loading failures non-fatal.

### Fixed

- **Pi packages can load session extensions** — Removed the `noExtensions: true` resource-loader setting so user-configured Pi packages such as `@heyhuynhgiabuu/pi-diff`, `@heyhuynhgiabuu/pi-pretty`, and `@heyhuynhgiabuu/pi-search` can register their tools and extensions in OpenPi sessions.
- **Non-fatal package reload failures** — Wrapped Pi resource-loader reload paths so one failing package no longer crashes session startup.


## [0.1.1] - 2026-05-13

# OpenPi v0.1.1

Patch release with two bug fixes since v0.1.0.

## Fixes

- **npm ENOENT on Finder/Dock launch** — OpenPi now enriches `PATH` from the user's login shell before starting the Pi SDK, so packages configured with Pi (npm-backed Skills, Prompts, or Extensions) resolve correctly whether the app is launched from a terminal or directly from macOS Finder/Dock. Previously launching from Finder/Dock would log `Failed to run npm root -g: spawnSync npm ENOENT`.
- **Customizations modal sidebar** — Removed the broken logo image from the brand block at the bottom of the Customizations nav rail; only the app name and version label are shown.

## What is OpenPi?

OpenPi is a desktop workbench for the [Pi coding agent](https://github.com/earendil-works/pi). It wraps Pi's session tree, streaming conversation, extensions, skills, and customizations in an Electron + SolidJS UI.

OpenPi depends on `@earendil-works/pi-coding-agent` and intentionally does not reimplement Pi's session tree, compaction, queue semantics, tool execution, extensions, or provider behavior.

## Beta caveats

- macOS notarization and Windows code signing are not configured yet; expect OS trust warnings on downloaded installers.
- Permission gates, workspace trust hardening, and keychain-backed secrets are roadmap items before broad stable distribution.
- This beta is for early testers comfortable running local developer tools.


## [0.1.0] - 2026-05-13

Initial public beta for early testers.

- Added Electron + SolidJS desktop workbench for Pi sessions, workspace navigation, model selection, conversation streaming, and tool cards.
- Added OpenCode-style command palette (`Shift+Cmd+P`) for commands, files, and sessions.
- Added Customizations modal for Pi Extensions, Skills, Prompts, Themes, Packages, models, notifications, keybindings, updates, and app info.
- Added persistent Git/source-control panel with file tree, file search, diff viewer, and file viewer.
- Added bottom terminal/output panel backed by Electron main and `node-pty`.
- Added OpenPi app branding, runtime version metadata, icon packaging, CI, and tag-triggered beta builds.
