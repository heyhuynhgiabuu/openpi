# Pi 0.74.0 → 0.79.3 Upgrade

Pin: `~0.79.3`. Branch: `upgrade/pi-0.79.3` → merge to `main`.

## Stages

- [x] **Stage 0 — Pre-flight.** Inspect new dist for `session_shutdown` public surface and `extensionRunner` shape. Diff `DefaultResourceLoader` constructor. Diff `SettingsManager`/`SessionManager` exports. Note 0.74.2 anomaly.
- [x] **Stage 1 — Dep bump only.** Bump `package.json` to `~0.79.3`, `npm install`, run typecheck/lint/test/smoke:electron. Stop on type failure.
- [x] **Stage 2 — Replace private-API poke.** Drop `session.extensionRunner` cast, use public surface (or move into extension handler).
- [x] **Stage 3 — Pin Node floor.** `engines.node: ">=22.19.0"`, CI `node-version: 22.19.0`, document.
- [x] **Stage 4 — Adopt 0.79.0 trust model.** (Scaled back — see notes.) Add `pi.on('project_trust')` handler in `openpi-bridge.ts` that defers to the existing `workspaceTrusted` gate. Needs an RPC channel from extension to sidecar; current scope is a comment + future task.
- [ ] **Stage 5 — Surface new providers/models.** Ant Ling, NVIDIA NIM, MiniMax-M3, Claude Fable 5, Claude Opus 4.8, GPT-5.4/5.5.
- [ ] **Stage 6 — Changelog + release.** Write `CHANGELOG.md` entry, `release:minor`, push main.

## Findings

- `session.extensionRunner` is **public** in 0.79.3 (`get extensionRunner(): ExtensionRunner`) — drop the `as unknown as` cast.
- `session.hasExtensionHandlers(eventType)` is public.
- `session.dispose()` is public.
- `DefaultResourceLoader` constructor is backward-compatible.
- `extensionsOverride` is a new optional arg.
- Pi 0.79.3 ships `npm-shrinkwrap.json` and disables lifecycle scripts for self-update.
- 0.74.2 exists on npm without release notes — pin to `~` (not `^`) until 0.79.4 publishes.
- **Surface leaks from `electron/` and `tests/`:** `@earendil-works/pi-ai` (for `Api, Model, OAuthLoginCallbacks`) and `typebox` (for `Type` in schemas). Now declared as direct deps. Extensions under `.pi/extensions/` resolve these from Pi's nested `node_modules`; they're not declared in our `package.json` but they're also not in `tsconfig.json`'s `include` set.
- **Stage 4 trade-off:** the `project_trust` handler runs inside Pi (in the extension process), but our `workspaceTrusted` state lives in the sidecar. Bridging them needs an RPC channel from extension → main, similar to the existing bridge. That's a feature PR, not upgrade plumbing. Logged as follow-up.


## Verification gates

Each stage ends with: `npm run typecheck && npm run lint && npm test && npm run smoke:electron`.
