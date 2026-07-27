# Project Memory

## 2026-07-25 — Pi 0.82.1 integration
- Pi 0.82 replaces direct `AuthStorage` / `ModelRegistry` use with a shared `ModelRuntime`; refresh the runtime rather than recreating it so extension-registered providers survive.
- Provider auth UI must accept events after `select`, allow blank non-secret prompts, and honor per-prompt abort signals used by `manual_code` callback races.
- Cloudflare key setup preserves the prior key-plus-environment flow via `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_GATEWAY_ID`.
- Current production audit baseline after hardening: pnpm has zero findings; npm retains one high `brace-expansion@5.0.7` finding locked inside Pi 0.82.1's published shrinkwrap. Live OAuth/device flows remain unverified end-to-end.
- Zod `.refine()` callbacks must never throw: earlier `.url().refine(value => new URL(value))` code could throw during `safeParse()` and terminate Electron main. Use a non-throwing parse guard such as `URL.canParse()` first.

## 2026-07-27 — release readiness
- A tag-triggered workflow must validate the tag against both package versions, require exact version/architecture artifact names, and scope uploads to that version; recursive `release/**` uploads can publish stale installers.
- Electron's macOS updater requires ZIP artifacts. Native arm64/x64 jobs must discard colliding per-architecture `latest-mac.yml` files and publish one combined manifest containing both architecture-named ZIPs.
- Scope `BREW_TAP_TOKEN` to Homebrew-only steps; do not expose it as a publish-job environment variable.
- Release prep is verified and commit-ready. Tagging remains blocked on `docs/provider-auth-smoke.md`, version promotion, and explicit approval.
- An x64 Electron cross-package made from an arm64 pnpm install can silently include arm64 optional native modules. Release jobs must inspect both Electron and unpacked fff/node-pty/ffi-rs Mach-O binaries on their native runner before upload; use `file -b` so architecture-bearing paths cannot create false positives.
