import type { IpcMain } from 'electron'
import type { FffFileResult, FffGrepMatch } from '../../src/lib/ipc'
import { fffFileSearchRequestSchema, fffGrepRequestSchema, IPC } from '../../src/lib/ipc'
import type * as FffHost from '../services/fffHost'

interface SearchIpcDeps {
  ipcMain: IpcMain
  getCwd: () => string | null
  ensureFffInitialized: (cwd: string) => Promise<typeof FffHost | null>
}

export function registerSearchIpc(deps: SearchIpcDeps): void {
  deps.ipcMain.handle(
    IPC.FFF_FILE_SEARCH,
    async (_event, raw: unknown): Promise<FffFileResult[]> => {
      const { query, pageSize } = fffFileSearchRequestSchema.parse(raw)
      const cwd = deps.getCwd()
      if (!cwd) return []
      const host = await deps.ensureFffInitialized(cwd)
      if (!host) return []
      return host.fffFileSearch(query, pageSize)
    }
  )

  deps.ipcMain.handle(IPC.FFF_GREP, async (_event, raw: unknown): Promise<FffGrepMatch[]> => {
    const { query, mode, smartCase, maxMatchesPerFile, timeBudgetMs } =
      fffGrepRequestSchema.parse(raw)
    const cwd = deps.getCwd()
    if (!cwd) return []
    const host = await deps.ensureFffInitialized(cwd)
    if (!host) return []
    return host.fffGrep(query, { mode, smartCase, maxMatchesPerFile, timeBudgetMs })
  })
}
