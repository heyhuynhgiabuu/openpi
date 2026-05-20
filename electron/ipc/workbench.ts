import type { IpcMain } from 'electron'
import { IPC, workbenchContextSchema } from '../../src/lib/ipc'
import type { WorkbenchContext } from '../services/workbenchContext'

interface WorkbenchIpcDeps {
  ipcMain: IpcMain
  getWorkbenchContext: () => WorkbenchContext
  updateTerminalOutput: (value: string | null) => void
  updateVisibleFile: (path: string | null, absolutePath: string | null) => void
}

export function registerWorkbenchIpc(deps: WorkbenchIpcDeps): void {
  deps.ipcMain.on(IPC.WORKBENCH_CONTEXT_UPDATE, (_event, raw: unknown): void => {
    const payload = workbenchContextSchema.parse(raw)
    deps.updateVisibleFile(payload.visibleFile, payload.visibleFileAbs)
    deps.updateTerminalOutput(payload.terminalOutput)
  })

  deps.ipcMain.handle(IPC.WORKBENCH_CONTEXT_GET, (): WorkbenchContext => {
    return deps.getWorkbenchContext()
  })
}
