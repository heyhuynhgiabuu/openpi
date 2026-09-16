/**
 * Wires OpenPi's core slash commands to the live session. Pure adapter: each
 * command maps to a session action, a document event (overlays own those),
 * or a small formatted dialog.
 */

import { createMemo } from 'solid-js'
import { buildCoreSlashCommands, type CoreSlashCommand } from '../../lib/coreCommands'
import type { useOpenPiSession } from '../../hooks/useOpenPiSession'

export function useCoreSlashCommands(
  session: ReturnType<typeof useOpenPiSession>,
  actions: {
    onConnectProvider: () => void
    onOpenSessionMap: () => void
  }
) {
  return createMemo<CoreSlashCommand[]>(() =>
    buildCoreSlashCommands({
      sessionReady: session.ready !== null,
      onCompact: (customInstructions) => void session.compactSession(customInstructions),
      onReload: () => void session.reloadSession(),
      onCopyLast: () => session.copyLastAssistantText(),
      onOpenModelPicker: () => {
        document.dispatchEvent(new CustomEvent('openpi:open-model-picker'))
      },
      onOpenSettings: () => {
        document.dispatchEvent(
          new CustomEvent('openpi:open-customizations', { detail: { tab: 'settings' } })
        )
      },
      onOpenLogin: () => actions.onConnectProvider(),
      onLogout: () => actions.onConnectProvider(),
      onNewSession: () => void session.createNewSession(),
      onOpenResumeDialog: () => {
        // Open the homescreen overlay, which lists all sessions and
        // workspaces — the natural place to pick something to resume.
        document.dispatchEvent(new CustomEvent('openpi:open-homescreen'))
      },
      onCycleThinking: () => {
        const order = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
        const cur = session.thinkingLevel as (typeof order)[number]
        const idx = order.indexOf(cur)
        const next = order[(idx + 1) % order.length]
        if (next) void session.selectThinkingLevel(next)
      },
      onCycleModel: () => {
        const list = session.models
        const cur = session.currentModel
        if (!list.length) return
        const idx = cur ? list.findIndex((m) => m.id === cur.id && m.provider === cur.provider) : -1
        const next = list[(idx + 1) % list.length]
        if (next) void session.selectModel(next)
      },
      onSetSessionName: (name) => void session.setSessionName(name),
      onOpenSessionMap: () => actions.onOpenSessionMap(),
      onShowSessionInfo: async () => {
        const info = (await session.getSessionInfo()) as {
          sessionFile: string | null
          sessionId: string | null
          sessionName: string | null
          model: { name: string; provider: string } | null
          thinkingLevel: string | null
          messageCount: number
          contextUsagePercent: number | null
          contextTokens: number | null
          contextWindow: number | null
        } | null
        if (!info) {
          return
        }
        const lines: string[] = []
        if (info.sessionName) lines.push(`Name: ${info.sessionName}`)
        if (info.sessionId) lines.push(`ID: ${info.sessionId}`)
        if (info.sessionFile) lines.push(`File: ${info.sessionFile}`)
        if (info.model) lines.push(`Model: ${info.model.name} (${info.model.provider})`)
        if (info.thinkingLevel) lines.push(`Thinking: ${info.thinkingLevel}`)
        lines.push(`Messages: ${info.messageCount}`)
        if (info.contextUsagePercent != null) {
          const pct = info.contextUsagePercent.toFixed(1)
          const tokens =
            info.contextTokens != null && info.contextWindow
              ? ` (${info.contextTokens.toLocaleString()} / ${info.contextWindow.toLocaleString()} tokens)`
              : ''
          lines.push(`Context: ${pct}%${tokens}`)
        }
        window.alert(lines.join('\n'))
      },
      onExportSession: () => {
        return window.openpi
          .exportSessionBundle()
          .then((result) => {
            if (result.status === 'cancelled') return
            if (result.status === 'error') {
              window.alert(result.message)
              return
            }
            const lines = [
              `Session exported to:`,
              result.outDir,
              '',
              `${result.files.length} file(s) copied (SHA-256 recorded in manifest.json).`,
            ]
            if (result.subSessionTaskIds.length > 0) {
              lines.push(`Sub-sessions: ${result.subSessionTaskIds.length}`)
            }
            for (const warning of result.warnings) lines.push(`⚠ ${warning}`)
            window.alert(lines.join('\n'))
          })
          .catch((err: unknown) => {
            window.alert(err instanceof Error ? err.message : String(err))
          })
      },
      onShowError: (msg) => {
        window.alert(msg)
      },
      onPrefillInput: (text) => session.setInput(text),
    })
  )
}
