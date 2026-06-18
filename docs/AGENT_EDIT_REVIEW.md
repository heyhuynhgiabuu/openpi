# Agent edit review (P0 spike)


## Pi-official path

Per [`extensions.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md):

- **`tool_call` event** — fires **before** `write` / `edit` / `bash` execute; return `{ block: true, reason }` to deny.
- **`ctx.ui.confirm()`** — permission gates (see `examples/extensions/permission-gate.ts`, `confirm-destructive.ts`).

OpenPi sidecar uses `mode: 'rpc'` with a custom `ExtensionUIContext` that mirrors Pi’s [extension UI protocol](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md).

## What we shipped (this step)

1. **`extension_ui_request` / `extension_ui_response`** — sidecar ↔ main ↔ renderer, same shape as Pi RPC.
2. **`ExtensionUiOverlay`** — desktop modals for `confirm`, `select`, `input`, `editor`.
3. **Extensions using `ctx.ui.confirm()` now work** in OpenPi (previously always returned `false`).

Install a gate extension globally, e.g. copy Pi’s `permission-gate.ts` into `~/.pi/agent/extensions/`, then `/reload`.

### Modal never appears?

| Cause | Fix |
|--------|-----|
| Extension only in **repo** `openpi/.pi/extensions/` | **Trust the workspace** (slash `/trust` or trust prompt), then `/reload`. Untrusted workspaces skip project `.pi/extensions`. |
| Extension only in **global** `~/.pi/agent/extensions/` | Should load without trust; run `/reload` after adding the file. |
| Agent used **`apply_patch`** not `edit` | Use the optional `docs/examples/openpi-edit-confirm.ts` extension (covers `write`, `edit`, `apply_patch`, `patch`, `multiedit`). |
| Old OpenPi build | Rebuild/restart dev app so `ExtensionUiOverlay` + IPC bridge are present. |
| Confirm returns immediately (no UI) | Prior builds had `confirm: () => false` — update OpenPi. |

**Smoke prompt** (in OpenPi, workspace = openpi):

```text
Use only the edit tool: add the line `<!-- smoke -->` after line 1 of docs/AGENT_EDIT_REVIEW.md.
```

## Example: confirm destructive `write` / `edit` (optional project extension)

See [`docs/examples/openpi-edit-confirm.ts`](examples/openpi-edit-confirm.ts). Copy to `~/.pi/agent/extensions/openpi-edit-confirm.ts` to enable.

**Note:** Blocking still runs **before** disk write when the extension returns `block`. **Reject-after-apply** (revert file) is a separate OpenPi workbench feature (Phase 7 diff review + snapshots) — not required for Pi permission gates.

## Next (not in this PR)

- Post-apply review queue + `@codemirror/merge` in file preview (MVP B).
- Wire `tool_execution_start` snapshots in main for revert-on-reject.

## References

- Mario: [minimal Pi / YOLO](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- `@heyhuynhgiabuu/pi-diff` — **post-write** diff display in TUI, not pre-apply gate
- `customize-pi` skill — extensions + packages, not host builtins