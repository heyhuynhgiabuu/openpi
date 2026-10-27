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
  options: { backend: DurableBackend; directory?: string },
  context: Context
): Promise<Storage> {
  if (options.backend === 'memory') return new MemoryStorage()
  if (!options.directory) {
    throw new Error("durable backend 'jsonl' requires a directory")
  }
  return openNodeJsonlStorage(options.directory, context)
}
