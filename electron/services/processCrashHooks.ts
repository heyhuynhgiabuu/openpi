/**
 * processCrashHooks — main-process crash capture.
 *
 * Forwards crashes and unhandled rejections to the Output pane, then exits so
 * Electron doesn't run in a corrupted state. Split from main.ts (300-LOC rule);
 * behavior is identical to the original inline hooks.
 */
import { app } from 'electron'
import type { OutputLine } from '../../src/lib/ipc'

export function installProcessCrashHooks(emit: (line: OutputLine) => void): void {
  // Capture main-process crashes and forward them to the Output pane,
  // then exit so Electron doesn't run in a corrupted state.
  process.on('uncaughtException', (err: Error) => {
    const text = `[crash] ${err.message}${err.stack ? `\n${err.stack}` : ''}`
    process.stderr.write(`[main] uncaughtException: ${err.stack ?? err.message}\n`)
    emit({ level: 'error', text, ts: Date.now() })
    // Give the IPC channel one tick to flush before hard-exit.
    setImmediate(() => app.exit(1))
  })
  process.on('unhandledRejection', (reason: unknown) => {
    const text =
      reason instanceof Error
        ? `[rejection] ${reason.message}${reason.stack ? `\n${reason.stack}` : ''}`
        : `[rejection] ${String(reason)}`
    process.stderr.write(`[main] unhandledRejection: ${text}\n`)
    emit({ level: 'warn', text, ts: Date.now() })
  })
}
