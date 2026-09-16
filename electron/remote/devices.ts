/**
 * remote/devices — SQLite store for paired remote devices.
 *
 * Only the SHA-256 hash of each device token is persisted; the raw token
 * exists exactly once, in the pairing response. Revocation is immediate:
 * verification matches against active (non-revoked) rows only.
 */

import { createHash, randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'

export interface RemoteDeviceRow {
  id: number
  name: string
  tokenHash: string
  createdAt: string
  lastSeenAt: string | null
  revokedAt: string | null
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** 256 bits of entropy, URL-safe: the only secret a paired device ever holds. */
export function generateDeviceToken(): string {
  return randomBytes(32).toString('base64url')
}

const CREATE_TABLE = `
  create table if not exists remote_devices (
    id integer primary key autoincrement,
    name text not null,
    token_hash text not null unique,
    created_at text not null,
    last_seen_at text,
    revoked_at text
  )
`

export class RemoteDeviceStore {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
    db.exec(CREATE_TABLE)
  }

  create(name: string, tokenHash: string, now: Date): number {
    // last_insert_rowid()/changes() instead of the run() result: the test shim
    // (node:sqlite) and better-sqlite3 both answer these, and the store is
    // tested through the shim.
    this.db
      .prepare('insert into remote_devices (name, token_hash, created_at) values (?, ?, ?)')
      .run(name, tokenHash, now.toISOString())
    const row = this.db.prepare('select last_insert_rowid() as id').get() as { id: number }
    return row.id
  }

  list(): RemoteDeviceRow[] {
    return this.db
      .prepare(
        `select id,
               name,
               token_hash as tokenHash,
               created_at as createdAt,
               last_seen_at as lastSeenAt,
               revoked_at as revokedAt
        from remote_devices
        order by id`
      )
      .all() as RemoteDeviceRow[]
  }

  /** Active (non-revoked) device for a token hash, or null. */
  findActiveByHash(tokenHash: string): RemoteDeviceRow | null {
    const row = this.db
      .prepare(
        `select id,
               name,
               token_hash as tokenHash,
               created_at as createdAt,
               last_seen_at as lastSeenAt,
               revoked_at as revokedAt
        from remote_devices
        where token_hash = ? and revoked_at is null`
      )
      .get(tokenHash) as RemoteDeviceRow | undefined
    return row ?? null
  }

  touch(id: number, now: Date): void {
    this.db
      .prepare('update remote_devices set last_seen_at = ? where id = ?')
      .run(now.toISOString(), id)
  }

  revoke(id: number, now: Date): boolean {
    this.db
      .prepare('update remote_devices set revoked_at = ? where id = ? and revoked_at is null')
      .run(now.toISOString(), id)
    const row = this.db.prepare('select changes() as changes').get() as { changes: number }
    return row.changes > 0
  }
}
