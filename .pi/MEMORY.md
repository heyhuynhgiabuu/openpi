# Project Memory

## 2026-07-25 — Pi 0.82.1 integration

- Pi 0.82 replaces direct `AuthStorage` / `ModelRegistry` use with a shared `ModelRuntime`; refresh the runtime rather than recreating it so extension-registered providers survive.
- Provider auth UI must accept events after `select`, allow blank non-secret prompts, and honor per-prompt abort signals used by `manual_code` callback races.
- Cloudflare key setup preserves the prior key-plus-environment flow via `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_GATEWAY_ID`.
- Current production audit baseline after hardening: pnpm has zero findings; npm retains one high `brace-expansion@5.0.7` finding locked inside Pi 0.82.1's published shrinkwrap. Live OAuth/device flows remain unverified end-to-end.
- Zod `.refine()` callbacks must never throw: earlier `.url().refine(value => new URL(value))` code could throw during `safeParse()` and terminate Electron main. Use a non-throwing parse guard such as `URL.canParse()` first.
- [discovery] Pi 0.84.1 remains compatible with the coding-agent `AgentSession`/`SessionManager` JSONL v3 path; its v4 lane-based session migration applies to lower-level agent-core, not OpenPi.
- [warning] Before upgrading to Pi 0.84.1, make session replacement/reload/stop abort active work before shutdown/dispose, handle `CredentialSynchronizationError` without blind login retry, align TypeBox 1.3.7, and test third-party provider refresh APIs broken by 0.84.

## 2026-07-27 — release readiness

- A tag-triggered workflow must validate the tag against both package versions, require exact version/architecture artifact names, and scope uploads to that version; recursive `release/**` uploads can publish stale installers.
- Electron's macOS updater requires ZIP artifacts. Native arm64/x64 jobs must discard colliding per-architecture `latest-mac.yml` files and publish one combined manifest containing both architecture-named ZIPs.
- Scope `BREW_TAP_TOKEN` to Homebrew-only steps; do not expose it as a publish-job environment variable.
- Release prep is verified and commit-ready. Tagging remains blocked on `docs/provider-auth-smoke.md`, version promotion, and explicit approval.
- An x64 Electron cross-package made from an arm64 pnpm install can silently include arm64 optional native modules. Release jobs must inspect both Electron and unpacked fff/node-pty/ffi-rs Mach-O binaries on their native runner before upload; use `file -b` so architecture-bearing paths cannot create false positives.

## 2026-08-12 — architecture and quality audit

- [warning] Immediate security debt: `FORMAT_FILE` builds a shell command with a renderer-controlled filename; archive/unarchive and open-session paths lack canonical session-directory containment; lexical workspace checks permit symlink escapes; privileged IPC lacks sender/navigation guards; hunk validation checks only the first file while Git applies the full patch; PTY creation trusts renderer-supplied cwd.
- [warning] Session replacement commands can overlap and accept stale results/events; serialize replacements or reject stale generations before treating lifecycle work as safe.
- [warning] Test confidence is overstated: `sessionIndex.test.ts` tests a local fake rather than `SessionIndexStore`, the hunk path-security test is a placeholder, Playwright discovers zero tests, and coverage cannot run without `@vitest/coverage-v8`.
- [discovery] Structural baseline: 44,426 production TS LOC; 32 production files exceed the 300-LOC rule (15,571 LOC total), `useOpenPiSession` exposes roughly 122 members, `src/index.css` is 16,979 LOC, and the renderer entry bundle is about 6.65 MB.
- [decision] Remediate in shippable slices: boundary security plus negative tests first; real integration/E2E coverage second; runtime protocol schemas third; incremental feature-module extraction and bundle/docs/lint cleanup last. Avoid a state-management/framework rewrite.
- [warning] `fs.existsSync()` treats dangling symlinks as absent; authorization must use `lstat`, reject symlink components, and use `O_NOFOLLOW`/exclusive or atomic no-replace operations at mutation time. Reverse Git hunk actions must validate both `---` and `+++` paths, not only the new path.
- [warning] Serializing only replacement commands is insufficient: stateful result commands and stop need replacement barriers, main cwd/session state must suspend before reload/fork, orphaned lifecycle responses must be dropped, and successful request/response events are not also forwarded through the general sidecar handler.
- [decision] Final remediation verification: 77 Vitest files / 401 tests, typechecks, build, Electron E2E, 8-second smoke, and `git diff --check` pass; lint exits 0 with 12 warnings/5 infos. Delayed lifecycle and cleanup reviews were reconciled; fork preflight and navigation rollback closed the last two findings, and independent re-review found no remaining blocker/major/medium issue. Coverage remains unavailable without `@vitest/coverage-v8`.
- [decision] v0.2.7 release preparation is complete in commits `46a84b2` and `6a5d532`; independent release review found no blocker/major/medium issue. Annotated tag `v0.2.7` and `main` were pushed at `182802d`; release workflow run `31618797638` started. The unrelated `.pi/skills/task-tool/SKILL.md` deletion remains excluded.
- [decision] The initial v0.2.7 release did not publish because Windows-only test paths were non-portable; `9c8f95d` fixed them. A v0.2.8 retry was abandoned per explicit user direction after a transient Electron download failure. `8a1fab5` restores 0.2.7 metadata and adds one clean `npm ci` retry. Remote v0.2.8 was deleted, v0.2.7 was repointed before any release existed, and run `31628952679` published the complete v0.2.7 release and Homebrew update.

