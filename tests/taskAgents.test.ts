/**
 * taskAgents.test.ts — catalog enumeration for the composer's @mention list.
 *
 * pi-task's own discovery is imported from the installed package; these tests
 * stub that boundary and assert what OpenPi adds: package location, hidden
 * filtering, field mapping, Zod validation, and fail-soft behavior.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listTaskAgents, resolvePiTaskDir } from '../electron/services/taskAgents'

const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-agents-'))
  tmpDirs.push(dir)
  return dir
}

interface FakeAgent {
  [key: string]: unknown
}

/** Stub of pi-task's helpers module honoring the discoverAgents contract.
 * Accepts unknown entries so tests can feed malformed shapes. */
function fakeHelpers(agents: unknown[]) {
  // SAFETY: the stub only reads `name` for test-deterministic ordering.
  const nameOf = (entry: unknown): string =>
    String((entry as Partial<Record<'name', unknown>> | undefined)?.name)
  return {
    discoverAgents: () => ({
      agents: [...agents].sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
      piDir: '/unused',
    }),
  }
}

function writePiTaskPackage(root: string): string {
  const pkgDir = path.join(root, 'npm', 'node_modules', '@heyhuynhgiabuu', 'pi-task')
  fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true })
  fs.mkdirSync(path.join(pkgDir, 'agents'), { recursive: true })
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: '@heyhuynhgiabuu/pi-task', version: '0.0.0-test' })
  )
  // The real import is injected via importHelpers; the file only has to exist.
  fs.writeFileSync(path.join(pkgDir, 'dist', 'helpers.js'), 'export const stub = true\n')
  return pkgDir
}

const baseAgent = {
  description: 'Does things',
  readonly: false,
  proactive: false,
  source: 'bundled',
  path: '/x/agent.md',
}

describe('resolvePiTaskDir', () => {
  it('prefers the npm package layout under the agent dir', () => {
    const root = tmpDir()
    const pkgDir = path.join(root, 'npm', 'node_modules', '@heyhuynhgiabuu', 'pi-task')
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{}')
    expect(resolvePiTaskDir(root)).toBe(pkgDir)
  })

  it('falls back to the plain node_modules layout, then null', () => {
    const root = tmpDir()
    const pkgDir = path.join(root, 'node_modules', '@heyhuynhgiabuu', 'pi-task')
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{}')
    expect(resolvePiTaskDir(root)).toBe(pkgDir)
    expect(resolvePiTaskDir(tmpDir())).toBeNull()
  })
})

describe('listTaskAgents', () => {
  it('returns [] when pi-task is not installed', async () => {
    const agents = await listTaskAgents({ agentDir: tmpDir(), cwd: tmpDir() })
    expect(agents).toEqual([])
  })

  it('returns [] when the helpers module has an unexpected shape', async () => {
    const root = tmpDir()
    writePiTaskPackage(root)
    const agents = await listTaskAgents({
      agentDir: root,
      cwd: root,
      importHelpers: async () => ({ nope: 1 }),
    })
    expect(agents).toEqual([])
  })

  it('maps pi-task agents into the IPC DTO', async () => {
    const root = tmpDir()
    writePiTaskPackage(root)
    const agents = await listTaskAgents({
      agentDir: root,
      cwd: root,
      importHelpers: async () =>
        fakeHelpers([
          {
            ...baseAgent,
            name: 'scout',
            readonly: true,
            proactive: true,
            model: 'antigravity/gemini',
            thinking: 'high',
            maxTurns: 12,
            tools: ['read', 'grep'],
            disallowedTools: ['write'],
            skills: ['memory'],
          },
          { ...baseAgent, name: 'general' },
        ]),
    })
    expect(agents.map((a) => a.name)).toEqual(['general', 'scout'])
    const scout = agents[1]
    expect(scout).toMatchObject({
      source: 'bundled',
      readonly: true,
      proactive: true,
      model: 'antigravity/gemini',
      thinking: 'high',
      maxTurns: 12,
      tools: ['read', 'grep'],
      disallowedTools: ['write'],
      skills: ['memory'],
    })
    expect(agents[0]).toMatchObject({ readonly: false, tools: [] })
  })

  it('drops hidden agents, malformed entries, and unknown sources', async () => {
    const root = tmpDir()
    writePiTaskPackage(root)
    const agents = await listTaskAgents({
      agentDir: root,
      cwd: root,
      importHelpers: async () =>
        fakeHelpers([
          { ...baseAgent, name: 'visible' },
          { ...baseAgent, name: 'secret', hidden: true },
          { name: 'no-description' },
          { description: 42 },
          'not-an-object',
          { ...baseAgent, name: 'bad-source', source: 'stolen' },
        ]),
    })
    expect(agents.map((a) => a.name)).toEqual(['visible'])
  })

  it('fail-soft returns [] when importHelpers rejects', async () => {
    const root = tmpDir()
    writePiTaskPackage(root)
    const agents = await listTaskAgents({
      agentDir: root,
      cwd: root,
      importHelpers: async () => {
        throw new Error('boom')
      },
    })
    expect(agents).toEqual([])
  })
})
