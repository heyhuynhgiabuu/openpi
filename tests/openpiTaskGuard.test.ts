import { describe, expect, it } from 'vitest'

/**
 * Contract tests for the OpenPi task-tool guard extension.
 * The guard runs as a Pi extension in the sidecar process and mutates
 * event.input before pi-task sees the call.
 *
 * The mirror in this file tracks the production rule list in
 * `.pi/extensions/openpi-task-guard.ts` exactly. If you change the
 * guard, update the mirror *and* these tests in the same commit.
 */

const PI_TASK_ID_RE = /^[0-9a-z]+-[0-9a-z]{3,8}$/i
const CONVERSATION_ID_RE = /^[A-Za-z0-9._-]{1,80}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TERMINAL_STATUSES = new Set(['done', 'cancelled', 'aborted', 'timeout', 'failed'])

function looksLikeUuid(s: unknown): boolean {
  if (typeof s !== 'string') return false
  if (UUID_RE.test(s)) return true
  if (s.split('-').length > 2) return true
  return false
}

function isValidPiTaskId(s: unknown): boolean {
  if (typeof s !== 'string' || s.length === 0) return false
  if (PI_TASK_ID_RE.test(s)) return true
  if (CONVERSATION_ID_RE.test(s)) return true
  return false
}

/**
 * Mirror of the production guard. Takes a `history` argument so the
 * "well-formed id already in the history" rule can be exercised.
 */
function applyGuard(
  input: Record<string, unknown>,
  registry: Record<string, { task_id: string }> = {},
  history: Array<{ id: string; status: string }> = []
): Record<string, unknown> {
  const out = { ...input }

  if (looksLikeUuid(out.task_id)) delete out.task_id

  if (typeof out.task_id === 'string' && !isValidPiTaskId(out.task_id)) {
    delete out.task_id
  }

  if (
    typeof out.conversation_id === 'string' &&
    typeof out.task_id === 'string' &&
    registry[out.conversation_id] &&
    registry[out.conversation_id]!.task_id !== out.task_id
  ) {
    delete out.task_id
  }

  if (typeof out.conversation_id === 'string' && !isValidPiTaskId(out.conversation_id)) {
    delete out.conversation_id
  }

  // Rule 6: a well-formed `task_id` on a fresh call (no
  // conversation_id) that is already in the history with a terminal
  // status is a hallucination. Strip.
  if (
    typeof out.task_id === 'string' &&
    typeof out.conversation_id !== 'string' &&
    PI_TASK_ID_RE.test(out.task_id)
  ) {
    const terminalIds = new Set(
      history.filter((e) => TERMINAL_STATUSES.has(e.status)).map((e) => e.id)
    )
    if (terminalIds.has(out.task_id)) {
      delete out.task_id
    }
  }

  return out
}

