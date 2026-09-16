# Monotonic policy audit — Electron main mutation paths

Date: 2026-09-15 · Scope: every main-process path that can mutate workspace or
agent state (file IPC, Git IPC, workspace trust, session archive/export,
protected paths, high-risk confirms). Property audited, following the
deny-only guard discipline from dsh's tool pipeline (see the DeepSeek Harness
audit): **a policy check may deny or abstain, never re-allow; confirmation is
one-shot with Cancel as the default; authorization failures are terminal.**

## Violations found and fixed in this audit

The initial pass found three mutation handlers with incomplete protected-path
coverage in `electron/ipc/files.ts`; all three now follow the write/delete
discipline (hard → throw, soft → one-shot confirm with Cancel default,
re-check after the confirmation window):

- `RENAME_FILE` checked only the rename target; the source path could be a
  soft-protected file renamed away without confirmation. Now checks both.
- `COPY_FILE` had no protected-path check; a copy could create content under
  a hard-blocked name (credential stores, key material). Now checks the
  destination before copying.
- `FORMAT_FILE` rewrote content in place with no check at all. Now checks and
  confirms like a write; a declined confirmation returns the file's original
  content so the editor buffer is not blanked.

## Findings — the remaining patterns already hold

| Surface | Mechanism | Monotonic property |
| --- | --- | --- |
| High-risk confirm (`electron/main.ts`) | `dialog.showMessageBox` with Cancel as `defaultId`/`cancelId`; `response === 1` is the only approval | No window → deny; cancel/Esc → deny; nothing can re-ask or override |
| Confirm consumers (`files.ts` ×4: write/rename/copy/format, `git/ipc.ts` ×2, `customizations.ts` ×2, `workspaces.ts` ×1, `session/ipc.ts` bash ×1) | `const approved = await …; if (!approved) return/throw` | Deny is terminal at all 10 sites; no result inversion, no swallow-and-proceed |
| File write/delete/rename/copy/format (`files.ts`) | hard violation → throw; soft → confirm; then re-resolve + re-check (`dev`/`ino` on write/delete/rename) | TOCTOU guarded on both sides of every confirmation; copy checks the destination, rename checks source and target |
| File delete (`files.ts`) | hard/scope → throw; soft → trash-confirm with Cancel default; post-confirm `dev`/`ino` re-check | Git metadata refused unconditionally |
| Protected paths in Git (`git/ipc.ts`) | `filterBlockedPaths` before stage/commit/hunk-apply; any blocked path throws | Partial blocks never degrade to partial proceed |
| IPC sender (`safeIpc.ts`) | `handle`/`handleOnce`/`on`/`once` all wrapped; sender + frame + URL must match the main window | Untrusted senders throw (invoke) or are dropped (events) |
| Workspace trust (`workspaces.ts`) | Granting trust with project extensions requires a confirm listing them; deny returns `trusted: false`; revoking is always allowed | Risky direction gated, safe direction free; decision mirrored to the bridge trust file |
| Session containment (`sessionPath.ts`) | anchor/root/file walk rejects symlinks per component + realpath containment | Reused by archive, delete, read, sub-session, and export paths |
| Session export (`services/sessionExport.ts`) | parent + sub-session files authorized separately (unauthorized sub-sessions skip with a per-task warning); bundle directory created exclusively so an existing bundle is never overwritten; copies verified byte-identical with a live-run hint in the error | |

## Deliberate exceptions (read-only or skip-with-report degradation)

- Archived-session listing skips entries it cannot authorize (`continue`) —
  the listing is cosmetic.
- Restore (`unarchive`) silently skips entries that fail authorization; bulk
  delete counts each failure and can partially succeed, with per-path failures
  logged and a `failed` count returned. The per-item authorization itself is
  deny-only: an entry that cannot be authorized is never restored or deleted.
- The trajectory ledger and session index read models fail soft to empty
  rather than blocking the UI; they expose no mutation surface.
- Sub-session export skips unresolvable/unauthorized sub-sessions with a
  per-task warning recorded in the manifest and result (an export is a
  convenience copy, not a mutation of the skipped source).

## Conclusion

The three file-IPC violations found (rename source, copy destination, format
in-place) were fixed in `electron/ipc/files.ts` during this audit. Beyond
those fixes, no path was found where a later check re-allows an earlier
denial, where a
confirmation failure proceeds, or where an authorization catch degrades a
mutation into an allowance. New mutation surfaces should preserve the two
load-bearing idioms: **confirm is one-shot with a safe default**, and **re-
resolve + re-check after any user-visible confirmation window**.
