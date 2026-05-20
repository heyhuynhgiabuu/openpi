import type Database from 'better-sqlite3'
import type {
  SessionListItem,
  SessionListOptions,
  WorkspaceInfo,
  WorkspaceTrustResult,
} from '../../src/lib/ipc'
import { canonicalizePath, displayNameForPath } from './sessionEntryUtils'

// ── Internal row types ──────────────────────────────────────────────────────

type WorkspaceRow = {
  path: string
  display_name: string
  last_opened_at: string | null
  session_count: number
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

// ── Workspace queries ───────────────────────────────────────────────────────

export function upsertWorkspace(db: Database.Database, cwd: string): string {
  const workspacePath = canonicalizePath(cwd)
  db.prepare(`
    insert into workspaces(path, display_name, last_opened_at)
    values (@path, @displayName, @lastOpenedAt)
    on conflict(path) do update set
      display_name = excluded.display_name,
      last_opened_at = excluded.last_opened_at
  `).run({
    path: workspacePath,
    displayName: displayNameForPath(workspacePath),
    lastOpenedAt: new Date().toISOString(),
  })
  return workspacePath
}

export function setWorkspaceTrust(
  db: Database.Database,
  cwd: string,
  trusted: boolean
): WorkspaceTrustResult {
  const workspacePath = upsertWorkspace(db, cwd)
  const trustedAt = trusted ? new Date().toISOString() : null
  db.prepare('update workspaces set trusted_at = @trustedAt where path = @path').run({
    path: workspacePath,
    trustedAt,
  })
  return { cwd: workspacePath, trusted, trustedAt }
}

export function isWorkspaceTrusted(db: Database.Database, cwd: string): boolean {
  const workspacePath = canonicalizePath(cwd)
  const row = db.prepare('select trusted_at from workspaces where path = ?').get(workspacePath) as
    | { trusted_at: string | null }
    | undefined
  return Boolean(row?.trusted_at)
}

export function getLastWorkspace(db: Database.Database): string | null {
  const row = db
    .prepare(`
    select path from workspaces
    where last_opened_at is not null
    order by last_opened_at desc
    limit 1
  `)
    .get() as { path: string } | undefined
  return row?.path ?? null
}

export function listWorkspaces(db: Database.Database): WorkspaceInfo[] {
  const rows = db
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

// ── Preference queries ──────────────────────────────────────────────────────

export function getPref(db: Database.Database, key: string): string | null {
  const row = db.prepare('select value from prefs where key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setPref(db: Database.Database, key: string, value: string): void {
  db.prepare(`
    insert into prefs(key, value) values (?, ?)
    on conflict(key) do update set value = excluded.value
  `).run(key, value)
}

// ── Session listing ─────────────────────────────────────────────────────────

export function listSessions(
  db: Database.Database,
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

  const rows = db
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
