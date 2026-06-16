# OpenPi v0.2.0 - 2026-06-16

### Added

- **Homescreen workbench layout** — replaced the old sidebar-first workspace with a homescreen, persistent right panel, wider welcome surface, and cleaner topbar session chrome. (f60dcc0, 751a9bb, a484529)
- **Git history in the preview surface** — added a Changes-panel graph button that opens Git history as a center preview tab with normal tab activation/close behavior. (ab92bbf)
- **Git changes workbench** — added a right-panel Git file tree, per-change-type coloring, diff preview flow, full-height changes body, persistent commit area, and Stage All / Unstage All bulk action behavior. (8de6dab, ab92bbf)
- **Artifact TODO surfacing** — renders subagent artifact `TODO.md` files in the file widget, hides completed todo files, and keeps one active running todo file visible. (3a8bf41, 027fc28, d9d3acf)
- **Tool-call name shimmer** — added a subtle text-only shimmer for visible tool call names while an agent run is active, with a slower 2.4s production pace and no visible config panel. (0f0121d, ba71265, 9d9f121, 627cb20)
- **File preview find controls** — added Cmd/Ctrl+F find bar support with wrap controls, plus a preview-toolbar search icon near the Vim toggle. (5bc9478, 21f3002)
- **Conversation context and tool polish** — added context usage popover stats, model/duration message metadata, and cleaner tool row rendering. (bd06f4c, bb715f7, d088561)
- **New provider display names** — Ant Ling, NVIDIA NIM, and Together AI are now visible by name in the model picker. New SDK models appear automatically through `ModelRegistry`. (d93aefd)
- **Headless Codex device-code login** — wired the required `onDeviceCode` OAuth callback through the typed provider login event channel. (d93aefd)

### Changed

- **Pi coding agent SDK** — bumped `@earendil-works/pi-coding-agent` from `^0.74.0` to `~0.79.3`, including project-trust hardening, public `extensionRunner`, public `session.dispose()`, newer Anthropic/OpenAI models, MiniMax-M3, and additional providers. (d93aefd, 902675d)
- **Node minimum** — pinned `engines.node` to `>=22.19.0 <23` to match Pi 0.75.0's floor. CI workflows use Node 22.19.0. (d93aefd)
- **Subagent/tooling surface** — replaced stale Anthropic task-tool references with the OpenPi subagent/file-tracker path and removed the deleted goal/harness extension surface. (2dff5d6, a91eb32, 265fa3c, 7b0076d, cbd98c3, 8666613)
- **File tree styling** — moved to grayscale-at-rest file icons, color on hover, git status badges, cleaner indentation, and refined context-menu/keybinding behavior. (e937605, d976576, f3ab8e7, c63c885, 2090d51, 64f6011, fc326f8, 24059b0, 5f42503)
- **Workbench chrome** — refined right-panel tabs, file tabs, preview toolbar/find bar borders, model toggles, homescreen icon, and main preview/diff backgrounds. (879377e, d599706, 01c753e, a484529)

### Fixed

- **File preview saves** — saving from CodeMirror now refreshes file-tree and Git-status observers so OpenPi surfaces update after edits. (21f3002)
- **Markdown task lists** — TODO-style checklists (`- [ ]` / `- [x]`) now render as checkboxes in OpenPi markdown surfaces, including generated `TODO.md` files. (bf2624f)
- **Tool shimmer lifecycle** — tool names now shimmer for the full active agent run instead of flickering per individual tool card, and stop when the agent ends. (6c0d9ac, 9d9f121)
- **Release workflow setup** — corrected `setup-node` indentation and the release job's Node 22.19.0 pin so CI and release jobs use the intended runtime. (88a0d36)
- **Private-API poke in sidecar teardown** — sidecar shutdown now uses Pi 0.79.3's public `session.extensionRunner` getter and a valid shutdown reason. (d93aefd)
- **File tree actions** — replaced prompt-based rename UI with Kobalte context menu actions and fixed preview filename sync after rename. (e937605, e462ac19)
- **Panel resizing and first-try UI feedback** — fixed file panel drag-resize sign and addressed the first review batch of workbench UI feedback. (bfaa14c, e6120f9)
- **Conversation thinking display** — removed thinking-block chrome, wired the hide-thinking setting, and kept the thinking icon animation visible. (2002c5d, cee0bd2)
