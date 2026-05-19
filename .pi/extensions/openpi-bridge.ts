/**
 * openpi-bridge — Pi extension for Pi TUI ↔ OpenPi sync.
 *
 * Writes agent lifecycle events to a shared JSON file so OpenPi and Pi TUI can
 * detect when an agent is running in the other app. When loaded by Pi TUI, it
 * also polls that file and renders OpenPi activity as a compact themed widget.
 *
 * Both Pi TUI and OpenPi load this extension from ~/.pi/agent/extensions/.
 * OpenPi also watches the file from Electron main to mirror Pi TUI sessions.
 *
 * Installed at .pi/extensions/openpi-bridge.ts (project-local) — auto-loaded
 * when OpenPi starts in this repo. Copy to ~/.pi/agent/extensions/ for
 * global availability across all repos (including Pi TUI).
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import { type Component, truncateToWidth } from '@earendil-works/pi-tui'

const SYNC_FILE = join(homedir(), '.pi', 'agent', '.openpi-sync.json')
const SESSION_ROOT = join(homedir(), '.pi', 'agent', 'sessions')
const SYNC_STALE_MS = 10_000
const POLL_MS = 1_000
const HEARTBEAT_MS = 750
const HISTORY_PREVIEW_LIMIT = 12
const WIDGET_PREVIEW_LIMIT = 2
const STATUS_KEY = 'openpi-bridge'
const WIDGET_KEY = 'openpi-bridge'
const BRIDGE_VERSION = 2

type SyncPayload = {
  pid?: number
  app?: string
  status?: 'running' | 'idle'
  timestamp?: number
  workspace?: string
  sessionFile?: string | null
  startedAt?: number
  bridgeVersion?: number
  previewMessages?: PreviewMessage[]
  messageCount?: number
}

type SessionEntry = {
  type: string
  id: string
  parentId: string | null
  message?: unknown
}

type PreviewMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  live?: boolean
}

type MirrorSnapshot = {
  live: boolean
  stale: boolean
  workspace: string
  updatedAt: number
  messageCount: number
  messages: PreviewMessage[]
  needsOpenPiRestart: boolean
}

export default function (pi: ExtensionAPI) {
  /** Detect which app loaded this extension via environment hint. */
  const app = process.env.OPENPI_BRIDGE_APP ?? 'pi-tui'
  const mirrorsOpenPi = app !== 'openpi'
  let startedAt: number | undefined
  let lastHeartbeatMs = 0
  let liveAssistantText = ''
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let lastMirrorKey = ''
  let lastNotifiedRunKey = ''
  let lastNotifiedMessageId = ''
  let mirrorWidget: OpenPiMirrorWidget | undefined
  let requestMirrorRender: (() => void) | undefined

  function writeState(state: Record<string, unknown>) {
    try {
      mkdirSync(dirname(SYNC_FILE), { recursive: true })
      writeFileSync(
        SYNC_FILE,
        JSON.stringify({
          ...state,
          pid: process.pid,
          app,
          bridgeVersion: BRIDGE_VERSION,
          timestamp: Date.now(),
        }),
        'utf-8'
      )
    } catch {
      // non-fatal — sync is best-effort
    }
  }

  function writeRunningState(ctx: ExtensionContext, force = false) {
    const now = Date.now()
    if (!force && now - lastHeartbeatMs < HEARTBEAT_MS) return
    lastHeartbeatMs = now
    startedAt ??= now
    const sessionFile = ctx.sessionManager.getSessionFile() ?? null
    const previewMessages = buildLocalPreview(sessionFile, liveAssistantText)
    writeState({
      status: 'running',
      workspace: ctx.cwd,
      sessionFile,
      startedAt,
      previewMessages,
      messageCount: previewMessages.length,
    })
  }

  function clearMirror(ctx: ExtensionContext) {
    if (!ctx.hasUI) return
    ctx.ui.setStatus(STATUS_KEY, undefined)
    ctx.ui.setWidget(WIDGET_KEY, undefined)
    mirrorWidget = undefined
    requestMirrorRender = undefined
    lastMirrorKey = ''
  }

  function startMirror(ctx: ExtensionContext) {
    if (!mirrorsOpenPi || !ctx.hasUI || pollTimer) return
    pollTimer = setInterval(() => renderOpenPiMirror(ctx), POLL_MS)
    renderOpenPiMirror(ctx)
  }

  function renderOpenPiMirror(ctx: ExtensionContext) {
    const state = readSyncPayload()
    if (!state || state.app !== 'openpi' || state.pid === process.pid) {
      clearMirror(ctx)
      return
    }

    const timestamp = typeof state.timestamp === 'number' ? state.timestamp : 0
    const stale = timestamp > 0 && Date.now() - timestamp > SYNC_STALE_MS
    const sessionFile = normalizeSessionFile(state.sessionFile)
    const hasLivePreviewPayload =
      state.bridgeVersion === BRIDGE_VERSION && Array.isArray(state.previewMessages)
    const payloadMessages = normalizePreviewMessages(state.previewMessages)
    const historyMessages = sessionFile
      ? readSessionPreview(sessionFile, HISTORY_PREVIEW_LIMIT)
      : []
    const messages = payloadMessages.length > 0 ? payloadMessages : historyMessages
    const latestId = messages.at(-1)?.id ?? ''
    const mirrorKey = `${state.status ?? 'idle'}:${timestamp}:${sessionFile ?? ''}:${latestId}:${messages.at(-1)?.text ?? ''}`
    if (mirrorKey === lastMirrorKey) return
    lastMirrorKey = mirrorKey

    if (stale && state.status !== 'running') {
      clearMirror(ctx)
      return
    }

    const snapshot: MirrorSnapshot = {
      live: state.status === 'running' && !stale,
      stale,
      workspace: workspaceName(state.workspace),
      updatedAt: timestamp,
      messageCount: Math.max(state.messageCount ?? 0, messages.length),
      messages,
      needsOpenPiRestart: state.app === 'openpi' && !hasLivePreviewPayload,
    }

    ctx.ui.setStatus(
      STATUS_KEY,
      snapshot.needsOpenPiRestart
        ? '↔ OpenPi restart needed'
        : snapshot.live
          ? '↔ OpenPi live'
          : '↔ OpenPi synced'
    )
    ensureMirrorWidget(ctx, snapshot)
    mirrorWidget?.update(snapshot)
    requestMirrorRender?.()
    notifyLatestMirrorMessage(ctx, snapshot)

    const runKey = `${state.startedAt ?? timestamp}:${sessionFile ?? ''}`
    if (snapshot.live && runKey && runKey !== lastNotifiedRunKey) {
      lastNotifiedRunKey = runKey
      ctx.ui.notify(
        `OpenPi is running${snapshot.workspace ? ` in ${snapshot.workspace}` : ''}`,
        'info'
      )
    }
  }

  function notifyLatestMirrorMessage(ctx: ExtensionContext, snapshot: MirrorSnapshot) {
    if (!snapshot.live || snapshot.needsOpenPiRestart) return
    const latest = snapshot.messages.at(-1)
    if (!latest?.text || latest.id === lastNotifiedMessageId) return
    lastNotifiedMessageId = latest.id
    const label = latest.role === 'user' ? 'OpenPi user' : 'OpenPi'
    ctx.ui.notify(`${label}: ${oneLine(latest.text).slice(0, 180)}`, 'info')
  }

  function ensureMirrorWidget(ctx: ExtensionContext, snapshot: MirrorSnapshot) {
    if (mirrorWidget) return
    ctx.ui.setWidget(
      WIDGET_KEY,
      (tui, theme) => {
        mirrorWidget = new OpenPiMirrorWidget(theme, snapshot)
        requestMirrorRender = () => tui.requestRender()
        return mirrorWidget
      },
      { placement: 'aboveEditor' }
    )
  }

  pi.on('session_start', (_event: unknown, ctx: ExtensionContext) => {
    startMirror(ctx)
  })

  pi.on('agent_start', (_event: unknown, ctx: ExtensionContext) => {
    startMirror(ctx)
    startedAt = Date.now()
    liveAssistantText = ''
    writeRunningState(ctx, true)
  })

  pi.on('message_update', (event: unknown, ctx: ExtensionContext) => {
    const nextText = assistantTextFromUpdate(event)
    if (nextText) liveAssistantText = nextText
    writeRunningState(ctx)
  })

  pi.on('message_end', (event: unknown, ctx: ExtensionContext) => {
    const text = assistantTextFromMessageEnd(event)
    if (text) liveAssistantText = text
    writeRunningState(ctx, true)
  })

  pi.on('tool_execution_update', (_event: unknown, ctx: ExtensionContext) => {
    writeRunningState(ctx)
  })

  pi.on('agent_end', (_event: unknown, ctx: ExtensionContext) => {
    const sessionFile = ctx.sessionManager.getSessionFile() ?? null
    const previewMessages = buildLocalPreview(sessionFile, '')
    writeState({
      status: 'idle',
      workspace: ctx.cwd,
      sessionFile,
      previewMessages,
      messageCount: previewMessages.length,
    })
    startedAt = undefined
    liveAssistantText = ''
  })

  pi.on('session_shutdown', (_event: unknown, ctx: ExtensionContext) => {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = undefined
    clearMirror(ctx)
  })
}

