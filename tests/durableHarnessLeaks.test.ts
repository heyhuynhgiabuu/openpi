import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fauxProvider } from '@earendil-works/pi-ai'
import { JsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDurableHarness } from '../electron/pi/durable/harness'

/**
 * ROADMAP Phase 8 gate condition 4: `openDurableHarness` opens the store and the MCP bridge, then
 * does several things that can throw. Whatever it started must be released before it rethrows —
 * nothing else holds a handle to it.
 *
 * Measured, because the obvious assertions were wrong:
 *
 * - **The store does not leak on its own.** A failing commit poisons the JSONL store and the session
 *   closes it itself, so a reopen after a failed open behaves identically with or without the
 *   cleanup here. Asserting "the store was closed" therefore proved nothing; the `storage.close` in
 *   the catch is a backstop for the case where pi-durable's own close throws, not the fix.
 * - **The MCP bridge does leak.** Its servers are spawned before the extension is installed, and
 *   nothing in pi-durable knows about them: without the fix below, `closeMcp` was called zero times
 *   on both failing paths.
 *
 * So both cases assert the bridge, which is the resource a failed open actually stranded.
 */

const mocks = vi.hoisted(() => ({
  closeMcp: vi.fn(async () => undefined),
  bridge: vi.fn(),
  duplicateTools: false,
}))

/**
 * The bridge is stood in for so `close` can be observed, and so the install-time failure can be
 * built directly. Real duplicate tool names come from two servers that sanitize alike (`a-b` and
 * `a_b` both become `mcp__a_b__`, `mcpConfig.ts:108-111`); reaching that through the real bridge
 * needs two spawned processes for the same throw, so the collision is constructed here instead.
 */
vi.mock('../electron/pi/durable/mcp', () => ({
  loadMcpExtension: async () => {
    mocks.bridge()
    const tool = (name: string) => ({
      name,
      description: '',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ content: [] }),
    })
    const extension = {
      name: 'openpi.mcp',
      tools: mocks.duplicateTools
        ? [tool('mcp__a_b__echo'), tool('mcp__a_b__echo')]
        : [tool('mcp__a_b__echo')],
      hooks: [],
    }
    return { extension, errors: [], close: mocks.closeMcp }
  },
}))

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openpi-harness-leak-'))
})

afterEach(async () => {
  mocks.closeMcp.mockClear()
  mocks.bridge.mockClear()
  mocks.duplicateTools = false
  await rm(root, { recursive: true, force: true })
})

/** Options that start an MCP bridge and no session-model traffic. */
function options(directory: string | undefined, faux: ReturnType<typeof fauxProvider>) {
  return {
    backend: 'jsonl' as const,
    directory,
    model: { provider: faux.getModel().provider, modelId: faux.getModel().id },
    mcp: true,
    workspacePath: '/work',
    userAgentDir: '/agent',
    tools: false,
    policy: false,
  }
}

/**
 * A readable but unwritable `main.jsonl`: the open only reads it, so it succeeds, and the first
 * commit — the one `harness.root` makes — fails. Measured: `Harness.open` succeeds and `root()`
 * throws `JsonlStoragePoisonedError`.
 */
async function readOnlyStore(): Promise<string> {
  const directory = join(root, 'store')
  await mkdir(directory, { recursive: true })
  const main = join(directory, 'main.jsonl')
  await writeFile(main, '')
  await chmod(main, 0o444)
  return directory
}

describe('openDurableHarness releases what it opened when the open fails', () => {
  it('closes the MCP bridge and the store when installing its extension throws', async () => {
    mocks.duplicateTools = true
    const faux = fauxProvider()
    const close = vi.spyOn(JsonlStorage.prototype, 'close')
    await expect(openDurableHarness(options(join(root, 'store'), faux))).rejects.toThrow(
      /two tools named mcp__a_b__echo/
    )

    // The servers were spawned before the install rejected; nothing else held the closer.
    expect(mocks.bridge).toHaveBeenCalledTimes(1)
    expect(mocks.closeMcp).toHaveBeenCalledTimes(1)
    // On this path no commit has failed, so pi-durable has closed nothing itself: releasing the
    // harness (and the store behind it) is this code's job alone.
    expect(close).toHaveBeenCalled()
    close.mockRestore()
  })

  it('closes the MCP bridge when root creation throws', async () => {
    const faux = fauxProvider()
    // Match the error rather than any throw: the setup relies on the store rejecting the write, and
    // a silent change there must fail loudly instead of passing on some unrelated error.
    await expect(openDurableHarness(options(await readOnlyStore(), faux))).rejects.toThrow(
      /poison|EACCES|EPERM|permission/i
    )

    expect(mocks.bridge).toHaveBeenCalledTimes(1)
    expect(mocks.closeMcp).toHaveBeenCalledTimes(1)
  })
})
