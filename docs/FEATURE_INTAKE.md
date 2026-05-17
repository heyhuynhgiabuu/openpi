# OpenPi Feature Intake

Use this checklist before creating or executing any work item.

## Classify Input

- `intake` — new product change
- `status` — inspect current state
- `harness-init` — scaffold missing harness docs
- `harness-lint` — audit for gaps
- `story-intake` — create/update a story packet
- `decision-intake` — record an architecture decision
- `validation-intake` — update test matrix
- `execution` — implement a known slice
- `clarify` — missing information

## Risk Flags

Check each that applies:

- [ ] **auth / authorization** — touches login, permissions, RBAC, OAuth
- [ ] **data model / migration** — schema change, database, data loss risk
- [ ] **audit / security** — secrets, tokens, sandbox, security boundaries
- [ ] **external provider** — Stripe, Supabase, GitHub, OpenAI API, etc.
- [ ] **public contract** — IPC schema, public API, SDK surface, breaking change
- [ ] **cross-platform** — macOS/Windows/Linux divergence
- [ ] **weak proof** — unclear, hard to test, no existing validation
- [ ] **multi-domain** — touches renderer + main + SDK simultaneously

## Risk Level

| Flags | Level |
|---|---|
| 0 | tiny (docs, labels, styles, refactors with proof) |
| 1 | normal |
| 2+ | high-risk |

**Hard gates:** auth, authorization, data loss/migration, audit/security, external provider, removing validation. Any of these → high-risk automatically.

## Output

Each intake produces:
- Restated work item
- Affected docs/stories
- Risk level + flags
- Missing required inputs
- Next safe action
