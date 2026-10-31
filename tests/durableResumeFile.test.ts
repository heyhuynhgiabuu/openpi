import { describe, expect, it } from 'vitest'
import { DURABLE_HEADER_KEY, readResumeTarget } from '../electron/pi/durable/resumeFile'
import { renderSessionTree } from '../electron/pi/durable/sessionTree'
import type { EntryRecord } from '../electron/pi/durable/wire'
import { conversationId, entryId } from './helpers/wireEvents'

/**
 * Phase 8.4a: the durable marker on a session file's header, which is what lets a restart find the
 * store behind the session. Both readings matter: ours, and the SDK's on a file it did not write.
 */

const header = { sessionId: 'sess-1', cwd: '/work', startedAt: '2026-10-27T00:00:00.000Z' }
const durable = { storeId: 'store-1', conversationIds: [1, 7] }
const message: EntryRecord = {
  id: entryId(1),
  conversationId: conversationId(1),
  kind: 'pi.user',
  model: [{ role: 'user', content: 'hi', timestamp: 1000 }],
}
/** What the export adds: the lines it wrote, so a resume can tell whether they changed since. */
const stamp = { lines: 1, lastLineId: '00000008' }

const line = (value: unknown) => `${JSON.stringify(value)}\n`

/**
 * A header plus the body line its stamp names, so a case fails for the reason it is about: without
 * the body, every marker here would be refused for the missing line and no schema rule would be
 * exercised at all.
 */
const stamped = (marker: unknown) =>
  `${line({ type: 'session', version: 3, id: 'sess-1', timestamp: header.startedAt, [DURABLE_HEADER_KEY]: marker })}${line({ type: 'message', id: stamp.lastLineId, parentId: null })}`

describe('durable session file header', () => {
  it('round-trips the store id and the conversations through the export', () => {
    const { text } = renderSessionTree({ ...header, durable }, [[message]])
    expect(JSON.parse(text.split('\n')[0])).toMatchObject({
      type: 'session',
      version: 3,
      id: 'sess-1',
      timestamp: header.startedAt,
      cwd: '/work',
      [DURABLE_HEADER_KEY]: { ...durable, ...stamp },
    })
    expect(readResumeTarget(text)).toEqual({
      sessionId: header.sessionId,
      startedAt: header.startedAt,
      ...durable,
      ...stamp,
    })
  })

  it('says nothing about a store when the session is not durable', () => {
    const { text } = renderSessionTree(header, [[]])
    expect(text.split('\n')[0]).not.toContain(DURABLE_HEADER_KEY)
    expect(readResumeTarget(text)).toBeUndefined()
  })

  it('refuses a marker it cannot fully trust, rather than guessing at a store', () => {
    for (const marker of [
      { storeId: '', conversationIds: [1], ...stamp },
      { storeId: 'store-1', ...stamp },
      { storeId: 'store-1', conversationIds: [1, 0], ...stamp },
      { storeId: 'store-1', conversationIds: ['1'], ...stamp },
      // An empty list would fall back to the store's root and export that over the file.
      { storeId: 'store-1', conversationIds: [], ...stamp },
      { storeId: 'store-1', conversationIds: [1], ...stamp, extra: true },
      // No stamp: there is no telling what the file holds now.
      { storeId: 'store-1', conversationIds: [1] },
      // The store id is joined into a path, so it must not be able to leave the durable root.
      { storeId: '../../../../tmp/evil', conversationIds: [1], ...stamp },
      { storeId: '/etc', conversationIds: [1], ...stamp },
      { storeId: 'a/b', conversationIds: [1], ...stamp },
      { storeId: '..', conversationIds: [1], ...stamp },
      { storeId: '.', conversationIds: [1], ...stamp },
      // Windows trims a trailing dot or space, so `a.` would open `a`; these must not parse either.
      { storeId: 'a.', conversationIds: [1], ...stamp },
      { storeId: 'a ', conversationIds: [1], ...stamp },
      { storeId: '-rf', conversationIds: [1], ...stamp },
      // Windows reserves these as device names, with or without an extension, in any directory:
      // mkdir/open on `…\durable\CON` fails, so the store would never open on resume.
      { storeId: 'CON', conversationIds: [1], ...stamp },
      { storeId: 'con', conversationIds: [1], ...stamp },
      { storeId: 'NUL', conversationIds: [1], ...stamp },
      { storeId: 'AUX', conversationIds: [1], ...stamp },
      { storeId: 'PRN', conversationIds: [1], ...stamp },
      { storeId: 'COM1', conversationIds: [1], ...stamp },
      // Not just the endpoints: a guard narrowed to COM1/LPT9 would pass without this.
      { storeId: 'COM5', conversationIds: [1], ...stamp },
      { storeId: 'LPT4', conversationIds: [1], ...stamp },
      { storeId: 'LPT9', conversationIds: [1], ...stamp },
      { storeId: 'CON.txt', conversationIds: [1], ...stamp },
      { storeId: 'nul.tar.gz', conversationIds: [1], ...stamp },
      'store-1',
    ]) {
      expect(readResumeTarget(stamped(marker))).toBeUndefined()
    }
  })

  it('still accepts ordinary ids that merely start like a device name', () => {
    // The guard must not be a prefix match: these are legitimate store ids.
    for (const storeId of [
      'console',
      'common',
      'nullable',
      'null-1',
      'com0',
      'com10',
      'lpt0',
      'aux1',
    ]) {
      expect(readResumeTarget(stamped({ storeId, conversationIds: [1], ...stamp }))?.storeId).toBe(
        storeId
      )
    }
  })

  it('is not a durable file when the header itself is not a v3 session', () => {
    expect(readResumeTarget('')).toBeUndefined()
    expect(readResumeTarget('not json\n')).toBeUndefined()
    expect(
      readResumeTarget(
        line({ type: 'session', version: 2, id: 's', [DURABLE_HEADER_KEY]: durable })
      )
    ).toBeUndefined()
  })
})

