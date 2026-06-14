# OpenPi — Current Status

Surface state of the desktop workbench as of the latest release. Not a rule surface; for project rules see `AGENTS.md`.

## Beta

OpenPi is in active development. Core slices shipped:

- Secure Electron main/preload boundary with typed IPC schemas and renderer-only UI authority.
- Pi session host integration with streaming conversation, model controls, steering/follow-up queue visibility, abort, fork, and session rename flows.
- Workspace/session sidebar with recent workspace restore, session search/sort/group controls, pinned/archive affordances, workspace hero metadata, and Git branch/last-modified summary.
- Customizations modal for Extensions, Skills, Prompts, Themes, Packages, Settings, General preferences, and Keybindings, including the `⇧⌘P` Command Palette binding.
- OpenCode-style command palette (`⇧⌘P`) searching commands, workspace files via `fff`, and historical sessions.
- Main-owned Git source control panel, file tree/search, file viewer, and split diff viewer; renderer never runs Git directly.
- Bottom terminal/output panel with multi-terminal tabs (renameable, add/close/switch), process exit indicators, and resizable panel backed by main-owned PTY lifecycle.
- Dynamic app metadata exposed from Electron main for Welcome/customizations branding, OpenPi runtime icons, and tag-triggered beta CI/release workflows.
- **Goal/harness loop** — `/goal` controller is powered by 5 local LLM-callable tools registered via the project harness extension: `get_goal`, `create_goal`, `update_goal`, `clear_goal`, `update_plan`. The tools write goal/plan state to `~/.pi/agent/.openpi-goal.json` and `.openpi-plan.json`; OpenPi's main process watches these files and reflects state in the renderer. The build-pipeline harness (`harness` tool, Planner → Generator → Evaluator loop) is provided by a global extension at `~/.pi/agent/extensions/harness/` and is not part of the project-local extension surface.
- **Conversation polish** — live token counter during streaming, code block line numbers (toggle with Ln button), streaming cursor after all element types, responsive images, entry animation.
- **File editor improvements** — format-on-save (Biome), word wrap toggle, Cmd+Shift+F opens find-with-replace, `FORMAT_FILE` IPC.
- **Extensions UI** — enable/disable toggle switch per extension, preference persistence, reload button.
- **Onboarding flow** — first-run detection, enhanced welcome screen with getting-started guide and external links.
- **Goal status indicator** — persistent banner in composer header showing objective and running/idle step badge.
- **Sub-agent file tracking** — OpenPi watches `.pi/artifacts/task-<id>/` for the global `task` delegator (provided by `~/.pi/agent/extensions/task/`) and renders in-flight and completed sub-agent runs in `<SubagentFileWidget>`. Replaces the previous in-memory tracking of the Anthropic-style `TaskCreate`/`TaskUpdate` tools, which is no longer used.

## Known constraints

- macOS first. Other platforms untested.
- `electron-builder` packaging only; no auto-update channel configured.
- Single-user; no collaboration features.
- Local-only; no cloud sync.
