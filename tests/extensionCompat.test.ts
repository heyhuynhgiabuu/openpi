import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyExtension, detectApis } from '../electron/pi/durable/extensionCompat'

/**
 * Phase 8.2d: the compat gate reports what will not run on the durable runtime, so a cutover can
 * name lost behaviour instead of silently dropping it.
 */

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'openpi-extcompat-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function writeExtension(name: string, source: string): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, source, 'utf-8')
  return path
}

describe('extension API detection', () => {
  it('detects tools and tool_call hooks as mappable', () => {
    const apis = detectApis(`
      export default function (pi) {
        pi.registerTool({ name: 'x' });
        pi.on('tool_call', async (event) => undefined);
      }
    `)
    expect(apis).toEqual(['registerTool', 'tool_call'])
  })

  it('detects commands, shortcuts, providers and message injection', () => {
    const apis = detectApis(`
      export default function (api) {
        api.registerCommand({ name: 'c' });
        api.registerShortcut('ctrl+x', () => {});
        api.registerProvider({ id: 'p' });
        api.sendMessage({ role: 'user', content: 'hi' });
        api.appendEntry({ type: 'custom' });
        api.setActiveTools(['bash']);
      }
    `)
    expect(apis).toEqual(
      expect.arrayContaining([
        'registerCommand',
        'registerShortcut',
        'registerProvider',
        'sendMessage',
        'appendEntry',
        'setActiveTools',
      ])
    )
  })

  it('detects session lifecycle events as unmappable', () => {
    const apis = detectApis(`
      pi.on('session_start', () => {});
      pi.on('session_before_compact', () => {});
      pi.on('project_trust', () => {});
    `)
    expect(apis).toEqual(['session_events'])
  })

  it('maps context-shaping events onto the context category', () => {
    const apis = detectApis(`pi.on('context', () => {}); pi.on('resources_discover', () => {});`)
    expect(apis).toEqual(['context', 'resources_discover'])
  })

  it('returns nothing for a source with no extension calls', () => {
    expect(detectApis('export const x = 1')).toEqual([])
  })
})

describe('extension classification', () => {
  it('marks a tool-only extension compatible', async () => {
    const path = await writeExtension('tool.ts', `pi.registerTool({ name: 'a' })`)
    const result = classifyExtension(path)
    expect(result.verdict).toBe('compatible')
    expect(result.blocking).toEqual([])
  })

  it('marks a partial extension and lists no blockers', async () => {
    const path = await writeExtension('ctx.ts', `pi.registerTool({}); pi.on('context', () => {})`)
    const result = classifyExtension(path)
    expect(result.verdict).toBe('partial')
    expect(result.blocking).toEqual([])
  })

  it('marks an extension with unmappable APIs unsupported and names them', async () => {
    const path = await writeExtension(
      'cmd.ts',
      `pi.registerCommand({ name: 'c' }); pi.on('session_start', () => {})`
    )
    const result = classifyExtension(path)
    expect(result.verdict).toBe('unsupported')
    expect(result.blocking).toEqual(['registerCommand', 'session_events'])
  })

  it('reports a missing file instead of throwing', () => {
    const result = classifyExtension(join(dir, 'nope.ts'))
    expect(result.verdict).toBe('unsupported')
    expect(result.apis).toEqual([])
  })
})
