# Decision: Remote Access Deferred, Read-Only P0 When Revisited

Status: accepted
Date: 2026-09-13

## Context

PR #10 proposed serving the full OpenPi workbench over a zrok tunnel: a loopback HTTP host serving the Vite renderer, an IPC bridge over `POST /api/ipc/:channel`, a WebSocket event stream, and a browser polyfill for `window.openpi`.

Review found the approach unsound as written:

- Authentication was never enabled in the product path (`startTunnel` passed `null` credentials) while the UI claimed "HTTPS + basic auth".
- The bridge exposed every IPC channel and dispatched directly to `sessionIndex` / `sessionHost`, bypassing `authorizedSessionPath` and `authorizedWorkspacePath` — arbitrary file read and arbitrary-workspace session start.
- The WebSocket upgrade validated neither auth nor `Origin`; the origin allowlist only ran when a tunnel origin was configured, which the product path never set.
- Desktop security was weakened for the feature: `script-src` gained `unsafe-eval`/`unsafe-inline`, `authorizedWorkspacePath` accepted any existing directory, and the tunnel auto-started at launch.
- ~3k lines of vendored third-party dashboard code shipped in the bundle without ever being started.

Separately, the use case ("drive the workbench from outside the home network") is the `Mobile` / `phone/IM agents` non-goal, and the same need for Pi is already served by Paseo (`getpaseo/paseo`, supports Pi, license `NOASSERTION` — no code reuse).

## Decision

Remote access is **deferred, not rejected**, and scoped to a read-only surface when revisited.

- OpenPi stays **desktop-first**. Remote is an extension of the review workflow ("approve from your phone"), never a remote IDE.
- A remote client is an **untrusted renderer**: it goes through the same main-process authorization and policy as the desktop renderer, never around it.
- Entry criteria: Phase 7 P0 (diff review before apply, test evidence) shipped, and this threat model approved.
- P0 is **read-only monitoring + approval**: session list, live event stream, tool cards, pending gates approve/deny, read-only view of agent changes.
- P0 excludes every mutation surface: prompt/steer/follow-up, PTY, file writes, Git stage/commit/revert, settings, provider keys, extensions.
- Transport defaults to **Tailscale/WireGuard** (no relay, no public URL). PWA, no native app.
- Pairing is per device: one-time code → 256-bit token, SHA-256 hashed at rest, revocable and rotatable, compared with `crypto.timingSafeEqual`; kill switch in the desktop UI.
- Authorization reuses `authorizedSessionPath` / `authorizedWorkspacePath` — one code path, not a parallel implementation.
- Explicit channel allowlist; unsupported channels return 501; no `{ ok: true }` stubs.
- `Origin` validated on every request **and** the WebSocket upgrade.
- Strict CSP; no change to desktop `index.html`; no desktop behavior change.

Phasing: P0 → P1 (prompt/steer + push notifications, after ≥2 weeks of real P0 use with no incident) → P2 (diff review + Git, needs a dedicated approval design) → P3 (native app, E2E relay; separate decision, not planned).

## Consequences

- Remote access cannot be merged as a patch to the existing IPC surface; it needs a dedicated, explicitly allowlisted API.
- Future remote work starts from this record and the PR #10 review findings, not from PR #10's code.
- Read-only first keeps the highest-risk capabilities (shell via agent prompts, PTY, Git mutations) desktop-only until P0 proves useful.
- The security requirements are testable: 401 without a token, 401 with a wrong token, 403 for a foreign origin, path-authorization rejection, WS upgrade rejection, 501 for non-allowlisted channels.

## References

- PR #10 (closed): https://github.com/heyhuynhgiabuu/openpi/pull/10
- Paseo: https://github.com/getpaseo/paseo
