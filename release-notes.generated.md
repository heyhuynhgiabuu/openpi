# OpenPi v0.1.16 - 2026-05-18

### Added

- **Session Map panel** — interactive tree view of the Pi session tree with branch navigation, fork points, compaction summaries, label badges, and click-to-scroll. Redesigned as a Session Map with compact inspector density: inline summary header, hidden zero-metric cards, single-line normal entries, important-only metadata, smaller markers/rails, lighter solo active branch styling. Auto-refreshes when agent finishes a turn. (8fafe7c, 6269ecb)
- **Agent-aware Git workflow** — agent-changed files IPC emits file paths on agent end. Clickable agent banner in GitPanel with animated Kobalte tooltip showing changed file paths (status-colored, monospace font) with 300ms open delay and TooltipArrow. Filtered review view for agent-only files. AI commit message generation uses agent turn context when available. (8baeeef)
- **SVG commit graph** — colored lane dots (8-cycle colors) with vertical, diagonal, and horizontal connection lines replacing raw ASCII `<pre>` output. 14px column widths, 28px row height. (b18c6c1)
- **Ref badge labels** — branch, remote, tag, and HEAD badges parsed from `%D` refs format with distinct color-coded styling. (b18c6c1)
- **Commit diff viewer integration** — clicking a changed file in commit details opens the commit-version diff in the side-by-side DiffViewer via new `GET_COMMIT_DIFF` IPC. (b18c6c1)
- **Open on GitHub** — button in commit details when remote origin is detected as github.com (supports HTTPS and SSH remotes). (b18c6c1)
- **Branch picker enhancements** — inline create-branch input with duplicate checking. Stash apply, pop, and drop action buttons with color-coded hover states. (b18c6c1)
- **Inline AskWidget tray** — compose area inlined in the main panel instead of opening as a separate modal. (5bd0734)

### Changed

- **Session Map density** — compact inspector mode is now the default layout, reducing visual noise for long single-branch sessions. (6269ecb)
- **Code block line numbers** — always shown by default; removed the line-number toggle button. (2fddc7e)
- **User messages rendered as markdown** — user messages now render through the markdown pipeline for consistent formatting. (3a8cf74)

### Fixed

- **Sidecar session lifecycle** — `session_shutdown` emitted before `session.dispose()` so extensions can clean up timers and ctx references, preventing stale-ctx crashes on session replacement or reload. (69fc393)
- **Line number regex** — full `<span class="line">` tag consumed to prevent stray `>` characters in rendered code blocks. (00ba1aa)
