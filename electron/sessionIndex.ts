import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import Database from 'better-sqlite3'
import type {
  SessionHistoryMessage,
  SessionHistoryPage,
  SessionHistoryToolCard,
  SessionListItem,
  SessionListOptions,
  WorkspaceInfo,
} from '../src/lib/ipc'

type FileEntry = Record<string, unknown> & { type: string }
type SessionEntry = FileEntry & { id: string; parentId: string | null; timestamp: string }
type SessionInfo = {
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

type SessionRow = {
  path: string
  session_id: string
  cwd: string
  workspace_path: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
  first_message: string
  all_messages_text: string
  parent_session_path: string | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost: number
  entry_count: number
  branch_count: number
  last_model: string
  file_mtime: number
}

type WorkspaceRow = {
  path: string
  display_name: string
  last_opened_at: string | null
  session_count: number
}

type UsageTotals = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
}

type SessionHistoryPageOptions = {
  limit?: number
  beforeEntryId?: string
}

const DEFAULT_HISTORY_PAGE_LIMIT = 200
const MAX_HISTORY_PAGE_LIMIT = 500

export class SessionIndexStore {
  private readonly db: Database.Database
  private readonly MAX_CACHE_ENTRIES = 8
  /** mtime-keyed bounded page cache — never retains full large transcripts in main */
  private readonly messageCache = new Map<string, { mtime: number; page: SessionHistoryPage }>()

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  close(): void {
    this.db.close()
  }

  upsertWorkspace(cwd: string): string {
    const workspacePath = canonicalizePath(cwd)
    this.db
      .prepare(`
      insert into workspaces(path, display_name, last_opened_at)
      values (@path, @displayName, @lastOpenedAt)
      on conflict(path) do update set
        display_name = excluded.display_name,
        last_opened_at = excluded.last_opened_at
    `)
      .run({
        path: workspacePath,
        displayName: displayNameForPath(workspacePath),
        lastOpenedAt: new Date().toISOString(),
      })
    return workspacePath
  }

  getLastWorkspace(): string | null {
    const row = this.db
      .prepare(`
      select path from workspaces
      where last_opened_at is not null
      order by last_opened_at desc
      limit 1
    `)
      .get() as { path: string } | undefined
    return row?.path ?? null
  }

  listWorkspaces(): WorkspaceInfo[] {
    const rows = this.db
      .prepare(`
      select w.path, w.display_name, w.last_opened_at,
        count(s.path) as session_count
      from workspaces w
      left join sessions s on s.workspace_path = w.path
      where w.last_opened_at is not null
      group by w.path
      order by w.last_opened_at desc, w.display_name asc
    `)
      .all() as WorkspaceRow[]

    return rows.map((row) => ({
      path: row.path,
      displayName: row.display_name,
      lastOpenedAt: row.last_opened_at,
      sessionCount: row.session_count,
    }))
  }

  async refreshSessions(
    activeSessionPath?: string | null,
    workspacePath?: string
  ): Promise<SessionListItem[]> {
    const infos = listSessionInfos(workspacePath)
    const seen = new Set<string>()

    const tx = this.db.transaction((sessions: SessionInfo[]) => {
      for (const info of sessions) {
        seen.add(info.path)
        this.upsertSession(info)
      }
    })
    tx(infos)

    // Only delete stale rows within the scoped workspace — rows from other
    // workspaces haven't been scanned so must not be evicted.
    if (seen.size > 0) {
      const placeholders = Array.from(seen)
        .map(() => '?')
        .join(',')
      if (workspacePath) {
        this.db
          .prepare(
            `delete from sessions where workspace_path = ? and path not in (${placeholders})`
          )
          .run(workspacePath, ...seen)
      } else {
        this.db.prepare(`delete from sessions where path not in (${placeholders})`).run(...seen)
      }
    }

    return this.listSessions({}, activeSessionPath, workspacePath)
  }

  listSessions(
    options: SessionListOptions = {},
    activeSessionPath?: string | null,
    workspacePath?: string
  ): SessionListItem[] {
    const showRecent = options.showRecent ?? true
    const recentDays = options.recentDays ?? 30
    const sortBy = options.sortBy ?? 'created'
    const query = options.query?.trim().toLowerCase()
    const limit = options.limit ? Math.min(Math.max(options.limit, 1), 500) : null
    const offset = options.offset ? Math.max(options.offset, 0) : 0

    const where: string[] = []
    const params: Record<string, unknown> = {}

    // Workspace scope — show only sessions from the active workspace.
    if (workspacePath) {
      where.push('workspace_path = @workspacePath')
      params.workspacePath = workspacePath
    }
    if (showRecent) {
      where.push('updated_at >= @recentCutoff')
      params.recentCutoff = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000).toISOString()
    }
    if (query) {
      where.push(
        '(lower(title) like @query or lower(cwd) like @query or lower(first_message) like @query)'
      )
      params.query = `%${query}%`
    }

