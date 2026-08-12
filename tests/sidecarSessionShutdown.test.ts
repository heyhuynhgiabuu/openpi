import { describe, expect, it, vi } from 'vitest'
import { createSidecarMessageHandler } from '../electron/pi/messages'
import { teardownSession } from '../electron/pi/sessionTeardown'
import { isStaleExtensionCtxEvent, isStaleExtensionCtxMessage } from '../electron/pi/staleCtx'

/**
 * Regression: pi-task (and similar) capture `pi` in setInterval polling.
 * Pi SDK invalidates extension ctx on reload() and session replacement.
 * Sidecar must emit session_shutdown before reload/dispose.
 *
 * Logic mirrored from electron/pi/sidecar.ts startSession shutdown reason.
 */
function shutdownReasonForStart(opts: {
  sessionFile?: string
  forkEntryId?: string
}): 'new' | 'resume' | 'fork' {
  if (opts.forkEntryId) return 'fork'
  if (opts.sessionFile) return 'resume'
  return 'new'
}

describe('sidecar session teardown', () => {
  it('aborts active work before extension shutdown and disposal', async () => {
    const events: string[] = []
    const session = {
      abort: async () => {
        events.push('abort')
      },
      dispose: () => {
        events.push('dispose')
      },
    }

    await teardownSession(session, async () => {
      events.push('shutdown')
    })

    expect(events).toEqual(['abort', 'shutdown', 'dispose'])
  })

  it('still shuts down and disposes when abort rejects', async () => {
    const events: string[] = []
    const session = {
      abort: async () => {
        events.push('abort')
        throw new Error('abort failed')
      },
      dispose: () => {
        events.push('dispose')
      },
    }

    await expect(
      teardownSession(session, async () => {
        events.push('shutdown')
      })
    ).resolves.toBeUndefined()
    expect(events).toEqual(['abort', 'shutdown', 'dispose'])
  })
})

describe('sidecar session_shutdown reasons', () => {
  it('fork when branching', () => {
    expect(shutdownReasonForStart({ sessionFile: '/a.jsonl', forkEntryId: 'e1' })).toBe('fork')
  })

  it('resume when opening existing session', () => {
    expect(shutdownReasonForStart({ sessionFile: '/a.jsonl' })).toBe('resume')
  })

  it('new for fresh session', () => {
    expect(shutdownReasonForStart({})).toBe('new')
  })
})

/**
 * Regression: pi-task raises "This extension ctx is stale after session
 * replacement or reload..." as an extension_error event when our
 * reload path does a full session replace while pi-task's polling
 * is mid-flight. The filter is in `onError` in electron/pi/sidecar.ts;
 * it must catch the *real* SDK error string, not just a guess. The
 * SDK capitalises "This" — the old filter was case-sensitive and
 * missed it, surfacing noise to the user.
 */
describe('sidecar stale-ctx error filter', () => {
  it('filters the exact SDK message after a session replacement', () => {
    const msg =
      'This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacemen…'
    expect(isStaleExtensionCtxMessage(msg)).toBe(true)
  })

  it('filters stale ctx extension_error events before UI notification', () => {
    const event = {
      type: 'extension_error',
      message: 'This extension ctx is stale after session replacement or reload.',
    }
    expect(isStaleExtensionCtxEvent(event)).toBe(true)

    const showSystemNotification = vi.fn()
    const emitOutputLine = vi.fn()
    const handler = createSidecarMessageHandler({
      getMainWindow: () => null,
      normalizeSessionReady: (payload) => payload,
      applySessionReady: vi.fn(),
      refreshSessionIndex: async () => {},
      resolveActiveCwd: () => null,
      showSystemNotification,
      playSoundEffect: vi.fn(),
      getGitHost: async () => await import('../electron/git/gitHost'),
      emitSessionError: vi.fn(),
      emitOutputLine,
    })

    handler({ type: 'session_event', event })

    expect(emitOutputLine).not.toHaveBeenCalled()
    expect(showSystemNotification).not.toHaveBeenCalled()
  })

  it('filters the case-insensitive "ctx is stale after" form', () => {
    expect(isStaleExtensionCtxMessage('ctx is stale after reload')).toBe(true)
    expect(isStaleExtensionCtxMessage('this extension ctx is stale')).toBe(true)
  })

  it('does not filter unrelated extension errors', () => {
    expect(isStaleExtensionCtxMessage('TypeError: cannot read property foo')).toBe(false)
    expect(isStaleExtensionCtxMessage('Extension crashed: out of memory')).toBe(false)
    expect(isStaleExtensionCtxMessage('')).toBe(false)
  })
})
