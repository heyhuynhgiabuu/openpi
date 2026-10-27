import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDurableHarness } from '../electron/pi/durable/harness'
import { importSessionFile } from '../electron/pi/durable/importer'
import { renderSessionJsonl, writeSessionFile } from '../electron/pi/durable/sessionFile'
import { buildSessionInfo, parseSessionFile } from '../electron/session/sessionEntries'

/**
 * Phase 8.3e: a durable conversation is exported as Pi JSONL v3, the one format the sidebar, search
 * and importer all read. The invariants: the export round-trips through the real importer, the
 * sidebar's own readers accept it, re-export is idempotent, and a foreign file is never clobbered.
 */

let root = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openpi-sessionfile-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const header = {
  sessionId: 'durable-test-session',
  cwd: '/tmp/openpi-export-workspace',
  startedAt: '2026-10-27T00:00:00.000Z',
}

async function exportedHarness(answers: string[]) {
  const faux = fauxProvider()
  faux.setResponses(
    answers.map((text) => fauxAssistantMessage([fauxText(text)], { stopReason: 'stop' as const }))
  )
  return openDurableHarness({
    backend: 'memory',
    model: { provider: faux.getModel().provider, modelId: faux.getModel().id },
    registerProviders: (models) => models.setProvider(faux.provider),
    tools: false,
    policy: false,
  })
}

describe('renderSessionJsonl', () => {
  it('writes a v3 header and nothing for an empty transcript', () => {
    const { text, messages } = renderSessionJsonl(header, [])
    const lines = text.trimEnd().split('\n')
    expect(messages).toBe(0)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      type: 'session',
      version: 3,
      id: header.sessionId,
      cwd: header.cwd,
    })
  })
})

describe('durable session export', () => {
  it('round-trips through the real importer', async () => {
    const harness = await exportedHarness(['first answer'])
    try {
      await harness.prompt('first question')
      const path = join(root, 'a.jsonl')
      const result = await harness.exportSession(path, header)
      expect(result.messages).toBeGreaterThanOrEqual(2)

      const imported = await importSessionFile(path)
      expect(imported.invalid).toBe(false)
      const roles = imported.messages.map((m) => m.role)
      expect(roles).toContain('user')
      expect(roles).toContain('assistant')
      expect(JSON.stringify(imported.messages)).toContain('first question')
      expect(JSON.stringify(imported.messages)).toContain('first answer')
      expect(imported.skipped).toEqual([])
    } finally {
      await harness.close()
    }
  })

  it('is readable by the sidebar session readers', async () => {
    const harness = await exportedHarness(['sidebar answer'])
    try {
      await harness.prompt('sidebar question')
      const path = join(root, 'b.jsonl')
      await harness.exportSession(path, { ...header, cwd: root })

      const info = buildSessionInfo(path)
      expect(info?.id).toBe(header.sessionId)
      const parsed = parseSessionFile(path)
      expect(parsed.header?.type).toBe('session')
      // Linear chain: each entry's parent is the previous entry, the first is a root.
      expect(parsed.entries[0]?.parentId).toBeNull()
      parsed.entries.slice(1).forEach((entry, index) => {
        expect(entry.parentId).toBe(parsed.entries[index]?.id)
      })
    } finally {
      await harness.close()
    }
  })

  it('is idempotent and grows when the conversation grows', async () => {
    const harness = await exportedHarness(['one', 'two'])
    try {
      const path = join(root, 'c.jsonl')
      await harness.prompt('q1')
      const first = await harness.exportSession(path, header)
      const bytes = await readFile(path, 'utf8')
      await harness.exportSession(path, header)
      expect(await readFile(path, 'utf8')).toBe(bytes)

      await harness.prompt('q2')
      const second = await harness.exportSession(path, header)
      expect(second.messages).toBeGreaterThan(first.messages)
    } finally {
      await harness.close()
    }
  })

  it('refuses to overwrite a session file that belongs to someone else', async () => {
    const harness = await exportedHarness(['x'])
    try {
      await harness.prompt('q')
      const path = join(root, 'sdk.jsonl')
      const sdkFile =
        '{"type":"session","version":3,"id":"sdk-session","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/x"}\n'
      await writeFile(path, sdkFile, 'utf8')

      await expect(harness.exportSession(path, header)).rejects.toThrow(/another session/)
      expect(await readFile(path, 'utf8')).toBe(sdkFile)
    } finally {
      await harness.close()
    }
  })

  it('refuses a file that is not a session at all', async () => {
    const path = join(root, 'notes.jsonl')
    await writeFile(path, 'not json\n', 'utf8')
    await expect(writeSessionFile(path, header, [])).rejects.toThrow(/another session/)
    expect(await readFile(path, 'utf8')).toBe('not json\n')
  })

  it('creates missing parent directories and leaves no temp file behind', async () => {
    const path = join(root, 'deep', 'nested', 'd.jsonl')
    await mkdir(join(root, 'deep'), { recursive: true })
    await writeSessionFile(path, header, [])
    expect(await readFile(path, 'utf8')).toContain('"version":3')
    expect(await readdir(join(root, 'deep', 'nested'))).toEqual(['d.jsonl'])
  })

  it('refuses a same-id file with another version', async () => {
    const path = join(root, 'v2.jsonl')
    const v2 = `{"type":"session","version":2,"id":"${header.sessionId}","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/x"}\n`
    await writeFile(path, v2, 'utf8')
    await expect(writeSessionFile(path, header, [])).rejects.toThrow(/another session/)
    expect(await readFile(path, 'utf8')).toBe(v2)
  })

  it('serializes overlapping exports to one destination', async () => {
    const path = join(root, 'race.jsonl')
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => writeSessionFile(path, header, []))
    )
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true)
    expect(await readdir(root)).toEqual(['race.jsonl'])
  })

  it('leaves no temp file when the rename fails, and the next export still works', async () => {
    const path = join(root, 'fails.jsonl')
    const failing = { rename: () => Promise.reject(new Error('simulated rename failure')) }
    await expect(writeSessionFile(path, header, [], failing)).rejects.toThrow(
      /simulated rename failure/
    )
    expect(await readdir(root)).toEqual([])

    await writeSessionFile(path, header, [])
    expect(await readdir(root)).toEqual(['fails.jsonl'])
  })

  it('treats an unreadable destination as foreign instead of crashing', async () => {
    const path = join(root, 'adir')
    await mkdir(path)
    await expect(writeSessionFile(path, header, [])).rejects.toThrow(/another session/)
  })
})
