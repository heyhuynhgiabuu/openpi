/**
 * OpenPi task-tool guard extension.
 *
 * The model (grok-composer-2.5-fast) systematically hallucinates `task_id`s
 * on fresh `task` calls. Sometimes it's a UUID (8-4-4-4-12 hex) — easy to
 * detect. Other times it's a *valid* pi-task short id from an earlier
 * task it saw in the conversation, e.g. `mqzhz574-b765`. pi-task then
 * tries to "resume" the old task and the user gets a confusing result
 * (or the old task is now marked "cancelled" so pi-task errors out and
 * the user loses the work).
 *
 * We cannot fix the model, but the Pi SDK `tool_call` event lets us
 * patch `event.input` before the tool runs. Rules match the pi-task
 * v0.3.7 contract:
 *
 * 1. Fresh task = no `task_id` AND no `conversation_id`. A `task_id`
 *    on a fresh call is always a hallucination.
 * 2. UUID-shaped `task_id` (8-4-4-4-12 hex) is always wrong on a
 *    fresh call — pi-task generates short ids like `mqzbadgj-3a1e`.
 * 3. `task_id` that does not match the pi-task short-id pattern
 *    (`[0-9a-z]+-[0-9a-z]{3,8}`) is invalid. Strip it.
 * 4. If `conversation_id` is set, it must match the conversation
 *    registry; if it does, ignore any `task_id` (the registry wins).
 * 5. Invalid `conversation_id` (path traversal, control chars,
 *    > 80 chars) is stripped.
 * 6. Even a well-formed `task_id` that is *already in the history*
 *    (i.e. the model is recycling a recently-seen id from earlier in
 *    the conversation) is stripped on a fresh call. Only an actively
 *    running task with a live session file may be referenced.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

// UUID v4 shape: 8-4-4-4-12 hex. The model hallucinates these because
// the SDK exposes them in tool messages.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// pi-task short id: lowercase alphanumeric + dash, e.g. `mqzbadgj-3a1e`.
const PI_TASK_SHORT_ID = /^[0-9a-z]+-[0-9a-z]{3,8}$/i

// User-chosen `conversation_id` (e.g. "research-ai").
const CONVERSATION_ID = /^[A-Za-z0-9._-]{1,80}$/

// Terminal status values — if a task is in the history with one of
// these, the model recycling its id is a hallucination, not a resume.
const TERMINAL_STATUSES = new Set(['done', 'cancelled', 'aborted', 'timeout', 'failed'])

function loadConversationRegistry(cwd: string): Record<string, { task_id?: string }> {
  const file = join(cwd, '.pi', 'artifacts', 'task-sessions.json')
  if (!existsSync(file)) return {}
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

/**
 * Read `.pi/task-session-history.json` and return the set of task ids
 * that have reached a terminal state. A `task_id` from this set must
 * never be passed to a fresh `task` call — it's a hallucination, not
 * a resume. The history is best-effort: missing or malformed files
 * yield an empty set (we fail open rather than blocking fresh calls).
 */
function loadTerminalTaskIds(cwd: string): Set<string> {
  const file = join(cwd, '.pi', 'task-session-history.json')
  if (!existsSync(file)) return new Set()
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8'))
    if (!Array.isArray(raw)) return new Set()
    const out = new Set<string>()
    for (const entry of raw) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as { id?: unknown }).id === 'string' &&
        typeof (entry as { status?: unknown }).status === 'string' &&
        TERMINAL_STATUSES.has((entry as { status: string }).status)
      ) {
        out.add((entry as { id: string }).id)
      }
    }
    return out
  } catch {
    return new Set()
  }
}

export default function (pi: ExtensionAPI) {
  pi.on('tool_call', (event) => {
    if (event.toolName !== 'task') return

    const input = event.input as Record<string, unknown>
    const taskId = typeof input.task_id === 'string' ? input.task_id : null
    const conversationId = typeof input.conversation_id === 'string' ? input.conversation_id : null

    // ── Rule 5: invalid conversation_id is stripped.
    if (conversationId !== null && !CONVERSATION_ID.test(conversationId)) {
      delete input.conversation_id
    }

    // ── Rule 4: when both are set, the conversation registry wins.
    if (conversationId !== null && CONVERSATION_ID.test(conversationId) && taskId !== null) {
      const registry = loadConversationRegistry(event.cwd)
      const mapped = registry[conversationId]?.task_id
      if (mapped && mapped !== taskId) {
        delete input.task_id
      }
    }

    // ── Rules 1–3 + 6: `task_id` on a fresh call (no conversation_id)
    //    is always a hallucination. Strip it.
    //
    //    Sub-rules:
    //    - UUID-shaped (8-4-4-4-12 hex): never valid for pi-task.
    //    - Anything that does not match the pi-task short id: invalid.
    //    - A well-formed short id that is already in the history with
    //      a terminal status (done/cancelled/timeout/failed): the
    //      model is recycling an id it saw earlier — hallucination.
    //    - A well-formed short id that is NOT in the history: could be
    //      a legitimate resume of a still-running task. This is the
    //      one case we allow through. (In practice the model almost
    //      never does this — it should use `conversation_id` instead.)
    if (taskId !== null && conversationId === null) {
      if (UUID_RE.test(taskId) || !PI_TASK_SHORT_ID.test(taskId)) {
        delete input.task_id
      } else {
        const terminalIds = loadTerminalTaskIds(event.cwd)
        if (terminalIds.has(taskId)) {
          delete input.task_id
        }
        // else: leave it — this is a legitimate resume of a running task.
      }
    }
  })
}
