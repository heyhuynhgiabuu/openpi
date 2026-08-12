import { describe, expect, it, vi } from 'vitest'
import { registerSearchIpc } from '../electron/ipc/search'
import { IPC } from '../src/lib/ipc'

type IpcHandler = (event: unknown, raw?: unknown) => unknown

describe('search IPC cwd authorization', () => {
  it('initializes search with the main-owned cwd', async () => {
    const handlers = new Map<string, IpcHandler>()
    const ensureFffInitialized = vi.fn().mockResolvedValue({
      fffFileSearch: vi.fn(() => []),
    })
    registerSearchIpc({
      ipcMain: {
        handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
      } as unknown as Parameters<typeof registerSearchIpc>[0]['ipcMain'],
      getCwd: () => '/main-owned',
      ensureFffInitialized,
    })
    const handler = handlers.get(IPC.FFF_FILE_SEARCH)
    if (!handler) throw new Error('Expected FFF_FILE_SEARCH handler')

    await handler({}, { query: 'file', pageSize: 20, cwd: '/renderer-controlled' })

    expect(ensureFffInitialized).toHaveBeenCalledWith('/main-owned')
  })
})
