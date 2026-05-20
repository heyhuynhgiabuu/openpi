import fs from 'node:fs'
import type { IpcMain } from 'electron'
import { IPC } from '../../src/lib/ipc'

function readThemeJson(rawPath: unknown): Record<string, unknown> | null {
  if (typeof rawPath !== 'string' || !rawPath.endsWith('.json')) return null
  try {
    return JSON.parse(fs.readFileSync(rawPath, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function resolveHex(
  value: string | number | undefined,
  vars: Record<string, string | number>
): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number') return null
  if (value.startsWith('#')) return value
  const resolved = vars[value]
  if (typeof resolved === 'string' && resolved.startsWith('#')) return resolved
  return null
}

export function registerThemeIpc(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.READ_THEME_COLORS, (_event, rawPath: unknown) => {
    const json = readThemeJson(rawPath)
    if (!json) return null
    const vars = (json.vars ?? {}) as Record<string, string | number>
    const colors = (json.colors ?? {}) as Record<string, string | number>

    return {
      accent: resolveHex(colors.accent, vars),
      border: resolveHex(colors.border, vars),
      userMessageBg: resolveHex(colors.userMessageBg, vars),
      toolSuccessBg: resolveHex(colors.toolSuccessBg, vars),
      toolErrorBg: resolveHex(colors.toolErrorBg, vars),
      syntaxKeyword: resolveHex(colors.syntaxKeyword, vars),
      syntaxString: resolveHex(colors.syntaxString, vars),
      mdHeading: resolveHex(colors.mdHeading, vars),
    }
  })

  ipcMain.handle(IPC.READ_THEME_TOKENS, (_event, rawPath: unknown) => {
    const json = readThemeJson(rawPath)
    if (!json) return null
    const rawVars = (json.vars ?? {}) as Record<string, string | number>
    const rawColors = (json.colors ?? {}) as Record<string, string | number>

    const vars: Record<string, string> = {}
    for (const [key, value] of Object.entries(rawVars)) {
      const hex = resolveHex(value, rawVars)
      if (hex) vars[key] = hex
    }

    const colors: Record<string, string> = {}
    for (const [key, value] of Object.entries(rawColors)) {
      const hex = resolveHex(value, rawVars)
      if (hex) colors[key] = hex
    }

    return { vars, colors }
  })
}
