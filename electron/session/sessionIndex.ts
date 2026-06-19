import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type {
  SessionHistoryPage,
  SessionListItem,
  SessionListOptions,
  SessionTreeResponse,
  UsageSummary,
  UsageSummaryRequest,
  WorkspaceInfo,
  WorkspaceTrustResult,
} from '../../src/lib/ipc'
import {
  emptyHistoryPage,
  firstUserMessage,
  latestModel,
  latestSessionName,
  listSessionInfos,
  parseSessionFile,
  readSessionHistoryPage,
  type SessionHistoryPageOptions,
  type SessionInfo,
  usageTotals,
} from './sessionEntries'
import { canonicalizePath, displayNameForPath, toIso, truncate } from './sessionEntryUtils'
import { runMigrations } from './sessionMigration'
import {
  deleteMissingSessions as _deleteMissingSessions,
  getLastWorkspace as _getLastWorkspace,
  getPref as _getPref,
  isWorkspaceTrusted as _isWorkspaceTrusted,
  listSessions as _listSessions,
  listWorkspaces as _listWorkspaces,
  setPref as _setPref,
  setWorkspaceTrust as _setWorkspaceTrust,
  upsertWorkspace as _upsertWorkspace,
} from './sessionQueries'
import { countBranches } from './sessionTree'
import { buildSessionTree } from './sessionTreeBuilder'
import { getUsageSummary as _getUsageSummary, usageMetricsByEntryId } from './sessionUsage'

const USAGE_INDEX_VERSION = 3

export class SessionIndexStore {
  private readonly db: Database.Database
  private readonly MAX_CACHE_ENTRIES = 8

