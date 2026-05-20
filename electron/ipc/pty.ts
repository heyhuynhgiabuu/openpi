import type { IpcMain } from 'electron'
import {
  IPC,
  ptyCloseSchema,
  ptyCreateSchema,
  ptyResizeSchema,
  ptyWriteSchema,
} from '../../src/lib/ipc'
import type { PtyHost } from '../services/ptyHost'

type PtyHostInstance = InstanceType<typeof PtyHost>

interface PtyIpcDeps {
  ipcMain: IpcMain
  hasPtyHost: () => boolean
  getPtyHost: () => Promise<PtyHostInstance>
}

export function registerPtyIpc(deps: PtyIpcDeps): void {
  deps.ipcMain.handle(IPC.PTY_CREATE, async (_event, raw: unknown): Promise<string> => {
    const { cwd, cols, rows } = ptyCreateSchema.parse(raw)
    return (await deps.getPtyHost()).create(cwd, cols, rows)
  })

  deps.ipcMain.on(IPC.PTY_WRITE, (_event, raw: unknown) => {
    const { id, data } = ptyWriteSchema.parse(raw)
    if (deps.hasPtyHost()) void deps.getPtyHost().then((host) => host.write(id, data))
  })

  deps.ipcMain.on(IPC.PTY_RESIZE, (_event, raw: unknown) => {
    const { id, cols, rows } = ptyResizeSchema.parse(raw)
    if (deps.hasPtyHost()) void deps.getPtyHost().then((host) => host.resize(id, cols, rows))
  })

  deps.ipcMain.on(IPC.PTY_CLOSE, (_event, raw: unknown) => {
    const { id } = ptyCloseSchema.parse(raw)
    if (deps.hasPtyHost()) void deps.getPtyHost().then((host) => host.close(id))
  })
}
