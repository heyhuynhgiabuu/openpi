/**
 * The session index schema as data, so `sessionMigration.test.ts` can compare a
 * migrated database against it. Every value here is a literal on purpose: these
 * are the contracts an older database is migrated into, and a wrong default or
 * a missing column breaks the store at runtime ("no such column") or silently
 * changes stored numbers.
 */

export const SESSIONS_COLUMNS = [
  'path',
  'session_id',
  'cwd',
  'workspace_path',
  'title',
  'created_at',
  'updated_at',
  'message_count',
  'first_message',
  'all_messages_text',
  'parent_session_path',
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'cost',
  'entry_count',
  'branch_count',
  'last_model',
  'file_mtime',
  'usage_index_version',
]

export const ENTRY_COLUMNS = [
  'session_path',
  'entry_id',
  'parent_id',
  'type',
  'timestamp',
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'total_tokens',
  'duration_ms',
  'cost',
  'model',
  'provider',
]

export const WORKSPACE_COLUMNS = ['path', 'display_name', 'last_opened_at', 'trusted_at']

export const PREF_COLUMNS = ['key', 'value']

/** Declared type of every column, so no column's storage class is left unpinned. */
export const COLUMN_TYPES = {
  'sessions.path': 'text',
  'sessions.session_id': 'text',
  'sessions.cwd': 'text',
  'sessions.workspace_path': 'text',
  'sessions.title': 'text',
  'sessions.created_at': 'text',
  'sessions.updated_at': 'text',
  'sessions.message_count': 'integer',
  'sessions.first_message': 'text',
  'sessions.all_messages_text': 'text',
  'sessions.parent_session_path': 'text',
  'sessions.input_tokens': 'integer',
  'sessions.output_tokens': 'integer',
  'sessions.cache_read_tokens': 'integer',
  'sessions.cache_write_tokens': 'integer',
  'sessions.cost': 'real',
  'sessions.entry_count': 'integer',
  'sessions.branch_count': 'integer',
  'sessions.last_model': 'text',
  'sessions.file_mtime': 'integer',
  'sessions.usage_index_version': 'integer',
  'session_entries.session_path': 'text',
  'session_entries.entry_id': 'text',
  'session_entries.parent_id': 'text',
  'session_entries.type': 'text',
  'session_entries.timestamp': 'text',
  'session_entries.input_tokens': 'integer',
  'session_entries.output_tokens': 'integer',
  'session_entries.cache_read_tokens': 'integer',
  'session_entries.cache_write_tokens': 'integer',
  'session_entries.total_tokens': 'integer',
  'session_entries.duration_ms': 'integer',
  'session_entries.cost': 'real',
  'session_entries.model': 'text',
  'session_entries.provider': 'text',
  'workspaces.path': 'text',
  'workspaces.display_name': 'text',
  'workspaces.last_opened_at': 'text',
  'workspaces.trusted_at': 'text',
  'prefs.key': 'text',
  'prefs.value': 'text',
}

/** Declared type for a `table.column` key, or undefined if unlisted. */
export function expectedType(key: string): string | undefined {
  return Object.entries(COLUMN_TYPES).find(([candidate]) => candidate === key)?.[1]
}

/**
 * Columns that reject NULL. A non-INTEGER primary key is not flagged here by
 * SQLite, so `path`, `key` and the `session_entries` pair are asserted through
 * `PRIMARY_KEYS` instead.
 */
export const NOT_NULL_COLUMNS: Array<[table: string, columns: string[]]> = [
  [
    'sessions',
    [
      'session_id',
      'cwd',
      'workspace_path',
      'title',
      'created_at',
      'updated_at',
      'message_count',
      'first_message',
      'all_messages_text',
      'input_tokens',
      'output_tokens',
      'cache_read_tokens',
      'cache_write_tokens',
      'cost',
      'entry_count',
      'branch_count',
      'last_model',
      'file_mtime',
      'usage_index_version',
    ],
  ],
  [
    'session_entries',
    [
      'session_path',
      'entry_id',
      'type',
      'timestamp',
      'input_tokens',
      'output_tokens',
      'cache_read_tokens',
      'cache_write_tokens',
      'total_tokens',
      'duration_ms',
      'cost',
      'model',
      'provider',
    ],
  ],
  ['workspaces', ['display_name']],
  ['prefs', ['value']],
]

/** Every column's declared default, or null when it has none. */
export const COLUMN_DEFAULTS = {
  'sessions.path': null,
  'sessions.session_id': null,
  'sessions.cwd': null,
  'sessions.workspace_path': null,
  'sessions.title': null,
  'sessions.created_at': null,
  'sessions.updated_at': null,
  'sessions.message_count': '0',
  'sessions.first_message': "''",
  'sessions.all_messages_text': "''",
  'sessions.parent_session_path': null,
  'sessions.input_tokens': '0',
  'sessions.output_tokens': '0',
  'sessions.cache_read_tokens': '0',
  'sessions.cache_write_tokens': '0',
  'sessions.cost': '0',
  'sessions.entry_count': '0',
  'sessions.branch_count': '0',
  'sessions.last_model': "''",
  'sessions.file_mtime': '0',
  'sessions.usage_index_version': '0',
  'session_entries.session_path': null,
  'session_entries.entry_id': null,
  'session_entries.parent_id': null,
  'session_entries.type': null,
  'session_entries.timestamp': null,
  'session_entries.input_tokens': '0',
  'session_entries.output_tokens': '0',
  'session_entries.cache_read_tokens': '0',
  'session_entries.cache_write_tokens': '0',
  'session_entries.total_tokens': '0',
  'session_entries.duration_ms': '0',
  'session_entries.cost': '0',
  'session_entries.model': "''",
  'session_entries.provider': "''",
  'workspaces.path': null,
  'workspaces.display_name': null,
  'workspaces.last_opened_at': null,
  'workspaces.trusted_at': null,
  'prefs.key': null,
  'prefs.value': null,
}

/**
 * The declared default for a `table.column` key, or undefined if unlisted.
 * Looked up through the entries so the literal map keeps its exact key type.
 */
export function expectedDefault(key: string): string | null | undefined {
  return Object.entries(COLUMN_DEFAULTS).find(([candidate]) => candidate === key)?.[1]
}

export const PRIMARY_KEYS: Array<[table: string, columns: string[]]> = [
  ['sessions', ['path']],
  ['session_entries', ['session_path', 'entry_id']],
  ['workspaces', ['path']],
  ['prefs', ['key']],
]

/** [name, table, indexed columns, unique] — a unique index here would break inserts. */
export const EXPECTED_INDEXES: Array<[string, string, string[], boolean]> = [
  ['idx_sessions_workspace', 'sessions', ['workspace_path'], false],
  ['idx_sessions_created', 'sessions', ['created_at'], false],
  ['idx_sessions_updated', 'sessions', ['updated_at'], false],
  ['idx_session_entries_parent', 'session_entries', ['session_path', 'parent_id'], false],
]