  /** mtime-keyed bounded page cache — never retains full large transcripts in main */
  private readonly messageCache = new Map<string, { mtime: number; page: SessionHistoryPage }>()

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL') // safe + fast with WAL
    this.db.pragma('foreign_keys = ON') // enforce FK constraints
    this.db.pragma('busy_timeout = 5000') // wait up to 5 s instead of failing immediately
    runMigrations(this.db)
  }

  close(): void {
    try {
      // Flush WAL frames to the main DB file before closing so a hard-kill
      // between close() and the OS journal cleanup cannot lose committed rows.
      this.db.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      // Non-fatal: WAL auto-recovery handles this on next open.
    }
    this.db.close()
  }

  // ── Workspace methods (delegated to sessionQueries) ─────────────────────────
  upsertWorkspace(cwd: string): string {
    return _upsertWorkspace(this.db, cwd)
  }
  setWorkspaceTrust(cwd: string, trusted: boolean): WorkspaceTrustResult {
    return _setWorkspaceTrust(this.db, cwd, trusted)
  }
  isWorkspaceTrusted(cwd: string): boolean {
    return _isWorkspaceTrusted(this.db, cwd)
  }
  getLastWorkspace(): string | null {
    return _getLastWorkspace(this.db)
  }
  listWorkspaces(): WorkspaceInfo[] {
    return _listWorkspaces(this.db)
  }

  // ── Session refresh + listing ────────────────────────────────────────────────

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

    // Remove missing sessions only from the refreshed scope.
    _deleteMissingSessions(this.db, seen, workspacePath)

    return this.listSessions({}, activeSessionPath, workspacePath)
  }

  listSessions(
    options: SessionListOptions = {},
    activeSessionPath?: string | null,
    workspacePath?: string
  ): SessionListItem[] {
    return _listSessions(this.db, options, activeSessionPath, workspacePath)
  }

  getUsageSummary(request: UsageSummaryRequest = {}): UsageSummary {
    return _getUsageSummary(this.db, request)
  }

  // ── Individual session queries ───────────────────────────────────────────────

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
    try {
      const stat = fs.statSync(sessionPath)
      const cacheKey = `${sessionPath}\u0000${options.beforeEntryId ?? ''}\u0000${String(options.limit ?? '')}`
      const cached = this.messageCache.get(cacheKey)
      if (cached && cached.mtime >= stat.mtimeMs) {
        return cached.page
      }

      // Evict oldest entries when cache exceeds bound
      if (this.messageCache.size >= this.MAX_CACHE_ENTRIES) {
        for (const key of this.messageCache.keys()) {
          this.messageCache.delete(key)
          break
        }
      }

      const page = await readSessionHistoryPage(sessionPath, options)
      this.messageCache.set(cacheKey, { mtime: stat.mtimeMs, page })
      return page
    } catch {
      return emptyHistoryPage(options.limit ?? 50)
    }
  }

  // ── Session tree ────────────────────────────────────────────────────────────
  getSessionTree(sessionPath: string): SessionTreeResponse {
    return buildSessionTree(sessionPath)
  }

  // ── Preferences (delegated to sessionQueries) ───────────────────────────────
  getPref(key: string): string | null {
    return _getPref(this.db, key)
  }
  setPref(key: string, value: string): void {
    _setPref(this.db, key, value)
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private invalidateMessageCache(sessionPath: string): void {
    const prefix = `${sessionPath}\u0000`
    for (const key of this.messageCache.keys()) {
      if (key.startsWith(prefix)) this.messageCache.delete(key)
    }
  }

  private upsertSession(info: SessionInfo): void {
    const newMtime = info.modified.getTime()

    // Fast path: skip full JSONL parse when the file hasn't changed.
    const existing = this.db
      .prepare('select file_mtime, usage_index_version from sessions where path = ?')
      .get(info.path) as { file_mtime: number; usage_index_version: number } | undefined
    if (
      existing &&
      existing.file_mtime >= newMtime &&
      existing.usage_index_version >= USAGE_INDEX_VERSION
    ) {
      return
    }

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
          input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
          cost, entry_count, branch_count, last_model, file_mtime, usage_index_version
        ) values (
          @path, @sessionId, @cwd, @workspacePath, @title, @createdAt, @updatedAt,
          @messageCount, @firstMessage, @allMessagesText, @parentSessionPath,
          @inputTokens, @outputTokens, @cacheReadTokens, @cacheWriteTokens,
          @cost, @entryCount, @branchCount, @lastModel, @fileMtime, @usageIndexVersion
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
          file_mtime = excluded.file_mtime,
          usage_index_version = excluded.usage_index_version
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
        allMessagesText: '',
        parentSessionPath:
          info.parentSessionPath ??
          (typeof header?.parentSession === 'string' ? header.parentSession : null),
        ...usage,
        entryCount: entries.length,
        branchCount,
        lastModel: lastModelId,
        fileMtime: newMtime,
        usageIndexVersion: USAGE_INDEX_VERSION,
      })

    // Index entries for tree traversal and usage capture.
    const usageByEntryId = usageMetricsByEntryId(entries)
    const upsertEntry = this.db.prepare(`
          insert into session_entries(
            session_path, entry_id, parent_id, type, timestamp,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
          total_tokens, duration_ms, cost, model, provider
        ) values (
          @sessionPath, @entryId, @parentId, @type, @timestamp,
          @inputTokens, @outputTokens, @cacheReadTokens, @cacheWriteTokens,
          @totalTokens, @durationMs, @cost, @model, @provider
        )
          on conflict(session_path, entry_id) do update set

            parent_id = excluded.parent_id,
            type = excluded.type,
            timestamp = excluded.timestamp,
            input_tokens = excluded.input_tokens,
            output_tokens = excluded.output_tokens,
            cache_read_tokens = excluded.cache_read_tokens,
            cache_write_tokens = excluded.cache_write_tokens,
            total_tokens = excluded.total_tokens,
            duration_ms = excluded.duration_ms,
            cost = excluded.cost,
            model = excluded.model,
            provider = excluded.provider
      `)

    const insertMany = this.db.transaction(() => {
      for (const entry of entries) {
        const usage = usageByEntryId.get(entry.id)
        upsertEntry.run({
          sessionPath: info.path,
          entryId: entry.id,
          parentId: entry.parentId ?? null,
          type: entry.type,
          timestamp: entry.timestamp ?? new Date().toISOString(),
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          cacheReadTokens: usage?.cacheReadTokens ?? 0,
          cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
          totalTokens: usage?.totalTokens ?? 0,
          durationMs: usage?.durationMs ?? 0,
          cost: usage?.cost ?? 0,
          model: usage?.model ?? '',
          provider: usage?.provider ?? '',
        })
      }
    })
    insertMany()
  }
}