    const orderBy =
      sortBy === 'updated' ? 'updated_at desc, created_at desc' : 'created_at desc, updated_at desc'
    const rows = this.db
      .prepare(`
      select
        path, session_id, cwd, workspace_path, title, created_at, updated_at,
        message_count, first_message, '' as all_messages_text, parent_session_path,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost,
        entry_count, branch_count, last_model
      from sessions
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by ${orderBy}
      ${limit ? 'limit @limit offset @offset' : ''}
    `)
      .all({ ...params, limit, offset }) as SessionRow[]

    return rows.map((row) => ({
      path: row.path,
      id: row.session_id,
      cwd: row.cwd,
      workspacePath: row.workspace_path,
      workspaceName: displayNameForPath(row.workspace_path),
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
      firstMessage: row.first_message,
      parentSessionPath: row.parent_session_path,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
      cost: row.cost,
      entryCount: row.entry_count,
      branchCount: row.branch_count,
      lastModel: row.last_model ?? '',
      active: activeSessionPath === row.path,
    }))
  }

  getSessionWorkspace(sessionPath: string): string | null {
    const row = this.db
      .prepare('select workspace_path from sessions where path = ?')
      .get(sessionPath) as { workspace_path: string } | undefined
    return row?.workspace_path ?? null
  }

  getSessionTitle(sessionPath: string): string | null {
    const row = this.db.prepare('select title from sessions where path = ?').get(sessionPath) as
      | { title: string }
      | undefined
    return row?.title ?? null
  }

  async getSessionMessages(
    sessionPath: string,
    options: SessionHistoryPageOptions = {}
  ): Promise<SessionHistoryPage> {
    const limit = normalizeHistoryLimit(options.limit)
    let fileMtime: number
    try {
      fileMtime = fs.statSync(sessionPath).mtimeMs
    } catch {
      return emptyHistoryPage(limit)
    }

    const cacheKey = historyPageCacheKey(sessionPath, limit, options.beforeEntryId)
    const cached = this.messageCache.get(cacheKey)
    if (cached && cached.mtime >= fileMtime) return cached.page

    try {
      const page = await readSessionHistoryPage(sessionPath, {
        limit,
        beforeEntryId: options.beforeEntryId,
      })
      this.messageCache.set(cacheKey, { mtime: fileMtime, page })
      if (this.messageCache.size > this.MAX_CACHE_ENTRIES) {
        const oldestKey = this.messageCache.keys().next().value
        if (oldestKey !== undefined) this.messageCache.delete(oldestKey)
      }
      return page
    } catch {
      return emptyHistoryPage(limit)
    }
  }

  private upsertSession(info: SessionInfo): void {
    const newMtime = info.modified.getTime()

    // Fast path: skip full JSONL parse when the file hasn't changed.
    // With 236 sessions (some >100 MB), this is the dominant cold-start cost.
    const existing = this.db
      .prepare('select file_mtime from sessions where path = ?')
      .get(info.path) as { file_mtime: number } | undefined
    if (existing && existing.file_mtime >= newMtime) return

    // Invalidate bounded history page cache for this session — it changed.
    this.invalidateMessageCache(info.path)

    const parsed = parseSessionFile(info.path)
    const header = parsed.header
    const entries = parsed.entries
    const headerCwd = typeof header?.cwd === 'string' ? header.cwd : ''
    const cwd = info.cwd || headerCwd
    const workspacePath = cwd ? canonicalizePath(cwd) : ''
    if (workspacePath) {
      this.db
        .prepare(`
        insert into workspaces(path, display_name, last_opened_at)
        values (@path, @displayName, coalesce((select last_opened_at from workspaces where path = @path), null))
        on conflict(path) do update set display_name = excluded.display_name
      `)
        .run({ path: workspacePath, displayName: displayNameForPath(workspacePath) })
    }

    const sessionName = latestSessionName(entries)
    const firstMessage = info.firstMessage || firstUserMessage(entries)
    const usage = usageTotals(entries)
    const title = sessionName || info.name || truncate(firstMessage, 70) || 'Untitled session'
    const branchCount = countBranches(entries)
    const lastModelId = latestModel(entries)

    this.db
      .prepare(`
      insert into sessions(
        path, session_id, cwd, workspace_path, title, created_at, updated_at,
        message_count, first_message, all_messages_text, parent_session_path,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost,
        entry_count, branch_count, last_model, file_mtime
      ) values (
        @path, @sessionId, @cwd, @workspacePath, @title, @createdAt, @updatedAt,
        @messageCount, @firstMessage, @allMessagesText, @parentSessionPath,
        @inputTokens, @outputTokens, @cacheReadTokens, @cacheWriteTokens, @cost,
        @entryCount, @branchCount, @lastModel, @fileMtime
      )
      on conflict(path) do update set
        session_id = excluded.session_id,
        cwd = excluded.cwd,
        workspace_path = excluded.workspace_path,
        title = excluded.title,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        message_count = excluded.message_count,
        first_message = excluded.first_message,
        all_messages_text = excluded.all_messages_text,
        parent_session_path = excluded.parent_session_path,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        cache_write_tokens = excluded.cache_write_tokens,
        cost = excluded.cost,
        entry_count = excluded.entry_count,
        branch_count = excluded.branch_count,
        last_model = excluded.last_model,
        file_mtime = excluded.file_mtime
    `)
      .run({
        path: info.path,
        sessionId:
          info.id || (typeof header?.id === 'string' ? header.id : path.basename(info.path)),
        cwd,
        workspacePath,
        title,
        createdAt: toIso(info.created),
        updatedAt: toIso(info.modified),
        messageCount:
          info.messageCount || entries.filter((entry) => entry.type === 'message').length,
        firstMessage,
        // Keep the schema slot for future full-text search, but avoid retaining full
        // transcript text in the hot session index. The renderer list only needs
        // title/first message/stats; full branch history is loaded on demand.
        allMessagesText: '',
        parentSessionPath:
          info.parentSessionPath ??
          (typeof header?.parentSession === 'string' ? header.parentSession : null),
        ...usage,
        entryCount: entries.length,
        branchCount,
        lastModel: lastModelId,
        fileMtime: newMtime,
      })

    this.db.prepare('delete from session_entries where session_path = ?').run(info.path)
    const insertEntry = this.db.prepare(`
      insert into session_entries(session_path, entry_id, parent_id, type, timestamp)
      values (@sessionPath, @entryId, @parentId, @type, @timestamp)
    `)
    for (const entry of entries) {
      insertEntry.run({
        sessionPath: info.path,
        entryId: entry.id,
        parentId: entry.parentId,
        type: entry.type,
        timestamp: entry.timestamp,
      })
    }
  }

  getPref(key: string): string | null {
    const row = this.db.prepare('select value from prefs where key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setPref(key: string, value: string): void {
    this.db
      .prepare(`
      insert into prefs(key, value) values (?, ?)
      on conflict(key) do update set value = excluded.value
    `)
      .run(key, value)
  }

  private invalidateMessageCache(sessionPath: string): void {
    const prefix = `${sessionPath}\u0000`
    for (const key of this.messageCache.keys()) {
      if (key.startsWith(prefix)) this.messageCache.delete(key)
    }
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists workspaces (
        path text primary key,
        display_name text not null,
        last_opened_at text
      );

      create table if not exists sessions (
        path text primary key,
        session_id text not null,
        cwd text not null,
        workspace_path text not null,
        title text not null,
        created_at text not null,
        updated_at text not null,
        message_count integer not null default 0,
        first_message text not null default '',
        all_messages_text text not null default '',
        parent_session_path text,
        input_tokens integer not null default 0,
        output_tokens integer not null default 0,
        cache_read_tokens integer not null default 0,
        cache_write_tokens integer not null default 0,
        cost real not null default 0,
        entry_count integer not null default 0,
        branch_count integer not null default 0,
        last_model text not null default '',
        file_mtime integer not null default 0,
        foreign key(workspace_path) references workspaces(path)
      );

      create table if not exists session_entries (
        session_path text not null,
        entry_id text not null,
        parent_id text,
        type text not null,
        timestamp text not null,
        primary key(session_path, entry_id),
        foreign key(session_path) references sessions(path) on delete cascade
      );

      create index if not exists idx_sessions_workspace on sessions(workspace_path);
      create index if not exists idx_sessions_created on sessions(created_at);
      create index if not exists idx_sessions_updated on sessions(updated_at);
      create index if not exists idx_session_entries_parent on session_entries(session_path, parent_id);

      create table if not exists prefs (
        key text primary key,
        value text not null
      );
    `)
    // Additive migrations — safe to run on existing DBs
    try {
      this.db.exec(`alter table sessions add column last_model text not null default ''`)
    } catch {
      /* column already exists */
    }
    try {
      this.db.exec(`alter table sessions add column file_mtime integer not null default 0`)
    } catch {
      /* column already exists */
    }
  }
}

function listSessionInfos(workspacePath?: string): SessionInfo[] {
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

function getDefaultSessionDir(cwd: string): string {
  const safePath = `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  return path.join(os.homedir(), '.pi', 'agent', 'sessions', safePath)
}

function buildSessionInfo(filePath: string, expectedWorkspacePath?: string): SessionInfo | null {
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

function readFirstLine(filePath: string): string | null {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(4096)
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.toString('utf8', 0, bytesRead).split('\n')[0] ?? null
  } finally {
    fs.closeSync(fd)
  }
}

function parseSessionFile(filePath: string): { header: FileEntry | null; entries: SessionEntry[] } {
  try {
    const fileEntries = parseSessionEntries(fs.readFileSync(filePath, 'utf8'))
    const header = fileEntries.find((entry) => entry.type === 'session') ?? null
    const entries = fileEntries.filter((entry): entry is SessionEntry => entry.type !== 'session')
    return { header, entries }
  } catch {
    return { header: null, entries: [] }
  }
}

function parseSessionEntries(content: string): FileEntry[] {
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

async function readSessionHistoryPage(
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

async function readCurrentBranchIds(filePath: string): Promise<Set<string>> {
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

async function* streamSessionEntries(filePath: string): AsyncGenerator<FileEntry> {
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

function normalizeSessionEntry(entry: FileEntry): SessionEntry | null {
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

function normalizeHistoryLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_HISTORY_PAGE_LIMIT
  return Math.min(MAX_HISTORY_PAGE_LIMIT, Math.max(1, Math.floor(limit)))
}

function historyPageCacheKey(
  sessionPath: string,
  limit: number,
  beforeEntryId: string | undefined
): string {
  return `${sessionPath}\u0000${limit}\u0000${beforeEntryId ?? ''}`
}

function emptyHistoryPage(limit: number): SessionHistoryPage {
  return { messages: [], hasMoreBefore: false, nextBeforeEntryId: null, limit }
}

function latestModel(entries: SessionEntry[]): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.type === 'model_change') {
      const e = entry as unknown as { modelId?: string }
      if (e.modelId) return e.modelId
    }
  }
  return ''
}

function latestSessionName(entries: SessionEntry[]): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    const name = entry.name
    if (entry.type === 'session_info' && typeof name === 'string' && name.trim()) {
      return name.trim()
    }
  }
  return ''
}

