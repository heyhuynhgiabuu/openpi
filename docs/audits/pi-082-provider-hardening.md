# Pi 0.82 provider hardening audit

Date: 2026-07-26

## Completed

- Added a sidecar authentication bridge with prompt cancellation and replacement handling.
- Added Zod validation for provider events crossing into Electron main.
- Restricted automatically opened authentication links to HTTP and HTTPS.
- Added integration coverage spanning sidecar event conversion, main-process routing, and renderer login state.
- Added regression coverage for logout acknowledgement and markdown sanitization.
- Updated DOMPurify to 3.4.12 and electron-updater to 6.8.9.
- Updated transitive lockfile resolutions for `ws`, `protobufjs`, `js-yaml`, and `brace-expansion` where the package manager permits it.

## Verification

- TypeScript typecheck passes.
- 61 test files / 332 tests pass.
- Production build passes with pre-existing bundle-size and mixed-import warnings.
- Provider authentication cannot be exercised against real accounts in automated verification; use `docs/provider-auth-smoke.md` before release.

## Residual security finding

`npm audit --omit=dev` reports one high-severity `brace-expansion@5.0.7` finding nested inside `@earendil-works/pi-coding-agent@0.82.1`. That package ships an npm shrinkwrap, so root npm overrides and lockfile updates do not replace the nested version. Pi 0.82.1 is the latest published version at the time of this audit.

The pnpm lockfile applies a targeted override to `brace-expansion@5.x`, but npm remains the documented installation path. Do not claim a zero-finding npm audit until upstream Pi publishes a corrected shrinkwrap.
