# OpenPi v0.1.1

Patch release with two bug fixes since v0.1.0.

## Fixes

- **npm ENOENT on Finder/Dock launch** — OpenPi now enriches `PATH` from the user's login shell before starting the Pi SDK, so packages configured with Pi (npm-backed Skills, Prompts, or Extensions) resolve correctly whether the app is launched from a terminal or directly from macOS Finder/Dock. Previously launching from Finder/Dock would log `Failed to run npm root -g: spawnSync npm ENOENT`.
- **Customizations modal sidebar** — Removed the broken logo image from the brand block at the bottom of the Customizations nav rail; only the app name and version label are shown.

## What is OpenPi?

OpenPi is a native desktop workbench for the [Pi coding agent](https://github.com/earendil-works/pi). It wraps Pi's session tree, streaming conversation, extensions, skills, and customizations in an Electron + SolidJS UI.

OpenPi depends on `@earendil-works/pi-coding-agent` and intentionally does not reimplement Pi's session tree, compaction, queue semantics, tool execution, extensions, or provider behavior.

## Beta caveats

- macOS notarization and Windows code signing are not configured yet; expect OS trust warnings on downloaded installers.
- Permission gates, workspace trust hardening, and keychain-backed secrets are roadmap items before broad stable distribution.
- This beta is for early testers comfortable running local developer tools.
