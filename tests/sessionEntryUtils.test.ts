import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  canonicalizePath,
  contentToText,
  displayNameForPath,
  durationFrom,
  entryTimestampMs,
  isRecord,
  numeric,
  truncate,
  usageTotalTokens,
} from '../electron/session/sessionEntryUtils'
import type { SessionEntry } from '../electron/session/sessionEntries'

let root = ''

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-entry-utils-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('contentToText', () => {
  it('reads a string and trims it', () => {
    expect(contentToText('  hello  ')).toBe('hello')
  })

  it('joins text parts and ignores the rest', () => {
    expect(
      contentToText([
        { type: 'text', text: 'one ' },
        { type: 'image', data: 'ignored' },
        { type: 'text', text: 'two' },
      ])
    ).toBe('one two')
  })

  it('returns an empty string for shapes it cannot read', () => {
    expect(contentToText(undefined)).toBe('')
    expect(contentToText(42)).toBe('')
    expect(contentToText({ text: 'not an array' })).toBe('')
  })
})

describe('numeric', () => {
  it('keeps finite numbers and zeroes everything else', () => {
    expect(numeric(12)).toBe(12)
    expect(numeric(0)).toBe(0)
    expect(numeric(Number.NaN)).toBe(0)
    expect(numeric(Number.POSITIVE_INFINITY)).toBe(0)
    expect(numeric('12')).toBe(0)
    expect(numeric(null)).toBe(0)
  })
})

describe('usageTotalTokens', () => {
  it('prefers a reported total', () => {
    expect(usageTotalTokens({ totalTokens: 30, input: 100, output: 100 })).toBe(30)
  })

  it('sums the parts when no total was reported', () => {
    expect(usageTotalTokens({ input: 10, output: 4, cacheRead: 2, cacheWrite: 1 })).toBe(17)
  })

  it('treats missing parts as zero', () => {
    expect(usageTotalTokens({ input: 10 })).toBe(10)
    expect(usageTotalTokens({})).toBe(0)
  })
})

describe('entryTimestampMs', () => {
  const entry: SessionEntry = {
    type: 'message',
    id: 'a',
    parentId: null,
    timestamp: '2026-09-14T10:00:00.000Z',
  }

  it('prefers the message timestamp', () => {
    expect(entryTimestampMs(entry, { timestamp: 1_700_000_000_000 })).toBe(1_700_000_000_000)
  })

  it('falls back to the entry timestamp', () => {
    expect(entryTimestampMs(entry, {})).toBe(Date.parse('2026-09-14T10:00:00.000Z'))
  })

  it('returns null when neither is usable', () => {
    expect(entryTimestampMs({ ...entry, timestamp: 'not a date' }, {})).toBeNull()
  })
})

describe('durationFrom', () => {
  it('measures a positive span', () => {
    expect(durationFrom(1_000, 1_500)).toBe(500)
  })

  it('has no duration without an ordered pair', () => {
    expect(durationFrom(null, 1_500)).toBeUndefined()
    expect(durationFrom(1_000, null)).toBeUndefined()
    expect(durationFrom(1_000, 1_000)).toBeUndefined()
    expect(durationFrom(1_500, 1_000)).toBeUndefined()
  })
})

describe('truncate', () => {
  it('collapses whitespace and keeps short text whole', () => {
    expect(truncate('  one\n\ntwo  ', 20)).toBe('one two')
  })

  it('keeps text that is exactly the limit', () => {
    expect(truncate('abcde', 5)).toBe('abcde')
  })

  it('fits the limit exactly when it truncates', () => {
    const result = truncate('abcdefghij', 5)
    expect(result).toBe('abcd…')
    expect(result).toHaveLength(5)
  })
})

describe('paths', () => {
  it('resolves a real path through symlinks', () => {
    const target = path.join(root, 'real')
    fs.mkdirSync(target)
    const link = path.join(root, 'link')
    fs.symlinkSync(target, link, 'dir')

    expect(canonicalizePath(link)).toBe(fs.realpathSync.native(target))
  })

  it('falls back to an absolute path when the file is gone', () => {
    expect(canonicalizePath(path.join(root, 'missing'))).toBe(path.join(root, 'missing'))
  })

  it('names a path by its last segment', () => {
    expect(displayNameForPath('/tmp/work/session.jsonl')).toBe('session.jsonl')
    expect(displayNameForPath('plain')).toBe('plain')
  })
})

describe('isRecord', () => {
  it('accepts objects and rejects null and primitives', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('text')).toBe(false)
    expect(isRecord(7)).toBe(false)
  })
})
