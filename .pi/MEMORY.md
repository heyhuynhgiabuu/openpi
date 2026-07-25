# Project Memory

## 2026-07-25 — Pi 0.82.1 integration
- Pi 0.82 replaces direct `AuthStorage` / `ModelRegistry` use with a shared `ModelRuntime`; refresh the runtime rather than recreating it so extension-registered providers survive.
- Provider auth UI must accept events after `select`, allow blank non-secret prompts, and honor per-prompt abort signals used by `manual_code` callback races.
- Cloudflare key setup preserves the prior key-plus-environment flow via `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_GATEWAY_ID`.
- Current production audit baseline: 7 transitive findings (5 high, 2 moderate); live OAuth/device flows remain unverified end-to-end.
