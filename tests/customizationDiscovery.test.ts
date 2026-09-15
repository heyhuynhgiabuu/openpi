import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  collectExtensionPath,
  discoverExtensionItems,
} from '../electron/services/customizationHelpers'
import { createCustomizationFixture } from './helpers/customizationFixture'
import type { CustomizationFixture } from './helpers/customizationFixture'
import type { CustomizationDiagnostic } from '../src/lib/ipc'

/**
 * Filesystem-backed discovery: which extensions the panel lists, where they came
 * from, and whether they may run. A project extension executes with full system
 * permissions, so it stays disabled until the workspace is trusted.
 */

let fixture: CustomizationFixture

beforeEach(() => {
  fixture = createCustomizationFixture()
})

afterEach(() => {
  fixture.cleanup()
})

describe('collectExtensionPath', () => {
  it('returns nothing for a missing directory and warns only for a configured one', () => {
    const diagnostics: CustomizationDiagnostic[] = []
    const options = {
      scope: 'user' as const,
      origin: 'top-level' as const,
      source: 'user-global',
      diagnostics,
      workspaceTrusted: true,
    }
    expect(collectExtensionPath(path.join(fixture.root, 'missing'), options)).toEqual([])
    expect(diagnostics).toEqual([])

    expect(
      collectExtensionPath(path.join(fixture.root, 'missing'), {
        ...options,
        origin: 'settings',
        configuredPath: './missing',
      })
    ).toEqual([])
    expect(diagnostics).toEqual([
      {
        type: 'warning',
        message: 'Configured extension path does not exist: ./missing',
        path: path.join(fixture.root, 'missing'),
        scope: 'user',
      },
    ])
  })

  it('describes a project extension as local and gates it on workspace trust', () => {
    fixture.write('proj/.pi/extensions/danger.ts')
    const items = collectExtensionPath(path.join(fixture.root, 'proj', '.pi', 'extensions'), {
      scope: 'project',
      origin: 'top-level',
      source: 'project-local',
      diagnostics: [],
      workspaceTrusted: false,
    })
    expect(items).toHaveLength(1)
    const [extension] = items
    expect(extension?.name).toBe('danger')
    expect(extension?.description).toBe('Project-local executable Pi extension.')
    expect(extension?.enabled).toBe(false)
    expect(extension?.riskLevel).toBe('high')
    expect(extension?.warning).toMatch(/require workspace trust/)
    expect(extension?.lastModifiedAt).not.toBeNull()
  })

  it('enables a user extension and leaves it unwarned', () => {
    fixture.write('agent/extensions/safe.ts')
    const items = collectExtensionPath(path.join(fixture.root, 'agent', 'extensions'), {
      scope: 'user',
      origin: 'top-level',
      source: 'user-global',
      diagnostics: [],
      workspaceTrusted: false,
    })
    expect(items[0]?.enabled).toBe(true)
    expect(items[0]?.warning).toBeUndefined()
    expect(items[0]?.description).toBe('Executable Pi extension.')
  })

  it('enables a trusted project extension', () => {
    fixture.write('proj/.pi/extensions/danger.ts')
    const items = collectExtensionPath(path.join(fixture.root, 'proj', '.pi', 'extensions'), {
      scope: 'project',
      origin: 'top-level',
      source: 'project-local',
      diagnostics: [],
      workspaceTrusted: true,
    })
    expect(items[0]?.enabled).toBe(true)
    expect(items[0]?.warning).toBeUndefined()
  })
})

describe('discoverExtensionItems', () => {
  function settingsManager(global: string[], project: string[]) {
    return {
      getGlobalSettings: () => ({ extensions: global }),
      getProjectSettings: () => ({ extensions: project }),
    }
  }

  it('collects the user directory, the project directory and both settings lists', () => {
    const cwd = path.join(fixture.root, 'workspace')
    const agentDir = path.join(fixture.root, 'agent')
    fixture.write('agent/extensions/global.ts')
    fixture.write('workspace/.pi/extensions/local.ts')
    fixture.write('elsewhere/configured.ts')
    fixture.write('workspace/.pi/extra/project-configured.ts')

    const diagnostics: CustomizationDiagnostic[] = []
    const items = discoverExtensionItems({
      cwd,
      agentDir,
      settingsManager: settingsManager(
        ['../elsewhere/configured.ts'],
        ['extra/project-configured.ts']
      ),
      diagnostics,
      workspaceTrusted: true,
    })

    expect(items.map((entry) => `${entry.scope}:${entry.origin}:${entry.name}`).sort()).toEqual([
      'project:settings:project-configured',
      'project:top-level:local',
      'user:settings:configured',
      'user:top-level:global',
    ])
    expect(items.every((entry) => entry.type === 'extensions')).toBe(true)
    expect(items.every((entry) => entry.riskLevel === 'high')).toBe(true)
    expect(diagnostics).toEqual([])
    for (const entry of items) {
      expect(entry.id).toBe(`extensions:${entry.path}`)
      expect(entry.path?.startsWith(fixture.root)).toBe(true)
    }
    expect(items.find((entry) => entry.name === 'global')?.source).toBe('user-global')
    expect(items.find((entry) => entry.name === 'configured')?.source).toBe('settings.json')
    expect(items.find((entry) => entry.name === 'project-configured')?.source).toBe(
      '.pi/settings.json'
    )
  })

  it('resolves a project-configured path against the project .pi directory', () => {
    // Pi resolves a project's settings paths against `<cwd>/.pi`, so a path that
    // only exists there is the one that loads.
    const cwd = path.join(fixture.root, 'workspace')
    fixture.write('workspace/.pi/configured/proj.ts')
    const items = discoverExtensionItems({
      cwd,
      agentDir: path.join(fixture.root, 'agent'),
      settingsManager: settingsManager([], ['configured/proj.ts']),
      diagnostics: [],
      workspaceTrusted: true,
    })
    expect(items.map((entry) => entry.name)).toEqual(['proj'])
    expect(items[0]?.path).toBe(path.join(cwd, '.pi', 'configured', 'proj.ts'))
  })

  it('warns for a configured path that does not exist', () => {
    const diagnostics: CustomizationDiagnostic[] = []
    discoverExtensionItems({
      cwd: path.join(fixture.root, 'workspace'),
      agentDir: path.join(fixture.root, 'agent'),
      settingsManager: settingsManager([], ['missing.ts']),
      diagnostics,
      workspaceTrusted: false,
    })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain('missing.ts')
    expect(diagnostics[0]?.scope).toBe('project')
  })

  it('keeps project extensions disabled until the workspace is trusted', () => {
    const cwd = path.join(fixture.root, 'workspace')
    fixture.write('workspace/.pi/extensions/local.ts')
    const diagnostics: CustomizationDiagnostic[] = []
    const options = {
      cwd,
      agentDir: path.join(fixture.root, 'agent'),
      settingsManager: settingsManager([], []),
      diagnostics,
    }
    const untrusted = discoverExtensionItems({ ...options, workspaceTrusted: false })
    expect(untrusted.map((entry) => entry.enabled)).toEqual([false])
    const trusted = discoverExtensionItems({ ...options, workspaceTrusted: true })
    expect(trusted.map((entry) => entry.enabled)).toEqual([true])
  })
})
