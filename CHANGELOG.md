# Changelog

## [Unreleased]

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
