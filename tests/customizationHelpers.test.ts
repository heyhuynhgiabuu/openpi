import { mkdirSync, statSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  extensionName,
  inferScope,
  inferSource,
  itemId,
  mtimeIso,
  resolveConfiguredPath,
  riskLevelForType,
  sourceFrom,
  toDiagnostic,
} from '../electron/services/customizationHelpers'
import {
  collectExtensionFiles,
  isExtensionEntryFile,
  selectExtensionEntries,
} from '../electron/services/extensionFiles'
import { createCustomizationFixture } from './helpers/customizationFixture'
import type { CustomizationFixture } from './helpers/customizationFixture'

/**
 * The pure helpers behind the Customizations panel. The extension-entry rules
 * mirror Pi's own loader, so a file Pi loads but this module skips is an
 * invisible customization.
 */

let fixture: CustomizationFixture

beforeEach(() => {
  fixture = createCustomizationFixture()
})

afterEach(() => {
  fixture.cleanup()
})

describe('extension entry rules', () => {
  it('accepts the file extensions Pi loads', () => {
    // Pi's loader: name.endsWith('.ts') || name.endsWith('.js')
    expect(isExtensionEntryFile('/x/one.ts')).toBe(true)
    expect(isExtensionEntryFile('/x/one.js')).toBe(true)
    expect(isExtensionEntryFile('/x/one.mjs')).toBe(false)
    expect(isExtensionEntryFile('/x/one.tsx')).toBe(false)
    expect(isExtensionEntryFile('/x/one')).toBe(false)
  })

  it('lists ts and js files in a directory, sorted, skipping hidden entries', () => {
    // Twelve files written in reverse alphabetical order: the result must come
    // back sorted regardless of the order the filesystem reports.
    const names = ['l', 'k', 'j', 'i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']
    for (const [index, name] of names.entries()) {
      fixture.write(`ext/${name}.${index % 2 === 0 ? 'ts' : 'js'}`)
    }
    fixture.write('ext/notes.md')
    fixture.write('ext/.hidden.ts')
    const listed = collectExtensionFiles(path.join(fixture.root, 'ext')).map((file) =>
      path.basename(file)
    )
    expect(listed).toEqual([
      'a.js',
      'b.ts',
      'c.js',
      'd.ts',
      'e.js',
      'f.ts',
      'g.js',
      'h.ts',
      'i.js',
      'j.ts',
      'k.js',
      'l.ts',
    ])
  })

  it('takes a directory entry point as index.ts or index.js', () => {
    fixture.write('ext/withTs/index.ts')
    fixture.write('ext/withJs/index.js')
    fixture.write('ext/plain/other.ts')
    expect(collectExtensionFiles(path.join(fixture.root, 'ext'))).toEqual([
      path.join(fixture.root, 'ext', 'withJs', 'index.js'),
      path.join(fixture.root, 'ext', 'withTs', 'index.ts'),
    ])
  })

  it('prefers index.ts when a directory has both entry points', () => {
    fixture.write('ext/both/index.ts')
    fixture.write('ext/both/index.js')
    expect(collectExtensionFiles(path.join(fixture.root, 'ext'))).toEqual([
      path.join(fixture.root, 'ext', 'both', 'index.ts'),
    ])
  })

  it('sorts a listing it is handed, independent of the filesystem order', () => {
    // The seam takes the directory listing as data, so the ordering guarantee is
    // testable even where readdir happens to return entries sorted already.
    const dir = path.join(fixture.root, 'ext')
    expect(
      selectExtensionEntries(
        [
          { name: 'b.ts', isFile: true, isDirectory: false },
          { name: 'a.js', isFile: true, isDirectory: false },
          { name: 'notes.md', isFile: true, isDirectory: false },
          { name: '.hidden.ts', isFile: true, isDirectory: false },
          { name: 'plain', isFile: false, isDirectory: true },
        ],
        dir
      )
    ).toEqual([path.join(dir, 'a.js'), path.join(dir, 'b.ts')])
  })

  it('lists a symlinked entry, and skips a dangling one', () => {
    const realFile = fixture.write('real/one.ts')
    const realDir = fixture.write('real/pkg/index.ts')
    mkdirSync(path.join(fixture.root, 'ext'), { recursive: true })
    symlinkSync(realFile, path.join(fixture.root, 'ext', 'linked.ts'))
    symlinkSync(path.dirname(realDir), path.join(fixture.root, 'ext', 'linkedDir'))
    symlinkSync(path.join(fixture.root, 'nowhere'), path.join(fixture.root, 'ext', 'dangling.ts'))
    expect(
      collectExtensionFiles(path.join(fixture.root, 'ext')).map((file) => path.basename(file))
    ).toEqual(['linked.ts', 'index.ts'])
  })

  it('returns a single file only when it is an entry file', () => {
    const entry = fixture.write('ext/one.ts')
    const other = fixture.write('ext/notes.md')
    expect(collectExtensionFiles(entry)).toEqual([entry])
    expect(collectExtensionFiles(other)).toEqual([])
  })

  it('finds nothing for a path that is neither file nor directory', () => {
    const link = path.join(fixture.root, 'dangling')
    symlinkSync(path.join(fixture.root, 'missing'), link)
    expect(collectExtensionFiles(link)).toEqual([])
  })

  it('names an index entry after its directory', () => {
    expect(extensionName('/x/my-ext/index.ts')).toBe('my-ext')
    expect(extensionName('/x/my-ext/entry.ts')).toBe('entry')
    expect(extensionName('/x/my-ext/entry.js')).toBe('entry')
  })
})

