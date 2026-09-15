import { describe, expect, it, vi } from 'vitest'
import { registerGitIpc } from '../electron/git/ipc'
import { IPC } from '../src/lib/ipc'

type IpcHandler = (event: unknown, raw?: unknown) => unknown
type GitIpcDeps = Parameters<typeof registerGitIpc>[0]

interface StubGitHostMethods {
  getGitStatus?: unknown
  generateCommitMessage?: unknown
}

function stubGitHost(host: StubGitHostMethods): GitIpcDeps['getGitHost'] {
  return async () => {
    // SAFETY: each test supplies the GitHost methods its selected handler reaches.
    return host as unknown as Awaited<ReturnType<GitIpcDeps['getGitHost']>>
  }
}

function createDeps(
  handlers: Map<string, IpcHandler>,
  getGitHost: GitIpcDeps['getGitHost'],
  getCommitAgentContext: GitIpcDeps['getCommitAgentContext'] = async () => undefined
): GitIpcDeps {
  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    on: vi.fn(),
  }
  return {
    // SAFETY: registerGitIpc only calls handle() and on() during these tests.
    ipcMain: ipcMain as unknown as GitIpcDeps['ipcMain'],
    getCwd: () => '/main-owned/worktree',
    getDeferredWorkspace: () => null,
    getGitHost,
    restartGitMonitoring: vi.fn(),
    filterBlockedPaths: vi.fn(() => ({ allowed: [], blocked: [] })),
    confirmHighRiskMutation: vi.fn(),
    getCommitAgentContext,
  }
}

describe('Git IPC cwd authorization', () => {
  it('ignores a renderer cwd for status and uses main-owned state', async () => {
    const handlers = new Map<string, IpcHandler>()
    const getGitStatus = vi.fn().mockResolvedValue({ files: [] })
    const deps = createDeps(handlers, stubGitHost({ getGitStatus }))
    registerGitIpc(deps)
    const handler = handlers.get(IPC.GIT_STATUS)
    if (!handler) throw new Error('Expected GIT_STATUS handler')

    await handler({}, '/renderer-controlled')

    expect(getGitStatus).toHaveBeenCalledWith('/main-owned/worktree')
  })

  it('validates generated commit messages at the IPC boundary', async () => {
    const handlers = new Map<string, IpcHandler>()
    const getGitStatus = vi.fn().mockResolvedValue({ files: [] })
    const generateCommitMessage = vi.fn().mockReturnValue(42)
    const deps = createDeps(
      handlers,
      stubGitHost({ getGitStatus, generateCommitMessage }),
      vi.fn().mockResolvedValue(undefined)
    )
    registerGitIpc(deps)
    const handler = handlers.get(IPC.GIT_GENERATE_COMMIT_MSG)
    if (!handler) throw new Error('Expected GIT_GENERATE_COMMIT_MSG handler')

    await expect(handler({}, undefined)).rejects.toThrow()
    expect(generateCommitMessage).toHaveBeenCalledWith([], undefined)
  })
})
