import type Database from 'better-sqlite3'

export function runMigrations(db: Database.Database): void {
  db.exec(`
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

  // Additive migrations — safe to run on existing DBs.
  // Each block uses try/catch so they are idempotent on re-open.
  const addColumns: Array<[string, string]> = [
    ['sessions', "add column last_model text not null default ''"],
    ['sessions', 'add column file_mtime integer not null default 0'],
    ['workspaces', 'add column trusted_at text'],
  ]
  for (const [table, clause] of addColumns) {
    try {
      db.exec(`alter table ${table} ${clause}`)
    } catch {
      // column already exists — safe to ignore
    }
  }
}
