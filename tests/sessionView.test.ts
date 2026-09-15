import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OPENPI_ASCII,
  formatCurrency,
  formatModelName,
  formatRelativeTime,
  labelForTool,
} from '../src/lib/sessionView'

describe('labelForTool', () => {
  it('names every tool in the table', () => {
    const labels = {
      bash: 'Shell',
      sh: 'Shell',
      computer_bash: 'Shell',
      run_command: 'Shell',
      read: 'Read',
      write: 'Write',
      edit: 'Edit',
      multiedit: 'Edit',
      grep: 'Grep',
      find: 'Find',
      ls: 'List',
      task: 'Task',
    }
    for (const [name, label] of Object.entries(labels)) expect(labelForTool(name)).toBe(label)
  })

  it('falls back to a generic label for a tool it does not know', () => {
    expect(labelForTool('mcp__linear__list')).toBe('Tool')
    expect(labelForTool('')).toBe('Tool')
  })

  it('does not answer with Object.prototype members', () => {
    // A tool row renders this string; a function here reaches Solid as a child.
    for (const name of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect(labelForTool(name)).toBe('Tool')
    }
  })

  it('treats tool names as case-sensitive keys', () => {
    expect(labelForTool('BASH')).toBe('Tool')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-09-15T12:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

  it('labels the current minute as "now"', () => {
    expect(formatRelativeTime(ago(0))).toBe('now')
    expect(formatRelativeTime(ago(59_000))).toBe('now')
  })

  it('counts minutes, hours, days and months', () => {
    expect(formatRelativeTime(ago(60_000))).toBe('1m')
    expect(formatRelativeTime(ago(59 * 60_000))).toBe('59m')
    expect(formatRelativeTime(ago(60 * 60_000))).toBe('1h')
    expect(formatRelativeTime(ago(23 * 3_600_000))).toBe('23h')
    expect(formatRelativeTime(ago(24 * 3_600_000))).toBe('1d')
    expect(formatRelativeTime(ago(29 * 86_400_000))).toBe('29d')
    expect(formatRelativeTime(ago(30 * 86_400_000))).toBe('1mo')
    expect(formatRelativeTime(ago(400 * 86_400_000))).toBe('13mo')
  })

  it('clamps a timestamp in the future instead of going negative', () => {
    expect(formatRelativeTime(ago(-5 * 60_000))).toBe('now')
  })

  it('does not render NaN for an unparseable timestamp', () => {
    expect(formatRelativeTime('')).toBe('unknown')
    expect(formatRelativeTime('not a date')).toBe('unknown')
  })
})

describe('formatCurrency', () => {
  it('keeps cents for amounts at or above a dollar', () => {
    expect(formatCurrency(1)).toBe('$1.00')
    expect(formatCurrency(12.345)).toBe('$12.35')
    expect(formatCurrency(1234.5)).toBe('$1234.50')
  })

  it('keeps four decimals below a dollar so small costs stay visible', () => {
    expect(formatCurrency(0.5)).toBe('$0.5000')
    expect(formatCurrency(0.0001)).toBe('$0.0001')
    expect(formatCurrency(0)).toBe('$0.0000')
  })
})

describe('formatModelName', () => {
  it('compacts the hyphenated ids the registry lists first', () => {
    expect(formatModelName('claude-sonnet-4-6')).toBe('sonnet 4.6')
    expect(formatModelName('claude-haiku-4-5')).toBe('haiku 4.5')
    expect(formatModelName('claude-opus-4')).toBe('opus 4')
  })

  it('compacts dotted aliases', () => {
    expect(formatModelName('claude-opus-4.6')).toBe('opus 4.6')
    expect(formatModelName('claude-haiku-4.5')).toBe('haiku 4.5')
    expect(formatModelName('claude-fable-5.1')).toBe('fable 5.1')
  })

  it('compacts dated release ids', () => {
    expect(formatModelName('claude-sonnet-4-5-20250929')).toBe('sonnet 4.5')
    expect(formatModelName('claude-opus-4-5-20251101')).toBe('opus 4.5')
    expect(formatModelName('claude-haiku-4-5-20251001')).toBe('haiku 4.5')
  })

  it('compacts gemini ids down to the version', () => {
    expect(formatModelName('gemini-2.5-pro')).toBe('gemini-2.5')
    expect(formatModelName('gemini-3-flash-preview')).toBe('gemini-3')
  })

  it('does not read a release date as the minor version', () => {
    expect(formatModelName('claude-sonnet-4-20250514')).toBe('sonnet 4')
    expect(formatModelName('claude-opus-4-20250514')).toBe('opus 4')
  })

  it('strips each provider prefix the registry uses', () => {
    expect(formatModelName('anthropic/claude-sonnet-4-5')).toBe('claude-sonnet-4-5')
    expect(formatModelName('google/gemini-2.5-pro')).toBe('gemini-2.5-pro')
    expect(formatModelName('openai/gpt-4o')).toBe('gpt-4o')
  })

  it('leaves ids it has no rule for alone', () => {
    expect(formatModelName('gpt-4o')).toBe('gpt-4o')
    expect(formatModelName('@cf/meta/llama-4-scout-17b-16e-instruct')).toBe(
      '@cf/meta/llama-4-scout-17b-16e-instruct'
    )
  })

  it('returns an empty label for an empty id', () => {
    expect(formatModelName('')).toBe('')
  })
})

describe('OPENPI_ASCII', () => {
  it('is the six row splash the homescreen renders', () => {
    expect(OPENPI_ASCII).toBe(
      [
        ' ██████╗ ██████╗ ███████╗███╗   ██╗██████╗ ██╗',
        '██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔══██╗██║',
        '██║   ██║██████╔╝█████╗  ██╔██╗ ██║██████╔╝██║',
        '██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██╔═══╝ ██║',
        '╚██████╔╝██║     ███████╗██║ ╚████║██║     ██║',
        ' ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝╚═╝     ╚═╝',
      ].join('\n')
    )
    for (const row of OPENPI_ASCII.split('\n')) expect([...row]).toHaveLength(46)
  })
})
