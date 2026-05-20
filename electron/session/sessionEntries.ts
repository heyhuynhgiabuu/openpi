import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type { SessionHistoryMessage, SessionHistoryPage } from '../../src/lib/ipc'
import { canonicalizePath, contentToText, isRecord, numeric, truncate } from './sessionEntryUtils'
import { appendHistoryEntry, type HistoryReadState, trimHistoryMessages } from './sessionHistory'

export type FileEntry = Record<string, unknown> & { type: string }
export type SessionEntry = FileEntry & { id: string; parentId: string | null; timestamp: string }
export type SessionInfo = {
  path: string
  id: string
  cwd: string
  name?: string
  parentSessionPath?: string | null
  created: Date
  modified: Date
  messageCount: number
  firstMessage: string
}

export type UsageTotals = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
}

export type SessionHistoryPageOptions = {
  limit?: number
  beforeEntryId?: string
}

export const DEFAULT_HISTORY_PAGE_LIMIT = 200
export const MAX_HISTORY_PAGE_LIMIT = 500

export function listSessionInfos(workspacePath?: string): SessionInfo[] {
  const sessionsRoot = path.join(os.homedir(), '.pi', 'agent', 'sessions')
  if (!fs.existsSync(sessionsRoot)) return []

  const dirs = workspacePath
    ? [getDefaultSessionDir(workspacePath)]
    : fs
        .readdirSync(sessionsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(sessionsRoot, entry.name))

  const infos: SessionInfo[] = []
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    let files: string[]
    try {
      files = fs.readdirSync(dir).filter((file) => file.endsWith('.jsonl'))
    } catch {
      continue
    }

    for (const file of files) {
      const info = buildSessionInfo(path.join(dir, file), workspacePath)
      if (info) infos.push(info)
    }
  }

  return infos.sort((a, b) => b.modified.getTime() - a.modified.getTime())
}

