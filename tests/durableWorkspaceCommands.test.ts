import { describe, expect, it, vi } from 'vitest'

/**
 * Commands that read a per-workspace setting used to fall back to the SDK session state, which is
 * null while a durable session is active: the trust toggle went nowhere and the slash menu came back
 * empty. They now take the workspace from whichever runtime is serving.
 */

const workspace = vi.hoisted(() => ({ cwd: undefined as string | undefined }))
const settings = vi.hoisted(() => ({
  create: vi.fn((_cwd: string, _agentDir: string) => ({
    getDefaultProjectTrust: () => 'never',
    setDefaultProjectTrust: vi.fn(),
  })),
}))
vi.mock('../electron/pi/sidecarContext', () => ({
  getAgentDir: () => '/agent',
  getState: () => null,
  send: vi.fn(),
}))
vi.mock('../electron/pi/durableHost', () => ({
  durableSessions: { cwd: () => workspace.cwd },
}))
vi.mock('@earendil-works/pi-coding-agent', () => ({ SettingsManager: settings }))

const { handleGetDefaultProjectTrustCommand, handleSetDefaultProjectTrustCommand } =
  await import('../electron/pi/providerCommands')

describe('commands that need the workspace', () => {
  it('reads the trust setting of the durable workspace, not "ask"', async () => {
    settings.create.mockClear()
    workspace.cwd = '/durable-workspace'
    await handleGetDefaultProjectTrustCommand({
      type: 'get_default_project_trust',
      requestId: 'r1',
    })
    expect(settings.create).toHaveBeenCalledWith('/durable-workspace', '/agent')
  })

  it('writes the trust setting of the durable workspace, not nothing', async () => {
    settings.create.mockClear()
    workspace.cwd = '/durable-workspace'
    await handleSetDefaultProjectTrustCommand({
      type: 'set_default_project_trust',
      defaultProjectTrust: 'never',
    })
    expect(settings.create).toHaveBeenCalledWith('/durable-workspace', '/agent')
  })

  it('answers "ask" when no runtime is serving a workspace', async () => {
    settings.create.mockClear()
    workspace.cwd = undefined
    await handleGetDefaultProjectTrustCommand({
      type: 'get_default_project_trust',
      requestId: 'r2',
    })
    expect(settings.create).not.toHaveBeenCalled()
  })
})