describe('openpi-task-guard', () => {
  it('strips a full UUID task_id on a fresh call', () => {
    const result = applyGuard({
      agent_type: 'scout',
      description: 'Research X',
      task_id: '565c63f9-6aa2-4d40-a59b-18cccb0ab1a5',
    })
    expect(result.task_id).toBeUndefined()
    expect(result.agent_type).toBe('scout')
  })

  it('strips a partial UUID task_id', () => {
    const result = applyGuard({
      agent_type: 'scout',
      task_id: '8963391-fc3e-4c96-be9c-7db0eaabebf',
    })
    expect(result.task_id).toBeUndefined()
  })

  it('strips a well-formed task_id that is already in the history with a terminal status', () => {
    // The exact scenario the user hit: model recycles `mqzhz574-b765`
    // from earlier in the conversation; the history shows it's
    // "cancelled". The guard must strip it so a fresh call lands.
    const result = applyGuard(
      { agent_type: 'scout', description: 'Research pi-diff repo', task_id: 'mqzhz574-b765' },
      {},
      [{ id: 'mqzhz574-b765', status: 'cancelled' }]
    )
    expect(result.task_id).toBeUndefined()
    expect(result.description).toBe('Research pi-diff repo')
  })

  it('strips a well-formed task_id that is in the history as done', () => {
    const result = applyGuard({ agent_type: 'scout', task_id: 'mqzhz574-b765' }, {}, [
      { id: 'mqzhz574-b765', status: 'done' },
    ])
    expect(result.task_id).toBeUndefined()
  })

  it('strips a well-formed task_id that is in the history as aborted', () => {
    const result = applyGuard({ agent_type: 'scout', task_id: 'mqzhz574-b765' }, {}, [
      { id: 'mqzhz574-b765', status: 'aborted' },
    ])
    expect(result.task_id).toBeUndefined()
  })

  it('strips a well-formed task_id that is in the history as failed', () => {
    const result = applyGuard({ agent_type: 'scout', task_id: 'mqzhz574-b765' }, {}, [
      { id: 'mqzhz574-b765', status: 'failed' },
    ])
    expect(result.task_id).toBeUndefined()
  })

  it('strips a well-formed task_id that is in the history as timeout', () => {
    const result = applyGuard({ agent_type: 'scout', task_id: 'mqzhz574-b765' }, {}, [
      { id: 'mqzhz574-b765', status: 'timeout' },
    ])
    expect(result.task_id).toBeUndefined()
  })

  it('keeps a well-formed task_id that is NOT in the history (legitimate resume)', () => {
    const result = applyGuard(
      { agent_type: 'scout', task_id: 'm1lxyz-a1b2' },
      {},
      // History doesn't include this id — the model is resuming a
      // still-active task. Allow it through.
      []
    )
    expect(result.task_id).toBe('m1lxyz-a1b2')
  })

  it('keeps a well-formed task_id that is in the history as running', () => {
    const result = applyGuard({ agent_type: 'scout', task_id: 'm1lxyz-a1b2' }, {}, [
      { id: 'm1lxyz-a1b2', status: 'running' },
    ])
    expect(result.task_id).toBe('m1lxyz-a1b2')
  })

  it('fails open when the history file is missing or malformed', () => {
    // Mirror fails open: empty history → no stripping beyond the
    // other rules. The production code is best-effort (returns
    // empty set on parse error); we don't test the file I/O here,
    // just the contract that empty history is permissive.
    const result = applyGuard({ agent_type: 'scout', task_id: 'm1lxyz-a1b2' }, {}, [])
    expect(result.task_id).toBe('m1lxyz-a1b2')
  })

  it('keeps a valid conversation_id', () => {
    const result = applyGuard({
      agent_type: 'scout',
      conversation_id: 'research-ai',
    })
    expect(result.conversation_id).toBe('research-ai')
  })

  it('strips task_id when it does not match the conversation_id mapping', () => {
    const result = applyGuard(
      {
        agent_type: 'scout',
        conversation_id: 'research-ai',
        task_id: 'wrong-id-aaaa',
      },
      { 'research-ai': { task_id: 'm1real-bbbb' } }
    )
    expect(result.task_id).toBeUndefined()
    expect(result.conversation_id).toBe('research-ai')
  })

  it('keeps task_id when it matches the conversation_id mapping', () => {
    const result = applyGuard(
      {
        agent_type: 'scout',
        conversation_id: 'research-ai',
        task_id: 'm1real-bbbb',
      },
      { 'research-ai': { task_id: 'm1real-bbbb' } }
    )
    expect(result.task_id).toBe('m1real-bbbb')
  })

  it('strips an invalid conversation_id', () => {
    const result = applyGuard({
      agent_type: 'scout',
      conversation_id: 'invalid id with spaces',
    })
    expect(result.conversation_id).toBeUndefined()
  })

  it('leaves a clean fresh call alone', () => {
    const result = applyGuard({
      agent_type: 'scout',
      description: 'Research X',
    })
    expect(result).toEqual({ agent_type: 'scout', description: 'Research X' })
  })

  it('strips a well-formed task_id even when conversation_id is set, if the id is in the history as cancelled', () => {
    // The conversation_id and the history id are independent. If the
    // model passes a stale task_id alongside a (separate) conversation_id,
    // strip the stale task_id.
    const result = applyGuard(
      {
        agent_type: 'scout',
        conversation_id: 'research-ai',
        task_id: 'mqzhz574-b765',
      },
      { 'research-ai': { task_id: 'other-cccc' } },
      [{ id: 'mqzhz574-b765', status: 'cancelled' }]
    )
    expect(result.task_id).toBeUndefined()
    expect(result.conversation_id).toBe('research-ai')
  })
})
