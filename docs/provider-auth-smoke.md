# Provider authentication smoke test

Run this checklist before releasing a Pi SDK upgrade that changes authentication. Use test accounts where possible. Never paste tokens, authorization codes, `auth.json`, or screenshots containing credentials into issues or CI logs.

## Setup

1. Build and start OpenPi from a clean worktree.
2. Record the OpenPi version, Pi SDK version, OS, and architecture.
3. Back up `~/.pi/agent/auth.json` locally, without uploading it.
4. Open **Customizations → Models** and keep the Output panel visible.

## Account-login flows

For each supported provider, verify that progress is visible, external URLs use HTTPS, success refreshes the provider row, models become available, logout removes the account, and restarting OpenPi preserves only credentials that were not logged out.

| Provider | Required scenarios |
|---|---|
| OpenAI Codex | Browser selection; device-code selection; cancel before completion |
| GitHub Copilot | Submit a blank enterprise URL for github.com; configured enterprise URL |
| OpenRouter | Browser callback; manual-code fallback; callback winning while manual-code input is open |
| Kimi Code | Device code, including visible user code and expiry behavior |
| xAI | Browser callback and cancellation |
| Anthropic | Browser callback and logout |

For every selection-based flow, confirm that events appearing after the selection replace the choices instead of leaving the UI stuck.

## API-key flows

1. Add and remove a standard API key, then restart OpenPi after each operation.
2. For Cloudflare AI Gateway, set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_GATEWAY_ID`, enter the API key, and verify all three values survive a restart through Pi's credential store.
3. Confirm an incomplete multi-step provider setup reports an actionable error and does not display or log the entered key.

## Failure and recovery

1. Reject or close the provider authorization page.
2. Abort a pending manual-code prompt by completing its browser callback.
3. Start a second prompt for the same provider and confirm the older prompt is cancelled.
4. Quit OpenPi during a pending login, restart, and confirm the UI is idle and usable.
5. Disconnect the network during device polling and confirm the error is visible without exposing credential material.

## Evidence to retain

Retain only non-secret evidence:

- pass/fail by provider and scenario
- OpenPi, Pi SDK, OS, and architecture versions
- redacted error text
- confirmation that restart and logout behaved correctly

Delete the local backup after the smoke test is accepted.