function firstUserMessage(entries: SessionEntry[]): string {
  for (const entry of entries) {
    if (entry.type !== 'message') continue
    const message = entry.message as { role?: string; content?: unknown }
    if (message.role === 'user') return truncate(contentToText(message.content), 140)
  }
  return ''
}

function usageTotals(entries: SessionEntry[]): UsageTotals {
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

function countBranches(entries: SessionEntry[]): number {
  const childCounts = new Map<string | null, number>()
  for (const entry of entries) {
    childCounts.set(entry.parentId, (childCounts.get(entry.parentId) ?? 0) + 1)
  }
  return Array.from(childCounts.values()).reduce(
    (count, children) => count + Math.max(0, children - 1),
    0
  )
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .join('')
      .trim()
  }
  return ''
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function usageTotalTokens(usage: Record<string, unknown>): number {
  return (
    numeric(usage.totalTokens) ||
    (numeric(usage.input) || numeric(usage.inputTokens)) +
      (numeric(usage.output) || numeric(usage.outputTokens)) +
      (numeric(usage.cacheRead) || numeric(usage.cacheReadTokens)) +
      (numeric(usage.cacheWrite) || numeric(usage.cacheWriteTokens))
  )
}

function entryTimestampMs(entry: SessionEntry, message: Record<string, unknown>): number | null {
  const messageTimestamp = numeric(message.timestamp)
  if (messageTimestamp > 0) return messageTimestamp
  const parsed = Date.parse(entry.timestamp)
  return Number.isFinite(parsed) ? parsed : null
}

function durationFrom(startMs: number | null, endMs: number | null): number | undefined {
  if (!startMs || !endMs || endMs <= startMs) return undefined
  return endMs - startMs
}

function truncate(value: string, length: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized
}

function canonicalizePath(value: string): string {
  try {
    return fs.realpathSync.native(value)
  } catch {
    return path.resolve(value)
  }
}

function displayNameForPath(value: string): string {
  return path.basename(value) || value
}

function toIso(value: Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

type HistoryReadState = {
  currentModelName?: string
  lastUserTimestampMs: number | null
}

function appendHistoryEntry(
  messages: SessionHistoryMessage[],
  entry: SessionEntry,
  state: HistoryReadState
): void {
  // Track model changes — use modelId as the display name since we don't
  // have registry access here. The UI formats it as-is.
  if (entry.type === 'model_change') {
    const e = entry as unknown as { modelId?: string; provider?: string }
    state.currentModelName = e.modelId || state.currentModelName
    return
  }

  if (entry.type !== 'message') return

  const message = entry.message as unknown as Record<string, unknown>
  const role = typeof message.role === 'string' ? message.role : ''

  if (role === 'user') {
    state.lastUserTimestampMs = entryTimestampMs(entry, message)
    pushRenderableMessage(messages, {
      id: entry.id,
      role: 'user',
      text: contentToText(message.content),
      toolCards: [],
    })
    return
  }

  if (role === 'assistant') {
    const usage = isRecord(message.usage) ? message.usage : {}
    const cost = isRecord(usage.cost) ? numeric(usage.cost.total) : numeric(usage.cost)
    const durationMs = durationFrom(state.lastUserTimestampMs, entryTimestampMs(entry, message))
    pushRenderableMessage(messages, {
      id: entry.id,
      role: 'assistant',
      text: assistantText(message.content),
      thinking: assistantThinking(message.content) || undefined,
      toolCards: toolCallsFromContent(message.content),
      inputTokens: numeric(usage.input) || numeric(usage.inputTokens),
      outputTokens: numeric(usage.output) || numeric(usage.outputTokens),
      cacheReadTokens: numeric(usage.cacheRead) || numeric(usage.cacheReadTokens),
      cacheWriteTokens: numeric(usage.cacheWrite) || numeric(usage.cacheWriteTokens),
      totalTokens: usageTotalTokens(usage),
      durationMs,
      cost: cost || undefined,
      streaming: false,
      modelName: state.currentModelName,
    })
    return
  }

  if (role === 'toolResult') {
    attachToolResult(messages, message)
    return
  }

  if (role === 'bashExecution') {
    pushRenderableMessage(messages, {
      id: entry.id,
      role: 'assistant',
      text: '',
      toolCards: [
        {
          toolCallId: entry.id,
          toolName: 'bash',
          args: { command: typeof message.command === 'string' ? message.command : '' },
          output: typeof message.output === 'string' ? message.output : '',
          isError: numeric(message.exitCode) !== 0,
          streaming: false,
        },
      ],
    })
  }
}

function pushRenderableMessage(
  messages: SessionHistoryMessage[],
  message: SessionHistoryMessage
): void {
  if (isRenderableHistoryMessage(message)) messages.push(message)
}

function trimHistoryMessages(messages: SessionHistoryMessage[], limit: number): boolean {
  let trimmed = false
  while (messages.length > limit) {
    messages.shift()
    trimmed = true
  }
  return trimmed
}

function isRenderableHistoryMessage(message: SessionHistoryMessage): boolean {
  return Boolean(message.text || message.thinking || message.toolCards.length > 0)
}

function attachToolResult(
  messages: SessionHistoryMessage[],
  message: Record<string, unknown>
): void {
  const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : ''
  if (!toolCallId) return

  const fallbackCard: SessionHistoryToolCard = {
    toolCallId,
    toolName: typeof message.toolName === 'string' ? message.toolName : 'tool',
    args: {},
    output: contentToText(message.content),
    isError: Boolean(message.isError),
    streaming: false,
  }

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const candidate = messages[messageIndex]
    if (candidate.role !== 'assistant') continue
    const cardIndex = candidate.toolCards.findIndex((card) => card.toolCallId === toolCallId)
    if (cardIndex === -1) continue
    candidate.toolCards[cardIndex] = {
      ...candidate.toolCards[cardIndex],
      output: fallbackCard.output,
      isError: fallbackCard.isError,
      streaming: false,
    }
    return
  }

  messages.push({
    id: `tool-${toolCallId}`,
    role: 'assistant',
    text: '',
    toolCards: [fallbackCard],
    streaming: false,
  })
}

function toolCallsFromContent(content: unknown): SessionHistoryToolCard[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((part): SessionHistoryToolCard[] => {
    if (!isRecord(part) || part.type !== 'toolCall') return []
    const toolCallId = typeof part.id === 'string' ? part.id : ''
    const toolName = typeof part.name === 'string' ? part.name : 'tool'
    if (!toolCallId) return []
    return [
      {
        toolCallId,
        toolName,
        args: isRecord(part.arguments) ? part.arguments : {},
        output: '',
        isError: false,
        streaming: false,
      },
    ]
  })
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

function assistantThinking(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (isRecord(part) && part.type === 'thinking') return String(part.thinking ?? '')
      return ''
    })
    .join('\n')
    .trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