export function getDefaultSessionDir(cwd: string): string {
  const safePath = `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  return path.join(os.homedir(), '.pi', 'agent', 'sessions', safePath)
}

export function buildSessionInfo(
  filePath: string,
  expectedWorkspacePath?: string
): SessionInfo | null {
  try {
    const stats = fs.statSync(filePath)
    const firstLine = readFirstLine(filePath)
    if (!firstLine) return null
    const header = JSON.parse(firstLine) as unknown
    if (!isRecord(header) || header.type !== 'session' || typeof header.id !== 'string') return null

    const cwd = typeof header.cwd === 'string' ? canonicalizePath(header.cwd) : ''
    if (expectedWorkspacePath && cwd !== expectedWorkspacePath) return null

    const timestamp = typeof header.timestamp === 'string' ? header.timestamp : undefined
    return {
      path: filePath,
      id: header.id,
      cwd,
      parentSessionPath: typeof header.parentSession === 'string' ? header.parentSession : null,
      created: timestamp ? new Date(timestamp) : stats.birthtime,
      modified: stats.mtime,
      messageCount: 0,
      firstMessage: '',
    }
  } catch {
    return null
  }
}

export function readFirstLine(filePath: string): string | null {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(4096)
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.toString('utf8', 0, bytesRead).split('\n')[0] ?? null
  } finally {
    fs.closeSync(fd)
  }
}

export function parseSessionFile(filePath: string): {
  header: FileEntry | null
  entries: SessionEntry[]
} {
  try {
    const fileEntries = parseSessionEntries(fs.readFileSync(filePath, 'utf8'))
    const header = fileEntries.find((entry) => entry.type === 'session') ?? null
    const entries = fileEntries.filter((entry): entry is SessionEntry => entry.type !== 'session')
    return { header, entries }
  } catch {
    return { header: null, entries: [] }
  }
}

export function parseSessionEntries(content: string): FileEntry[] {
  const entries: FileEntry[] = []
  for (const line of content.trim().split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as unknown
      if (isRecord(entry) && typeof entry.type === 'string') entries.push(entry as FileEntry)
    } catch {
      // Skip malformed lines, matching Pi's session parser behavior.
    }
  }
  return entries
}

export async function readSessionHistoryPage(
  filePath: string,
  options: SessionHistoryPageOptions
): Promise<SessionHistoryPage> {
  const limit = normalizeHistoryLimit(options.limit)
  const branchIds = await readCurrentBranchIds(filePath)
  if (branchIds.size === 0) return emptyHistoryPage(limit)

  const messages: SessionHistoryMessage[] = []
  const historyState: HistoryReadState = { lastUserTimestampMs: null }
  let hasMoreBefore = false
  const beforeEntryId = options.beforeEntryId

  for await (const fileEntry of streamSessionEntries(filePath)) {
    const entry = normalizeSessionEntry(fileEntry)
    if (!entry || !branchIds.has(entry.id)) continue
    if (beforeEntryId && entry.id === beforeEntryId) break

    appendHistoryEntry(messages, entry, historyState)
    if (trimHistoryMessages(messages, limit)) hasMoreBefore = true
  }

  return {
    messages,
    hasMoreBefore,
    nextBeforeEntryId: messages[0]?.id ?? null,
    limit,
  }
}

export async function readCurrentBranchIds(filePath: string): Promise<Set<string>> {
  const parents = new Map<string, string | null>()
  let leafId: string | null = null

  for await (const fileEntry of streamSessionEntries(filePath)) {
    const entry = normalizeSessionEntry(fileEntry)
    if (!entry) continue
    parents.set(entry.id, entry.parentId)
    leafId = entry.id
  }

  const branchIds = new Set<string>()
  let currentId = leafId
  while (currentId && !branchIds.has(currentId)) {
    branchIds.add(currentId)
    currentId = parents.get(currentId) ?? null
  }
  return branchIds
}

export async function* streamSessionEntries(filePath: string): AsyncGenerator<FileEntry> {
  const input = fs.createReadStream(filePath, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })

  try {
    for await (const line of lines) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as unknown
        if (isRecord(entry) && typeof entry.type === 'string') yield entry as FileEntry
      } catch {
        // Skip malformed lines, matching Pi's session parser behavior.
      }
    }
  } finally {
    lines.close()
    input.destroy()
  }
}

export function normalizeSessionEntry(entry: FileEntry): SessionEntry | null {
  if (entry.type === 'session') return null
  const id = entry.id
  if (typeof id !== 'string' || !id) return null
  return {
    ...entry,
    id,
    parentId: typeof entry.parentId === 'string' ? entry.parentId : null,
    timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : '',
  }
}

export function normalizeHistoryLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_HISTORY_PAGE_LIMIT
  return Math.min(MAX_HISTORY_PAGE_LIMIT, Math.max(1, Math.floor(limit)))
}

export function historyPageCacheKey(
  sessionPath: string,
  limit: number,
  beforeEntryId: string | undefined
): string {
  return `${sessionPath}\u0000${limit}\u0000${beforeEntryId ?? ''}`
}

export function emptyHistoryPage(limit: number): SessionHistoryPage {
  return { messages: [], hasMoreBefore: false, nextBeforeEntryId: null, limit }
}

export function latestModel(entries: SessionEntry[]): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.type === 'model_change') {
      const e = entry as unknown as { modelId?: string }
      if (e.modelId) return e.modelId
    }
  }
  return ''
}

export function latestSessionName(entries: SessionEntry[]): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    const name = entry.name
    if (entry.type === 'session_info' && typeof name === 'string' && name.trim()) {
      return name.trim()
    }
  }
  return ''
}

export function firstUserMessage(entries: SessionEntry[]): string {
  for (const entry of entries) {
    if (entry.type !== 'message') continue
    const message = entry.message as { role?: string; content?: unknown }
    if (message.role === 'user') return truncate(contentToText(message.content), 140)
  }
  return ''
}

export function usageTotals(entries: SessionEntry[]): UsageTotals {
  return entries.reduce<UsageTotals>(
    (totals, entry) => {
      if (entry.type !== 'message') return totals
      const message = entry.message as { role?: string; usage?: Record<string, unknown> }
      if (message.role !== 'assistant' || !message.usage) return totals
      const usage = message.usage
      totals.inputTokens += numeric(usage.input) || numeric(usage.inputTokens)
      totals.outputTokens += numeric(usage.output) || numeric(usage.outputTokens)
      totals.cacheReadTokens += numeric(usage.cacheRead) || numeric(usage.cacheReadTokens)
      totals.cacheWriteTokens += numeric(usage.cacheWrite) || numeric(usage.cacheWriteTokens)
      const cost = usage.cost as { total?: unknown } | number | undefined
      totals.cost += typeof cost === 'number' ? cost : numeric(cost?.total)
      return totals
    },
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 }
  )
}
