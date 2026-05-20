import type { IpcMain } from 'electron'
import { IPC, playSoundEffectSchema } from '../../src/lib/ipc'
import { sanitizeSoundEffect } from '../../src/lib/soundPreferences'

interface SoundIpcDeps {
  ipcMain: IpcMain
  playSoundEffectId: (sound: ReturnType<typeof sanitizeSoundEffect>) => void
}

export function registerSoundIpc(deps: SoundIpcDeps): void {
  deps.ipcMain.handle(IPC.PLAY_SOUND_EFFECT, (_event, raw: unknown): void => {
    const { sound } = playSoundEffectSchema.parse(raw)
    deps.playSoundEffectId(sanitizeSoundEffect(sound))
  })
}
