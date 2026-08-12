# OpenPi

A desktop workbench for the [Pi coding agent](https://github.com/earendil-works/pi).

[![CI](https://github.com/heyhuynhgiabuu/openpi/actions/workflows/ci.yml/badge.svg)](https://github.com/heyhuynhgiabuu/openpi/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/heyhuynhgiabuu/openpi?include_prereleases&label=release)](https://github.com/heyhuynhgiabuu/openpi/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

OpenPi wraps Pi's sessions, agent events, customizations, file search, source control, diffs, and terminals in a local Electron app. It is not a fork of Pi's agent runtime; OpenPi hosts `@earendil-works/pi-coding-agent` in a main-supervised sidecar and presents it with a desktop UI.

![OpenPi desktop workbench screenshot](media/demo.png)

## What is Pi?

Pi is an open-source coding agent project by Earendil Works. Learn more from the upstream project:

- [earendil-works/pi on GitHub](https://github.com/earendil-works/pi)
- [Pi documentation](https://pi.dev/docs/latest)
- [`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)

OpenPi builds on Pi's SDK instead of reimplementing the agent runtime, session tree, tool execution, extensions, or model/provider behavior.

## Current beta surface

- **Pi sessions in a desktop shell** — session sidebar, workspace grouping, model selector, conversation stream, tool cards, and token/cost metadata.
- **Command palette** — `Shift+Cmd+P` searches commands, files, and sessions.
- **Customizations** — manage Pi Extensions, Skills, Prompts, Themes, Packages, Models, General settings, Notifications, Keybindings, Updates, and About. Provider setup supports API keys plus Pi 0.84.1 account sign-in for OpenRouter, Kimi Code, xAI, Anthropic, OpenAI Codex, and GitHub Copilot.
- **Source control** — persistent Git panel, file tree, search, split diff viewer, and file viewer, with mutations owned by Electron main.
- **Terminal/output panel** — local PTY lifecycle through Electron main, not the renderer.
- **Pi-task delegation** — [`@heyhuynhgiabuu/pi-task`](https://github.com/heyhuynhgiabuu/pi-task) `task` tool (foreground/background, durable `conversation_id`). OpenPi tracks task state from `.pi/task-session-history.json` and resolves sub-sessions under `.pi/artifacts/tasks/sessions/`. Copy `.pi/settings.json.example` to `.pi/settings.json` (or run `pi install npm:@heyhuynhgiabuu/pi-task`) before delegating. The bundled `openpi-task-guard` extension rejects invalid or stale task IDs.
- **Subagent widget** — live status tray with elapsed timer, expandable detail panel, real-time activity stream, and completion notification banner.
- **@mention autocomplete** — `@` in composer shows subagents and files with visual chips, capital-case display, and keyboard navigation.
- **Agent prompt tuning** — tool description tells Pi to delegate on `@agent_name` patterns; prompts with explicit subagent identity headers.
- **OpenPi branding and release automation** — app icon, dynamic app version, CI, and tag-triggered beta builds.

## Architecture boundaries

OpenPi follows three hard boundaries:

1. **Renderer renders only.** It collects intent and displays state. It does not access the filesystem, shell, Git, SQLite, secrets, or Pi internals directly.
2. **Electron main owns desktop authority.** IPC handlers validate payloads with Zod and perform privileged actions: sidecar supervision, PTY, Git, SQLite, file search, app metadata, and native dialogs.
3. **Pi SDK owns agent semantics.** Session trees, compaction, queues, tools, extensions, providers, and model behavior remain Pi's responsibility.

See [`AGENTS.md`](AGENTS.md) for the full project rules and [`ROADMAP.md`](ROADMAP.md) for the beta roadmap.

## Install with Homebrew

Recommended for macOS beta users on Apple silicon or Intel Macs:

```sh
brew tap heyhuynhgiabuu/openpi
brew install --cask openpi
```

Upgrade later with:

```sh
brew update
brew upgrade --cask openpi
```

## Install from source

Requirements:

- Node.js 22.19+
- npm
- macOS, Linux, or Windows for development builds

```bash
git clone https://github.com/heyhuynhgiabuu/openpi.git
cd openpi
npm ci
npm run dev
```

## Development

```bash
npm run lint       # Biome checks
npm run typecheck  # TypeScript
npm test           # Vitest
npm run test:e2e   # real Electron smoke via Playwright
npm run build      # Electron/Vite production build
```

Provider-authentication changes must also pass the [provider authentication smoke test](docs/provider-auth-smoke.md) with redacted, credential-free evidence.

Package a local unsigned beta build:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false OPENPI_RELEASE_CHANNEL=beta \
  npx electron-builder --config electron-builder.json --dir --publish never
```

## Releases

Tagged `v*` pushes run the beta release workflow and publish a GitHub release with installers attached.

```bash
npm run release:patch -- --notes "Short release note"
npm run release:prerelease -- --preid beta --notes-file /tmp/openpi-release-notes.md
npm run release:version -- 0.2.0 --notes-file /tmp/openpi-release-notes.md
git push origin main --follow-tags
```

`CHANGELOG.md` is the release-note source of truth. The beta release workflow extracts the matching `## [x.y.z]` section and publishes that body to GitHub Releases.

## Beta caveats

**macOS — app is not notarized yet.** Homebrew can handle download/install/upgrade, but macOS Gatekeeper may still block unsigned builds on first launch. If blocked, run this once in Terminal to remove the quarantine flag:

```sh
xattr -rd com.apple.quarantine /Applications/OpenPi.app
```

Then double-click the app as normal. This will no longer be required once notarization is configured.

- macOS notarization and Windows code signing are not configured yet.
- Workspace trust, protected-path policy, high-risk confirmations, and keychain-backed secrets are shipped; broader rollout still depends on signing/notarization and continued security regression coverage.
- Some custom-widget accessibility diagnostics are warning-level while the desktop UI matures; concrete label/button checks remain enforced.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening issues or pull requests. Changes that cross renderer/main/Pi SDK boundaries need extra care and tests.

## Star History

<a href="https://www.star-history.com/#heyhuynhgiabuu/openpi&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=heyhuynhgiabuu/openpi&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=heyhuynhgiabuu/openpi&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=heyhuynhgiabuu/openpi&type=Date" />
  </picture>
</a>

## License

MIT — see [`LICENSE`](LICENSE).
