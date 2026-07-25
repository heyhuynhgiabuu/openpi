/**
 * Sub-session navigation primitives.
 *
 * pi-task v0.3.7 creates one sub-session file per task at
 * `<cwd>/.pi/artifacts/tasks/sessions/<taskId>/<file>.jsonl`. Sub-sessions
 * are first-class nodes in the session tree — clicking a `task` tool row in
 * the parent should navigate to the child, not expand a widget.
 *
 * The functions here are pure: no Solid runtime, no DOM, no IPC. They
 * only compute paths and reason about whether a given session file is a
 * sub-session. Tested in `tests/isSubSessionPath.test.ts`.
 */

/** Current and legacy markers shared by main and renderer to identify sub-sessions. */
export const SUB_SESSION_PATH_HINTS = [
  '/.pi/artifacts/tasks/sessions/',
  '/.pi/artifacts/sessions/',
] as const

/** True iff `path` points inside a pi-task sub-session directory. */
export function isSubSessionPath(path: string | null | undefined): boolean {
  return typeof path === 'string' && SUB_SESSION_PATH_HINTS.some((hint) => path.includes(hint))
}
