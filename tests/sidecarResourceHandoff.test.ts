import { describe, expect, it, vi } from 'vitest'

/**
 * The hand-off from the sidecar to the resource commands. Everything downstream is tested; this is
 * the one identifier in between, and dropping it would empty the slash picker on a durable session
 * with the whole suite green.
 */

const handed = vi.hoisted(() => ({ deps: undefined as unknown }))
const state = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))
const durable = vi.hoisted(() => ({
  handleCommand: vi.fn(async () => false),
}))

vi.mock('../electron/pi/resourceCommands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../electron/pi/resourceCommands')>()
  return {
    ...actual,
    handleResourceCommand: async (_command: unknown, deps: unknown) => {
      handed.deps = deps
    },
  }
})
vi.mock('../electron/pi/sidecarContext', () => ({
  getAgentDir: () => '/agent',
  getModelRuntime: vi.fn(async () => ({})),
  getResourceLoader: vi.fn(),
  getState: () => state.current,
  onParentMessage: vi.fn(),
  outputLine: vi.fn(),
  send: vi.fn(),
}))
vi.mock('../electron/pi/durableHost', () => ({
  durableSessions: { ...durable, cwd: () => undefined, promptCommands: () => [] },
}))

const { handleCommand } = await import('../electron/pi/sidecar')
const { resourceCommandDeps } = await import('../electron/pi/resourceDeps')

describe('the sidecar resource hand-off', () => {
  it('passes the deps built for whichever runtime is serving', async () => {
    await handleCommand({ type: 'list_slash_commands', requestId: 'r1' })
    // The same object, not a rebuilt copy: a copy could quietly lose the durable fallbacks.
    expect(handed.deps).toBe(resourceCommandDeps)
  })

  it('builds those deps with the durable fallbacks the picker needs', () => {
    expect(resourceCommandDeps.getDurableCommands()).toEqual([])
    // No SDK session either, so the cwd falls through both.
    expect(resourceCommandDeps.getCwd()).toBeNull()
  })

  it('falls back to the durable workspace when no SDK session is serving', async () => {
    const { durableSessions } = await import('../electron/pi/durableHost')
    const cwd = vi.spyOn(durableSessions, 'cwd').mockReturnValue('/durable-workspace')
    try {
      const { resourceCommandDeps: deps } = await import('../electron/pi/resourceDeps')
      expect(deps.getCwd()).toBe('/durable-workspace')
    } finally {
      cwd.mockRestore()
    }
  })
})

describe('the deps the SDK path needs', () => {
  it('hands the serving SDK session through, so its commands are listed', async () => {
    // Every user runs this path. A null here empties the slash picker for all of them, and it was
    // untested before because the deps were built inline in a function nothing could import.
    const session = { extensionRunner: { getRegisteredCommands: () => [] }, promptTemplates: [] }
    // SAFETY: the deps only read `cwd` and `session` off the sidecar state.
    state.current = { cwd: '/sdk-workspace', session } as unknown as Record<string, unknown>
    const { resourceCommandDeps } = await import('../electron/pi/resourceDeps')
    expect(resourceCommandDeps.getSession()).toBe(session)
    expect(resourceCommandDeps.getCwd()).toBe('/sdk-workspace')
  })
})
