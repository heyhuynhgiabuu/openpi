# Changelog

## [Unreleased]

## [0.1.3] - 2026-05-13

- Release OpenPi v0.1.3.


## [0.1.2] - 2026-05-13

- Release OpenPi v0.1.2.


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