describe('resource labels', () => {
  it('marks extensions high risk and packages medium', () => {
    expect(riskLevelForType('extensions')).toBe('high')
    expect(riskLevelForType('packages')).toBe('medium')
    expect(riskLevelForType('skills')).toBe('low')
    expect(riskLevelForType('prompts')).toBe('low')
    expect(riskLevelForType('themes')).toBe('low')
  })

  it('keeps the global agent directory in the user scope', () => {
    const sep = path.sep
    const agentSkill = `${sep}Users${sep}me${sep}.pi${sep}agent${sep}skills${sep}x${sep}SKILL.md`
    const projectSkill = `${sep}work${sep}repo${sep}.pi${sep}skills${sep}x${sep}SKILL.md`
    expect(inferScope(agentSkill)).toBe('user')
    expect(inferScope(projectSkill)).toBe('project')
    expect(inferSource(agentSkill)).toBe('user-global')
    expect(inferSource(projectSkill)).toBe('project-local')
  })

  it('treats a sibling of the agent directory as project-scoped', () => {
    const sep = path.sep
    expect(inferScope(`${sep}Users${sep}me${sep}.pi${sep}agent-extra${sep}x.md`)).toBe('project')
    expect(inferSource(`${sep}Users${sep}me${sep}.pi${sep}agent-extra${sep}x.md`)).toBe(
      'project-local'
    )
  })

  it('falls back to the user scope for missing or unrelated paths', () => {
    expect(inferScope(null)).toBe('user')
    expect(inferScope('')).toBe('user')
    expect(inferScope('/tmp/loose.ts')).toBe('user')
    expect(inferSource(null)).toBe('built-in')
    expect(inferSource('/tmp/loose.ts')).toBe('user-global')
  })

  it('prefers what the resource reports and fills the rest from the path', () => {
    const projectSkill = `/work/repo/.pi/skills/x/SKILL.md`.split('/').join(path.sep)
    expect(sourceFrom(undefined, projectSkill)).toEqual({
      source: 'project-local',
      scope: 'project',
      origin: 'top-level',
    })
    expect(
      sourceFrom({ source: 'package', scope: 'temporary', origin: 'package' }, projectSkill)
    ).toEqual({ source: 'package', scope: 'temporary', origin: 'package' })
    // A reported value wins; the path only fills the gaps.
    expect(sourceFrom({ scope: 'temporary' }, projectSkill)).toEqual({
      source: 'project-local',
      scope: 'temporary',
      origin: 'top-level',
    })
  })

  it('maps a diagnostic type onto the three kinds the UI renders', () => {
    expect(toDiagnostic({ type: 'error', message: 'boom', path: '/x' })).toEqual({
      type: 'error',
      message: 'boom',
      path: '/x',
    })
    expect(toDiagnostic({ type: 'info', message: 'fyi' })).toEqual({
      type: 'info',
      message: 'fyi',
      path: undefined,
    })
    expect(toDiagnostic({ type: 'warning' })).toEqual({
      type: 'warning',
      message: 'Resource diagnostic',
      path: undefined,
    })
    expect(toDiagnostic({})).toEqual({
      type: 'warning',
      message: 'Resource diagnostic',
      path: undefined,
    })
  })

  it('resolves a configured path against its base directory', () => {
    const absolute = path.join(fixture.root, 'abs', 'one.ts')
    // An absolute path is used as-is; a relative one is resolved against the base.
    expect(resolveConfiguredPath(absolute, fixture.root)).toBe(absolute)
    expect(resolveConfiguredPath('sub/one.ts', fixture.root)).toBe(
      path.join(fixture.root, 'sub', 'one.ts')
    )
  })

  it('reports the file mtime as an ISO timestamp', () => {
    const file = fixture.write('ext/one.ts')
    const expected = statSync(file).mtimeMs
    const iso = mtimeIso(file)
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // The value, not just the shape: a constant timestamp must not pass.
    expect(Math.abs(new Date(iso ?? '').getTime() - expected)).toBeLessThan(2000)
  })

  it('reports no mtime for a missing path', () => {
    expect(mtimeIso(path.join(fixture.root, 'nope.ts'))).toBeNull()
    expect(mtimeIso(null)).toBeNull()
    expect(mtimeIso(undefined)).toBeNull()
  })

  it('builds an id from the type and key', () => {
    expect(itemId('skills', '/x/SKILL.md')).toBe('skills:/x/SKILL.md')
  })
})
