# OpenPi v0.1.0 beta

OpenPi is a native desktop workbench for the [Pi coding agent](https://github.com/earendil-works/pi). This first public beta focuses on making Pi sessions feel at home in a local desktop app while keeping Pi's SDK in charge of agent semantics.

## Highlights

- Electron + SolidJS workbench for Pi sessions, workspace navigation, model selection, conversation streaming, and tool cards.
- OpenCode-style command palette (`Shift+Cmd+P`) for commands, files, and sessions.
- Customizations modal for Pi Extensions, Skills, Prompts, Themes, Packages, models, notifications, keybindings, updates, and app info.
- Persistent Git/source-control panel with file tree, file search, diff viewer, and file viewer.
- Bottom terminal/output panel backed by Electron main and `node-pty`.
- OpenPi app branding, runtime version metadata, icon packaging, CI, and tag-triggered beta builds.

## Beta caveats

- macOS notarization and Windows code signing are not configured yet; expect OS trust warnings on downloaded installers.
- Permission gates, workspace trust hardening, protected-path policy, and keychain-backed secrets are still roadmap items before broad stable distribution.
- This beta is for early testers who are comfortable running local developer tools and reporting rough edges.

## Upstream Pi

OpenPi depends on `@earendil-works/pi-coding-agent` and intentionally does not reimplement Pi's session tree, compaction, queue semantics, tool execution, extensions, or provider behavior. For Pi itself, see https://github.com/earendil-works/pi.
