# Decision: Renderer Is Not Authority

Status: accepted
Date: 2026-05-17

## Context

OpenPi uses Electron with a SolidJS renderer. The renderer has access to IPC channels exposed through the preload script. Early design discussions raised the question of how much authority the renderer should have.

## Decision

The renderer is a **presentation layer only** — it collects user intent and displays state. It never:

- Accesses the filesystem (no `fs`, no direct file reads/writes).
- Runs Git commands (`simple-git`, `child_process`, or shell).
- Spawns processes or manages PTY lifecycles.
- Reads/writes SQLite databases.
- Reads secrets from the OS keychain.
- Imports `@earendil-works/pi-coding-agent` or any Pi SDK packages.

All these belong to **Electron main / sidecar**, which acts as the desktop authority boundary.

## Consequences

- Security: even if the renderer is compromised (XSS, compromised dependency), it cannot access the filesystem or secrets.
- IPC must be typed, Zod-validated, and frame-origin-checked on every handler.
- The renderer imports only SolidJS, UI libraries, and simple utility functions (labelForTool, formatRelativeTime, etc.).
- Harness tool output (files written by the Pi extension) flows through the session event stream — the renderer only displays it.
- More boilerplate for IPC handlers, but each handler is a focused, testable function.
