import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { describe, expect, it, vi } from 'vitest'
import { openBranches } from '../electron/pi/durable/branches'
import type { Harness } from '@earendil-works/pi-durable'

/**
 * Phase 8.4a: the conversation ids a resume reads out of a session file. A wrong one must not leave
 * an opened store and its MCP servers running with nothing holding a handle to close them.
 */

function harnessWith(branches: Record<number, object>) {
  const close = vi.fn(async () => undefined)
  const conversation = vi.fn(async (id: number) => branches[id])
  // SAFETY: `openBranches` uses only these two methods of the harness it is handed.
  return { harness: { conversation, close } as unknown as Harness, close, conversation }
}

describe('openBranches', () => {
  it('opens the conversations a session is made of, in order', async () => {
    const { harness, close } = harnessWith({ 1: { id: 1 }, 7: { id: 7 } })
    const releaseExtras = vi.fn(async () => undefined)
    const branches = await openBranches(harness, [1, 7], releaseExtras, BACKGROUND_CONTEXT)
    expect(branches.map((branch) => Number(branch.id))).toEqual([1, 7])
    expect(close).not.toHaveBeenCalled()
    expect(releaseExtras).not.toHaveBeenCalled()
  })

  it('closes the store and the MCP bridge when an id is not in it, then throws', async () => {
    const { harness, close } = harnessWith({ 1: { id: 1 } })
    const releaseExtras = vi.fn(async () => undefined)
    await expect(openBranches(harness, [1, 99], releaseExtras, BACKGROUND_CONTEXT)).rejects.toThrow(
      'conversation 99 not found in the store'
    )
    expect(releaseExtras).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('still throws when closing itself fails', async () => {
    const { harness } = harnessWith({})
    harness.close = vi.fn(async () => {
      throw new Error('close failed')
    })
    const releaseExtras = vi.fn(async () => {
      throw new Error('mcp close failed')
    })
    await expect(openBranches(harness, [99], releaseExtras, BACKGROUND_CONTEXT)).rejects.toThrow(
      'conversation 99 not found'
    )
  })

  it('has nothing to open when the session uses the store root', async () => {
    const { harness, close } = harnessWith({})
    expect(await openBranches(harness, undefined, undefined, BACKGROUND_CONTEXT)).toEqual([])
    expect(close).not.toHaveBeenCalled()
  })
})
