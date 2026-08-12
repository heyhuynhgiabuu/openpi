import { describe, expect, it, vi } from 'vitest'
import { registerWorkspacesIpc } from '../electron/ipc/workspaces'
import { IPC } from '../src/lib/ipc'

type IpcHandler = (event: unknown, raw?: unknown) => unknown

describe('workspace IPC authorization', () => {
  it('rejects Git metadata reads for an unknown renderer workspace', async () => {
    const handlers = new Map<string, IpcHandler>()
    const getWorkspaceSummary = vi.fn().mockResolvedValue({
      cwd: '/renderer-controlled',
      displayName: 'renderer-controlled',
      branch: null,
      lastModifiedAt: null,
    })
    const deps: Parameters<typeof registerWorkspacesIpc>[0] = {
      ipcMain: {
        handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
      } as unknown as Parameters<typeof registerWorkspacesIpc>[0]['ipcMain'],
      getCwd: () => '/active',
      getGitHost: async () =>
        ({ getWorkspaceSummary }) as unknown as Awaited<
          ReturnType<Parameters<typeof registerWorkspacesIpc>[0]['getGitHost']>
        >,
      getSessionIndex: () =>
        ({ listWorkspaces: () => [{ path: '/known' }] }) as unknown as NonNullable<
          ReturnType<Parameters<typeof registerWorkspacesIpc>[0]['getSessionIndex']>
        >,
      getCustomizationsHost: vi.fn(),
      getAgentDir: () => '/agent',
      confirmHighRiskMutation: vi.fn(),
    }
    registerWorkspacesIpc(deps)
    const handler = handlers.get(IPC.GET_WORKSPACE_SUMMARY)
    if (!handler) throw new Error('Expected GET_WORKSPACE_SUMMARY handler')

    await expect(handler({}, { cwd: '/renderer-controlled' })).rejects.toThrow(/unknown workspace/i)
    expect(getWorkspaceSummary).not.toHaveBeenCalled()
  })
})