## 2026-09-04 — Pi 0.85.0 upgrade and lint stack migration

- Pi 0.85.0 changed `setModel`/`setThinkingLevel` to session-only persistence by default; pass `{ persist: true }` from the sidecar to keep the 0.84 global-default UX.
- pi-coding-agent 0.85.0 statically imports the undeclared `@earendil-works/pi-server` from `main.js`; OpenPi pins it as a direct dependency until upstream declares it, then drop the pin and the STATUS.md constraint note.
- Extension `ui_prompt_start`/`ui_prompt_end` session events are emitted from OpenPi's own `ctx.ui` bridge (`dialogPromise` in `extensionUiRpc.ts`); `ExtensionRunner.on` is not a host-facing API. `Promise.finally` guarantees exactly-once end events across answer/cancel/timeout/teardown.
- Settings `defaultTools`: an empty array disables all built-in tools while an absent key means Pi defaults — `applySettingValue` deletes emptied string-array keys instead of writing `[]`.
- Lint stack: Biome removed for oxlint 1.81.0 + oxfmt 0.66.0 with the vendored anti-slop plugin in `tools/oxlint/anti-slop` (requires a version-matched `@oxlint/plugins`). Staged rollout: 8 rules error at zero violations; 7 warn on a counted ~792-diagnostic legacy backlog; `no-module-mocking` and `no-unassigned-vars` off with rationale in `oxlint.config.ts` (vi.mock seams; Solid `let el!` ref idiom). jsx-a11y label/control association rules off — the plugin cannot resolve Solid's `for` attribute.
- oxfmt formats markdown/yaml/html by default (Biome never did); they are ignored in `.oxfmtrc.json` to prevent prose-doc churn. `eslint-disable-next-line` must sit on the exact line of a multiline expression to suppress a diagnostic.

## 2026-09-21 — Pi 0.86.1 host compatibility

- [decision] Pin the complete embedded Pi family (`pi-ai`, `pi-coding-agent`, `pi-tui`) to exact `0.86.1`; remove the obsolete `pi-server` workaround and align TypeBox to `1.3.27`. Regenerate both lockfiles; do not hand-edit them.
- [decision] Treat Pi 0.86 standalone `usage` entries and non-assistant `message` entries as persisted metadata: preserve them for prompt/replay and session totals, reindex usage at `USAGE_INDEX_VERSION = 10`, store non-assistant message roles as non-turn index rows, and splice system/usage metadata out of ordinary history, tree, branch, trajectory, and navigable leaf rows while preserving parent chains. Guard ancestry walks against malformed cycles.
- [decision] Custom providers must consume Pi 0.86's normalized `TranscriptContext` through `getCurrentSystemPrompt()` and `getCurrentTools()`; the shipped no-network provider fixture exercises the real sidecar/agent path.
- [decision] Pi updates are fail-closed: development installs may update the exact supported family using a manager matching an existing lockfile; packaged `app.asar` bundles refuse mutation and direct users to update OpenPi. Unsupported versions are not installed.
- [verification] Final checks: focused compatibility/tree/usage tests 3 files / 34 tests plus updater coverage; full Vitest 156 files / 1114 tests; typecheck and extension typecheck; lint exit 0 with existing warnings; build; 8-second Electron smoke; macOS package inspection; clean temporary npm and pnpm installs; npm and pnpm production audits; `git diff --check`.
- [warning] `app.asar` inspection is read-only. Use `npx asar extract <app.asar> <temp-dir>` for inspection; `asar extract-file` without an explicit safe destination can overwrite the current working directory.
