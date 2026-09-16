# Design: Remote Read-Only Monitoring + Gate Approval (P0)

Status: draft — awaiting approval
Date: 2026-09-16
Implements: `docs/decisions/2026-09-13-remote-access-deferred.md` (P0 scope), unlocked by Phase 7 P0 shipping

## Scope

Exactly the P0 surface from the deferral decision: session list, live event stream,
tool cards, pending-gate approve/deny, and a read-only view of the agent's changes.
Everything else returns 501. No prompt/steer/follow-up, no PTY, no file writes, no
Git mutations, no settings, no keys, no extension management — remotely, ever, in P0.

The desktop app is unaffected: the server is off until the user enables it in
Settings → Remote, never auto-starts, and adds no desktop IPC surface.

## Architecture

```
Phone (PWA, untrusted)          Electron main (authority)            Desktop renderer
  │  Bearer token + Origin         │                                    │
  ├─ HTTP GET  reads ───────────▶  │  same read models the desktop uses │
  ├─ SSE /api/events ◀──────────── │  AgentSessionEvent fan-out tap     │
  ├─ POST /api/gates/:id/… ──────▶ │  PendingGateRegistry ── resolves ─▶ the same
  │                                │  (one policy path, both clients)   pending promise
```

- One HTTP server on `node:http` in Electron main (SSE for the event stream).
  **Zero new runtime dependencies.**
- Binds `0.0.0.0:8787` when enabled. Encryption and network reachability are the
  tailnet's job (Tailscale/WireGuard per the decision); the bearer token is still
  required on every request, so a misconfigured tailnet degrades to "token-only",
  never "open".
- The PWA is a second Vite entry in this repo (SolidJS, shared `src/lib/ipc`
  schemas as the one contract source). Strict CSP: no `unsafe-*`, `connect-src
  'self'`. No desktop `index.html` changes.

## Pairing and auth

- Desktop Settings → Remote → "Pair a device" shows a 6-digit code + the tailnet
  URL. Main holds a one-time pairing secret (CSPRNG, 32 bytes) keyed by that code;
  TTL 5 minutes, single use, one pending pair at a time.
- `POST /api/pair {code}` → `{deviceToken}` (256-bit CSPRNG, shown once). Main
  stores `SHA-256(token)` only. The PWA keeps the raw token in `localStorage`
  (origin-scoped; non-extractable WebCrypto key is a P1 hardening note).
- Every other request: `Authorization: Bearer <token>` → SHA-256 →
  `crypto.timingSafeEqual` against each stored hash (device count is small; a
  device-id column shortcut is P1). No match → 401, logged with source IP.
- `remote_devices` table (SQLite migration): `id, name, token_hash UNIQUE,
  created_at, last_seen_at, revoked_at`. Settings lists devices with "Revoke";
  revocation is immediate (hash no longer matches). Kill switch: the Settings
  toggle also stops the server.
- Pairing endpoint is rate-limited (5 attempts / 5 min / IP, global lockout at 20)
  and returns 403 with no distinction between wrong code and expired code.

## Request validation (every endpoint)

1. Method + path matched against the P0 allowlist; anything else → `501
   {"error":"not_in_allowlist"}` — never a silent `{ok:true}`.
2. `Origin` (or `Sec-Fetch-Site: same-origin`) required and matched on **every POST**; GET responses carry no CORS headers, so cross-origin JS can
   neither read them nor send our custom auth header without a preflight we
   never approve.
3. Bearer auth as above.
4. Path/query/body decoded with the existing Zod schemas (`src/lib/ipc`), size
   limits, unknown fields rejected.

## P0 endpoint allowlist

| Endpoint | Purpose | Authorization detail |
|---|---|---|
| `POST /api/pair` | pairing | pairing code, rate limit, no bearer |
| `GET /api/session-list` | workspace-grouped index | the SQLite read model, unchanged |
| `GET /api/session/:id` | full JSONL tree of one session | `authorizedSessionPath` re-entry — a session outside the active authorization is 404 |
| `GET /api/turn-changes` | read-only last-turn diff summary | reuse the review snapshot reader; no Keep/Revert remotely |
| `GET /api/gates` | pending gates snapshot | registry below |
| `POST /api/gates/:id/approve` `…/deny` | resolve a pending gate | one-time gate token; see below |
| `GET /api/events` | live `AgentSessionEvent` subset (SSE) | token required; see below |

