import { describe, expect, it } from 'vitest'
import { buildCoreSlashCommands, findCoreCommand } from '../src/lib/coreCommands'

function baseCtx() {
  return {
    sessionReady: true,
    onCompact: () => {},
    onReload: () => {},
    onCopyLast: () => null,
    onOpenModelPicker: () => {},
    onOpenSettings: () => {},
    onOpenLogin: () => {},
    onLogout: () => {},
    onNewSession: () => {},
    onOpenResumeDialog: () => {},
    onCycleThinking: () => {},
    onCycleModel: () => {},
    onSetSessionName: () => {},
    onShowSessionInfo: () => {},
    onShowError: () => {},
    onPrefillInput: () => {},
  }
}

describe('core slash commands', () => {
  it('builds a stable catalog with all OpenPi-handled commands', () => {
    const list = buildCoreSlashCommands(baseCtx())

    const slashes = list.map((cmd) => cmd.slash).sort()
    expect(slashes).toEqual(
      [
        'compact',
        'copy',
        'login',
        'logout',
        'model',
        'name',
        'new',
        'reload',
        'resume',
        'scoped-models',
        'session',
        'settings',
        'thinking',
      ].sort()
    )
  })

  it('dispatches /compact to onCompact with the user-supplied instructions', () => {
    const calls: Array<{ kind: string; value: string | undefined }> = []
    const list = buildCoreSlashCommands({
      ...baseCtx(),
      onCompact: (instructions) => {
        calls.push({ kind: 'compact', value: instructions })
      },
    })

    const compact = findCoreCommand(list, 'compact')!
    expect(compact).toBeDefined()
    expect(compact.onSelect('focus on test failures')).toBe(true)
    expect(calls).toEqual([{ kind: 'compact', value: 'focus on test failures' }])
  })

  it('returns true (handled) even when /compact has no argument', () => {
    const calls: Array<{ value: string | undefined }> = []
    const list = buildCoreSlashCommands({
      ...baseCtx(),
      onCompact: (instructions) => {
        calls.push({ value: instructions })
      },
    })

    const compact = findCoreCommand(list, 'compact')!
    expect(compact.onSelect('')).toBe(true)
    expect(calls).toEqual([{ value: undefined }])
  })

  it('shows an error when no session is active', () => {
    const errors: string[] = []
    const list = buildCoreSlashCommands({
      ...baseCtx(),
      sessionReady: false,
      onShowError: (msg) => errors.push(msg),
    })

    const compact = findCoreCommand(list, 'compact')!
    expect(compact.onSelect('any')).toBe(true)
    expect(errors).toEqual(['No active session.'])
  })

  it('prefills /name with a trailing space when no argument is supplied', () => {
    const prefills: string[] = []
    let saved: string | null = null
    const list = buildCoreSlashCommands({
      ...baseCtx(),
      onSetSessionName: (name) => {
        saved = name
        return undefined
      },
      onPrefillInput: (text) => prefills.push(text),
    })

    const name = findCoreCommand(list, 'name')!
    expect(name.onSelect('')).toBe(true)
    expect(saved).toBeNull()
    expect(prefills).toEqual(['/name '])

    expect(name.onSelect('  my-feature  ')).toBe(true)
    expect(saved).toBe('my-feature')
  })

  it('returns null for unknown commands', () => {
    const list = buildCoreSlashCommands(baseCtx())
    expect(findCoreCommand(list, 'nonexistent')).toBeNull()
  })
})
