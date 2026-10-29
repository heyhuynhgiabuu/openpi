import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which trust a restored session reopens with. Trust is per workspace and decides whether that
 * workspace's project MCP servers start, so a restore that takes the trust of whatever request
 * failed can hand a workspace features the user never granted it — in either direction.
 */

const state = vi.hoisted(() => ({
  current: null as null | {
    cwd: string
    workspaceTrusted: boolean
    session: { sessionFile?: string }
  },
}))

vi.mock('../electron/pi/sidecarContext', () => ({
  getState: () => state.current,
  outputLine: vi.fn(),
}))

const { previousSession, restoreSession } = await import('../electron/pi/sessionRestore')

describe('restoring an SDK session', () => {
  beforeEach(() => {
    state.current = null
  })

  it('reads its own trust, so an untrusted session does not come back trusted', async () => {
    state.current = {
      cwd: '/untrusted',
      workspaceTrusted: false,
      session: { sessionFile: '/s.jsonl' },
    }
    const previous = previousSession()
    expect(previous?.workspaceTrusted).toBe(false)
    if (!previous) throw new Error('the session should have been captured')
    const start = vi.fn(async () => undefined)
    await restoreSession(previous, start)
    expect(start).toHaveBeenCalledWith('/untrusted', {
      sessionFile: '/s.jsonl',
      workspaceTrusted: false,
      restoring: true,
    })
  })

  it('does not downgrade a trusted session either', async () => {
    state.current = { cwd: '/trusted', workspaceTrusted: true, session: {} }
    const previous = previousSession()
    expect(previous?.workspaceTrusted).toBe(true)
    if (!previous) throw new Error('the session should have been captured')
    const start = vi.fn(async () => undefined)
    await restoreSession(previous, start)
    // No file to reopen: the restore opens the same workspace fresh.
    expect(start).toHaveBeenCalledWith('/trusted', { workspaceTrusted: true, restoring: true })
  })
})
