import { existsSync } from 'node:fs'
import type { Context } from '@earendil-works/chord'
import type { Storage } from '@earendil-works/pi-durable'
import { MemoryStorage } from '@earendil-works/pi-durable'
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node'
import type { DurableBackend } from './types'

/**
 * Open the durable store. SQLite via node:sqlite is deferred to a later slice: it is experimental
 * in Node 22 and its availability inside Electron main is unverified, so the JSONL backend (plain
 * files, crash-safe append with fsync option) is the file-backed default for now.
 */
export async function openDurableStorage(
  options: { backend: DurableBackend; directory?: string; requireStore?: boolean },
  context: Context
): Promise<Storage> {
  if (options.backend === 'memory') return new MemoryStorage()
  if (!options.directory) {
    throw new Error("durable backend 'jsonl' requires a directory")
  }
  // Reopening an existing session: a missing directory is a lost store, not a new one to create,
  // because the export that follows would write an empty history over the session's file.
  if (options.requireStore && !existsSync(options.directory)) {
    throw new Error(`the store for this session is missing: ${options.directory}`)
  }
  return openNodeJsonlStorage(options.directory, context)
}
