import { describe, expect, it } from 'vitest'
import { buildCoreSlashCommands, findCoreCommand } from '../src/lib/coreCommands'

describe('core slash commands', () => {
  it('builds a stable catalog with all OpenPi-handled commands', () => {
    const list = buildCoreSlashCommands({
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
    })

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
      sessionReady: true,
      onCompact: (instructions) => {
        calls.push({ kind: 'compact', value: instructions })
      },
      onReload: () => {
        calls.push({ kind: 'reload', value: undefined })
      },
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
    })

    const compact = findCoreCommand(list, 'compact')!
    expect(compact).toBeDefined()
    expect(compact.onSelect('focus on test failures')).toBe(true)
    expect(calls).toEqual([{ kind: 'compact', value: 'focus on test failures' }])
  })

  it('returns true (handled) even when /compact has no argument', () => {
    const calls: Array<{ value: string | undefined }> = []
    const list = buildCoreSlashCommands({
      sessionReady: true,
      onCompact: (instructions) => {
        calls.push({ value: instructions })
      },
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
    })

    const compact = findCoreCommand(list, 'compact')!
    expect(compact.onSelect('')).toBe(true)
    expect(calls).toEqual([{ value: undefined }])
  })

  it('shows an error when no session is active', () => {
    const errors: string[] = []
    const list = buildCoreSlashCommands({
      sessionReady: false,
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
      onShowError: (msg) => errors.push(msg),
    })

    const compact = findCoreCommand(list, 'compact')!
    expect(compact.onSelect('any')).toBe(true)
    expect(errors).toEqual(['No active session.'])
  })

  it('rejects /name without a name argument', () => {
    const errors: string[] = []
    let saved: string | null = null
    const list = buildCoreSlashCommands({
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
      onSetSessionName: (name) => {
        saved = name
        return undefined
      },
      onShowSessionInfo: () => {},
      onShowError: (msg) => errors.push(msg),
    })

    const name = findCoreCommand(list, 'name')!
    expect(name.onSelect('')).toBe(true)
    expect(saved).toBeNull()
    expect(errors).toEqual(['Usage: /name <name>'])

    expect(name.onSelect('  my-feature  ')).toBe(true)
    expect(saved).toBe('my-feature')
  })

  it('returns null for unknown commands', () => {
    const list = buildCoreSlashCommands({
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
    })

    expect(findCoreCommand(list, 'nonexistent')).toBeNull()
  })
})