class OpenPiMirrorWidget implements Component {
  private snapshot: MirrorSnapshot

  constructor(
    private readonly theme: Theme,
    snapshot: MirrorSnapshot
  ) {
    this.snapshot = snapshot
  }

  update(snapshot: MirrorSnapshot): void {
    this.snapshot = snapshot
    this.invalidate()
  }

  render(width: number): string[] {
    if (width <= 0) return []
    const snap = this.snapshot
    const lines: string[] = []
    const stateLabel = snap.needsOpenPiRestart
      ? 'restart OpenPi'
      : snap.stale
        ? 'stale'
        : snap.live
          ? 'live'
          : 'synced'
    const stateColor =
      snap.needsOpenPiRestart || snap.stale ? 'warning' : snap.live ? 'success' : 'muted'
    const title = [
      this.theme.fg('accent', '↔ OpenPi'),
      this.theme.fg(stateColor, `● ${stateLabel}`),
      snap.workspace ? this.theme.fg('dim', snap.workspace) : '',
      this.theme.fg('dim', `${snap.messageCount} msgs`),
      this.theme.fg('dim', formatAge(snap.updatedAt)),
    ]
      .filter(Boolean)
      .join(this.theme.fg('dim', ' · '))
    lines.push(truncateToWidth(title, width))

    const preview = latestTurn(snap.messages).slice(-WIDGET_PREVIEW_LIMIT)
    if (snap.needsOpenPiRestart) {
      lines.push(
        truncateToWidth(
          this.theme.fg(
            'warning',
            'OpenPi is using the old bridge. Restart OpenPi to enable live preview.'
          ),
          width
        )
      )
    }

    if (preview.length === 0) {
      lines.push(truncateToWidth(this.theme.fg('dim', 'Waiting for OpenPi output…'), width))
      return lines
    }

    for (const message of preview) {
      const label = message.role === 'user' ? 'You' : 'OpenPi'
      const labelColor = message.role === 'user' ? 'accent' : 'customMessageLabel'
      const live = message.live ? this.theme.fg('success', ' streaming') : ''
      const line = `${this.theme.fg(labelColor, `${label}:`)} ${this.theme.fg('text', oneLine(message.text))}${live}`
      lines.push(truncateToWidth(line, width))
    }

    return lines
  }

