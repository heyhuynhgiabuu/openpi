import { fauxProvider } from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDurableHarness } from '../electron/pi/durable/harness'

/**
 * Phase 8.4a: a resume reads its conversation ids from a session file, so one can name a store the
 * harness does not have. Whatever the open started must be closed before it throws — a test of
 * `openBranches` alone cannot tell whether `openDurableHarness` still passes it the MCP bridge.
 */

const mocks = vi.hoisted(() => ({ closeMcp: vi.fn(async () => undefined), bridge: vi.fn() }))

vi.mock('../electron/pi/durable/mcp', () => ({
  loadMcpExtension: async () => {
    mocks.bridge()
    return { extension: undefined, errors: [], close: mocks.closeMcp }
  },
}))

afterEach(() => {
  mocks.closeMcp.mockClear()
  mocks.bridge.mockClear()
})

describe('opening a durable harness with ids a store does not have', () => {
  it('closes the MCP bridge and the store before throwing', async () => {
    const faux = fauxProvider()
    await expect(
      openDurableHarness({
        backend: 'memory',
        model: { provider: faux.getModel().provider, modelId: faux.getModel().id },
        registerProviders: (models) => models.setProvider(faux.provider),
        // The MCP branch needs a workspace path; the mock is what records the close.
        mcp: true,
        workspacePath: '/work',
        userAgentDir: '/agent',
        tools: false,
        policy: false,
        conversationIds: [999],
      })
    ).rejects.toThrow('conversation 999 not found in the store')

    // The bridge was started and closed; nothing kept it running.
    expect(mocks.bridge).toHaveBeenCalledTimes(1)
    expect(mocks.closeMcp).toHaveBeenCalledTimes(1)
  })
})
