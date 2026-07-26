# Project Memory

## 2026-07-25 — Pi 0.82.1 integration
- Pi 0.82 replaces direct `AuthStorage` / `ModelRegistry` use with a shared `ModelRuntime`; refresh the runtime rather than recreating it so extension-registered providers survive.
- Provider auth UI must accept events after `select`, allow blank non-secret prompts, and honor per-prompt abort signals used by `manual_code` callback races.
- Cloudflare key setup preserves the prior key-plus-environment flow via `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_GATEWAY_ID`.
- Current production audit baseline after hardening: pnpm has zero findings; npm retains one high `brace-expansion@5.0.7` finding locked inside Pi 0.82.1's published shrinkwrap. Live OAuth/device flows remain unverified end-to-end.
- Zod `.refine()` callbacks must never throw: earlier `.url().refine(value => new URL(value))` code could throw during `safeParse()` and terminate Electron main. Use a non-throwing parse guard such as `URL.canParse()` first.
