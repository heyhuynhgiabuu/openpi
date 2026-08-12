import { describe, expect, it, vi } from 'vitest'
import { registerPtyIpc } from '../electron/ipc/pty'
import { IPC } from '../src/lib/ipc'

type IpcHandler = (event: unknown, raw?: unknown) => unknown

type PtyIpcDeps = Parameters<typeof registerPtyIpc>[0]
type PtyHost = Awaited<ReturnType<PtyIpcDeps['getPtyHost']>>

function createHandler(mainCwd: string | null, create: ReturnType<typeof vi.fn>): IpcHandler {
  const handlers = new Map<string, IpcHandler>()
  const deps = {
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
      on: vi.fn(),
    } as unknown as PtyIpcDeps['ipcMain'],
    getCwd: () => mainCwd,
    hasPtyHost: () => true,
    getPtyHost: async () => ({ create }) as unknown as PtyHost,
  } as unknown as PtyIpcDeps
  registerPtyIpc(deps)
  const handler = handlers.get(IPC.PTY_CREATE)
  if (!handler) throw new Error('Expected PTY_CREATE handler')
  return handler
}

describe('PTY IPC cwd authorization', () => {
  it('uses the main-owned active cwd instead of the renderer cwd', async () => {
    const create = vi.fn().mockResolvedValue('pty-1')
    const handler = createHandler('/main-owned/worktree', create)

    await handler({}, { cwd: '/renderer-controlled', cols: 80, rows: 24 })

    expect(create).toHaveBeenCalledWith('/main-owned/worktree', 80, 24)
  })

  it('rejects creation when no main-owned cwd is active', async () => {
    const create = vi.fn()
    const handler = createHandler(null, create)

    await expect(handler({}, { cwd: '/renderer-controlled', cols: 80, rows: 24 })).rejects.toThrow(
      /no active workspace/i
    )
    expect(create).not.toHaveBeenCalled()
  })
})
