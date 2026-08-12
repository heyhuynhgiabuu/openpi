import { describe, expect, it, vi } from 'vitest'
import { registerGitIpc } from '../electron/git/ipc'
import { IPC } from '../src/lib/ipc'

type IpcHandler = (event: unknown, raw?: unknown) => unknown

describe('Git IPC cwd authorization', () => {
  it('ignores a renderer cwd for status and uses main-owned state', async () => {
    const handlers = new Map<string, IpcHandler>()
    const getGitStatus = vi.fn().mockResolvedValue({ files: [] })
    const deps: Parameters<typeof registerGitIpc>[0] = {
      ipcMain: {
        handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
        on: vi.fn(),
      } as unknown as Parameters<typeof registerGitIpc>[0]['ipcMain'],
      getCwd: () => '/main-owned/worktree',
      getDeferredWorkspace: () => null,
      getGitHost: async () =>
        ({ getGitStatus }) as unknown as Awaited<
          ReturnType<Parameters<typeof registerGitIpc>[0]['getGitHost']>
        >,
      restartGitMonitoring: vi.fn(),
      filterBlockedPaths: vi.fn(() => ({ allowed: [], blocked: [] })),
      confirmHighRiskMutation: vi.fn(),
      getCommitAgentContext: vi.fn(),
    }
    registerGitIpc(deps)
    const handler = handlers.get(IPC.GIT_STATUS)
    if (!handler) throw new Error('Expected GIT_STATUS handler')

    await handler({}, '/renderer-controlled')

    expect(getGitStatus).toHaveBeenCalledWith('/main-owned/worktree')
  })
})
