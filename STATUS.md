# OpenPi — Current Status

Surface state of the desktop workbench as of the latest release. Not a rule surface; for project rules see `AGENTS.md`. For direction and phases see `ROADMAP.md`.

## Mission

OpenPi is a **human-enabling workbench** for [Pi](https://pi.dev) (`@earendil-works/pi-coding-agent`): make sessions **visible** and **steerable**, keep the **MIT agent core** in Pi (not a second runtime), and treat the user as the **quality gate** — aligned with Pi’s minimal harness and inspectability goals. See **Philosophy** in `ROADMAP.md`.

## Beta (v0.2.1)

### Shipped

- Secure Electron main/preload boundary (Zod IPC, sandboxed renderer, main-owned FS/PTY/Git).
- Pi session host: streaming conversation, model controls, steer/follow-up queues, abort, fork, rename.
- Workspace/session sidebar: search/sort/group, pin/archive, token/cost badges, Git branch metadata.
- Customizations: Extensions, Skills, Prompts, Themes, Packages, Settings, General, Keybindings.
- Command palette (`⇧⌘P`): commands, `fff` files, sessions.
- Git panel, file tree/search, CM6 file viewer, split diff viewer (main-owned Git).
- Terminal/output panel: multi-tab PTY, renameable tabs, exit indicators.
- **Trust (Phase 6):** workspace trust, extension/package install confirms, protected paths, high-risk shell/Git mutation prompts, secret redaction, diagnostics export bundle, SQLite hardening.
- **Built-in subagents:** `Agent` / `get_subagent_result` / `steer_subagent` on sidecar; Worker, Explorer, Scout, Planner, Reviewer profiles; `.pi/agents/*.md` discovery; @mention autocomplete; subagent status widget.
- **Goal/harness:** `/goal` + plan files (`~/.pi/agent/.openpi-goal.json`, `.openpi-plan.json`); harness extension for build pipeline (global `~/.pi/agent/extensions/harness/`).
 - Conversation polish: live token counter (streaming), code line numbers, tool cards including `ask_user_question` modal.
 - Agent review: unified Review tab now has a source dropdown for `Git changes` vs `Last turn changes`; last-turn mode uses agent snapshots, file accordions, proper diff rendering, Keep/Revert/Revert all, and coalesces repeated edits per file.
 - CI: PR/main checks; tag-triggered beta releases (macOS/Windows/Linux). **Signing/notarization not configured.**

### Next (Phase 7 — see ROADMAP)

- **P0:** TEST_MATRIX / test evidence, hunk-level/pre-apply diff polish, **live token/cost per turn** while streaming.

- **P1:** Session tree map v2, subagent card polish.
- **P2:** Plan overlay, workbench context bridge, auto-updater (after signing).

## Known constraints

- macOS primary; other platforms less tested.
- Packaging via `electron-builder`; in-app auto-update not wired.
- Single-user, local-only, no cloud sync.
- Pi defaults to **YOLO**; OpenPi adds **optional** desktop policy rails — users can still install Pi [example extensions](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions) for TUI-style gates.

## References

- Pi posts: [coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/), [slow down](https://mariozechner.at/posts/2026-03-25-thoughts-on-slowing-the-fuck-down/), [Earendil](https://mariozechner.at/posts/2026-04-08-ive-sold-out/)
- Upstream: [earendil-works/pi](https://github.com/earendil-works/pi), [pi.dev](https://pi.dev)