  invalidate(): void {
    // Stateless render: theme is applied fresh every render.
  }
}

function readSyncPayload(): SyncPayload | null {
  try {
    const parsed = JSON.parse(readFileSync(SYNC_FILE, 'utf-8')) as unknown
    return isRecord(parsed) ? (parsed as SyncPayload) : null
  } catch {
    return null
  }
}

function normalizeSessionFile(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const root = resolve(SESSION_ROOT)
  const file = resolve(value)
  const rel = relative(root, file)
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  try {
    statSync(file)
    return file
  } catch {
    return null
  }
}

function buildLocalPreview(sessionFile: string | null, liveText: string): PreviewMessage[] {
  const messages = sessionFile ? readSessionPreview(sessionFile, HISTORY_PREVIEW_LIMIT) : []
  const trimmedLiveText = liveText.trim()
  if (!trimmedLiveText) return messages

  const last = messages.at(-1)
  if (last?.role === 'assistant') {
    return [...messages.slice(0, -1), { ...last, text: trimmedLiveText, live: true }]
  }

  return [
    ...messages,
    { id: 'live-assistant', role: 'assistant', text: trimmedLiveText, live: true },
  ].slice(-HISTORY_PREVIEW_LIMIT)
}

function readSessionPreview(sessionFile: string, limit: number): PreviewMessage[] {
  try {
    const entries = readSessionEntries(sessionFile)
    const branchIds = currentBranchIds(entries)
    const messages: PreviewMessage[] = []
    for (const entry of entries) {
      if (!branchIds.has(entry.id) || entry.type !== 'message') continue
      const message = isRecord(entry.message) ? entry.message : {}
      const role = typeof message.role === 'string' ? message.role : ''
      if (role === 'user') {
        const text = contentToText(message.content)
        if (text) messages.push({ id: entry.id, role: 'user', text })
      } else if (role === 'assistant') {
        const text = assistantText(message.content)
        if (text) messages.push({ id: entry.id, role: 'assistant', text })
      }
    }
    return messages.slice(-limit)
  } catch {
    return []
  }
}