**Transport amendment (2026-09-16):** `/api/events` is **Server-Sent Events**, not WebSocket.
The P0 stream is strictly one-way (server → phone), so SSE removes the hand-rolled
RFC 6455 handshake/frame parser entirely — an attack surface with no corresponding
need — while keeping the token in the `Authorization` header (no query-string
secrets) and giving the PWA trivial reconnect. Same auth model as the other GETs.

Event subset: `agent_start/end`, `message_start/update/end`,
`tool_execution_start/update/end`, `queue_update`, `gate_update`
(synthetic registry snapshots). Payloads are the same envelopes the
desktop renderer already receives — one producer, two consumers. The PWA
consumes the stream with fetch-streaming and its own SSE parser: native
`EventSource` cannot set the `Authorization` header.

## Pending-gate registry (the only mutation path)

Main already mediates every confirmation (high-risk mutations, protected paths,
pre-apply review, extension `ctx.ui` confirms). These calls gain a registry hop:

- Each open confirm gets `gateId` (CSPRNG), a one-time `gateToken`, kind, title,
  summary (for pre-apply: the hunk payload), `createdAt`, and the dialog's own
  expiry. Registry entries are tombstoned on resolution.
- Desktop modal and remote endpoint resolve the **same pending promise**. First
  resolver wins; the loser gets a conflict: `409 already_resolved` for a
  correct one-time token on a settled gate, `410` (gone) for an unknown id, a
  wrong token, or a gate past its expiry — the phone can tell "someone else
  answered" apart from "this gate no longer exists".
- Approve/deny bodies carry `{gateToken}` plus, for pre-apply hunk gates, the
  approved-index array — validated by the same `preapplyReviewSchema` shape the
  desktop modal produces. No new decision logic exists remotely; the remote
  client renders state and submits intent, main decides.
- `gate_update` snapshot events go out on the SSE stream whenever a gate
  opens, settles, or is swept (every new stream also receives one on attach),
  so the phone's badge is live. (Amendment 2026-09-16, slice 3: snapshot
  semantics replace the earlier `gate_open`/`gate_closed` pair — one event
  shape cannot go stale.)

## Module layout (each ≤300 LOC)

- `electron/remote/server.ts` — http/WS lifecycle, bound to the Settings toggle
- `electron/remote/auth.ts` — pairing, token verify, rate limits
- `electron/remote/allowlist.ts` — the route table (this file is the security
  contract; review focus)
- `electron/remote/gates.ts` — registry, tombstones, WS gate events
- `electron/remote/devices.ts` — SQLite store + migration
- `electron/remote/events.ts` — the session-event fan-out tap
- `pwa/` — second Vite entry: pair screen, session list, live view, gate cards

## Test matrix (all negative paths first)

401 without token; 401 with wrong/revoked token; 403 foreign Origin on POST and
SSE; SSE without token; 501 for every non-allowlisted channel
(including `session.prompt`, `pty.*`, `git.*`); path-authorization rejection for
a session outside the authorized set; pairing rate limit and single-use code;
wrong gate token on a live gate → 410; correct token on a settled gate → 409;
expired gate → 410 expired; desktop-vs-remote race → 409; malformed bodies →
400 per schema. Plus one shipped-path-style integration test: enable server on
an ephemeral port, pair, stream a scripted session, approve a scripted gate.

## Explicit non-goals (P0)

Push notifications, HTTPS-inside-tailnet via Tailscale certs (P1), multiple
workspaces, diff Keep/Revert remotely, prompt/steer, desktop behavior changes,
and any relay/public URL. P1 (prompt/steer) requires ≥2 weeks of incident-free
P0 use per the deferral decision.

## Open questions for approval

1. Fixed port 8787 (shown in Settings) — acceptable, or randomized-per-enable?
2. PWA in SolidJS as a second Vite entry (recommended: shared schemas, no new
   framework) — confirm.
3. Device naming: chosen in the PWA during pairing, editable on desktop — confirm.