describe('a file that changed since the last export', () => {
  const { text } = renderSessionTree({ ...header, durable }, [[message]])

  it('is recognised as unchanged when nothing was added', () => {
    expect(readResumeTarget(text)).toBeDefined()
  })

  it('is refused when another line was appended, as the SDK path would', () => {
    const appended = `${text}${JSON.stringify({ type: 'message', id: 'ffff0001', parentId: '00000001' })}\n`
    expect(readResumeTarget(appended)).toBeUndefined()
  })

  it('is refused when a line was slipped in before the last one', () => {
    const lines = text.trimEnd().split('\n')
    const inserted = [
      ...lines.slice(0, -1),
      JSON.stringify({ type: 'custom', id: 'aa' }),
      lines.at(-1),
    ]
    expect(readResumeTarget(`${inserted.join('\n')}\n`)).toBeUndefined()
  })

  it('is refused when the last line is not the one it left', () => {
    const lines = text.trimEnd().split('\n')
    expect(readResumeTarget(`${lines.slice(0, -1).join('\n')}\n`)).toBeUndefined()
    const last = lines.at(-1) ?? ''
    const rewritten = [...lines.slice(0, -1), last.replace(stamp.lastLineId, 'deadbeef')]
    expect(readResumeTarget(`${rewritten.join('\n')}\n`)).toBeUndefined()
  })
})

describe('an export with no messages yet', () => {
  it('stamps the header line itself, and can still be resumed', () => {
    const { text } = renderSessionTree({ ...header, durable }, [[]])
    const marker = JSON.parse(text.split('\n')[0])[DURABLE_HEADER_KEY]
    // The header is the last line of its own file, so the stamp names it and counts no body lines.
    expect(marker).toMatchObject({ lines: 0, lastLineId: header.sessionId })
    expect(readResumeTarget(text)).toBeDefined()
  })

  it('is refused once a message is added, because the file is no longer the one it wrote', () => {
    const { text } = renderSessionTree({ ...header, durable }, [[]])
    expect(readResumeTarget(`${text}${line({ type: 'message', id: 'beef' })}`)).toBeUndefined()
  })
})

describe('canResumeFile', () => {
  it('says yes only for a file this runtime wrote and still matches', async () => {
    const { canResumeFile } = await import('../electron/pi/durableResume')
    const { mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'openpi-can-resume-'))
    const path = join(dir, 's.jsonl')
    const { text } = renderSessionTree({ ...header, durable }, [[message]])
    await writeFile(path, text, 'utf8')

    expect(await canResumeFile(path)).toBe(true)
    // Changed since the export: no longer ours to reopen.
    await writeFile(path, `${text}${line({ type: 'message', id: 'beef' })}`, 'utf8')
    expect(await canResumeFile(path)).toBe(false)
    // Missing entirely.
    expect(await canResumeFile(join(dir, 'nope.jsonl'))).toBe(false)
    // An SDK session.
    const sdk = join(dir, 'sdk.jsonl')
    await writeFile(sdk, line({ type: 'session', version: 3, id: 'sdk-1' }), 'utf8')
    expect(await canResumeFile(sdk)).toBe(false)
  })
})