function readSessionEntries(sessionFile: string): SessionEntry[] {
  return readFileSync(sessionFile, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown
      } catch {
        return null
      }
    })
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .filter((entry) => entry.type !== 'session')
    .map((entry) => ({
      ...entry,
      type: typeof entry.type === 'string' ? entry.type : '',
      id: typeof entry.id === 'string' ? entry.id : '',
      parentId: typeof entry.parentId === 'string' ? entry.parentId : null,
    }))
    .filter((entry): entry is SessionEntry => Boolean(entry.id && entry.type))
}

function currentBranchIds(entries: SessionEntry[]): Set<string> {
  const parents = new Map<string, string | null>()
  let leafId: string | null = null
  for (const entry of entries) {
    parents.set(entry.id, entry.parentId)
    leafId = entry.id
  }

  const ids = new Set<string>()
  let currentId = leafId
  while (currentId && !ids.has(currentId)) {
    ids.add(currentId)
    currentId = parents.get(currentId) ?? null
  }
  return ids
}

function normalizePreviewMessages(value: unknown): PreviewMessage[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): PreviewMessage | null => {
      if (!isRecord(item)) return null
      const role = item.role === 'user' || item.role === 'assistant' ? item.role : null
      const text = typeof item.text === 'string' ? item.text.trim() : ''
      const id =
        typeof item.id === 'string' && item.id ? item.id : `${role ?? 'message'}-${text.length}`
      if (!role || !text) return null
      return { id, role, text, live: item.live === true }
    })
    .filter((message): message is PreviewMessage => message !== null)
    .slice(-HISTORY_PREVIEW_LIMIT)
}

function latestTurn(messages: PreviewMessage[]): PreviewMessage[] {
  const latest = messages.at(-1)
  if (!latest) return []
  if (latest.role === 'user') return [latest]

  for (let i = messages.length - 2; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return [messages[i]!, latest]
  }
  return [latest]
}

function assistantTextFromUpdate(event: unknown): string {
  if (!isRecord(event)) return ''
  const assistantEvent = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : null
  const partial = assistantEvent && isRecord(assistantEvent.partial) ? assistantEvent.partial : null
  return partial ? assistantText(partial.content) : ''
}

function assistantTextFromMessageEnd(event: unknown): string {
  if (!isRecord(event)) return ''
  const message = isRecord(event.message) ? event.message : null
  return message ? assistantText(message.content) : ''
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (isRecord(part) && typeof part.text === 'string') return part.text
      return ''
    })
    .join('')
    .trim()
}

function assistantText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (isRecord(part) && part.type === 'text') return String(part.text ?? '')
      return ''
    })
    .join('')
    .trim()
}

function workspaceName(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  const trimmed = value.replace(/\/$/, '')
  return trimmed.split('/').pop() || trimmed
}

function formatAge(timestamp: number): string {
  if (!timestamp) return 'just now'
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 2) return 'now'
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.floor(seconds / 60)}m ago`
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
