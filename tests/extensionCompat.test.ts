import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyseSource, classifyExtension } from '../electron/pi/durable/extensionCompat'

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
    const { apis } = analyseSource(`
      export default function (pi) {
        pi.registerTool({ name: 'x' });
        pi.on('tool_call', async (event) => undefined);
      }
    `)
    expect(apis).toEqual(['registerTool', 'tool_call'])
  })

  it('detects commands, shortcuts, providers and message injection', () => {
    const { apis } = analyseSource(`
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

  it('maps an unclassified event to unknown_events instead of claiming support', () => {
    const { apis, unknownEvents } = analyseSource(`
      export default function (pi) {
        pi.on('before_agent_start', () => {});
      }
    `)
    expect(apis).toEqual(['unknown_events'])
    expect(unknownEvents).toEqual(['before_agent_start'])
  })

  it('tracks the factory parameter whatever it is named', () => {
    const { apis } = analyseSource(`
      export default function (extension) {
        extension.registerCommand('hello', { handler() {} });
      }
    `)
    expect(apis).toEqual(['registerCommand'])
  })

  it('ignores calls inside comments and string literals', () => {
    const { apis } = analyseSource(`
      export default function (pi) {
        // pi.registerCommand('old', ...)
        const example = "pi.sendMessage({})";
        pi.registerTool({ name: 'x' });
      }
    `)
    expect(apis).toEqual(['registerTool'])
  })

  it('counts any receiver, because the gate fails safe rather than modelling scope', () => {
    // A false "unsupported" costs a review; a false "compatible" loses behaviour silently.
    const { apis } = analyseSource(`
      export default function (pi) {
        const helper = { registerCommand() {} };
        helper.registerCommand();
        pi.registerTool({ name: 'x' });
      }
    `)
    expect(apis).toEqual(['registerTool', 'registerCommand'])
  })

  it('follows a default export through an identifier', () => {
    const { apis } = analyseSource(`
      function extension(pi) {
        pi.registerCommand('hello', { handler() {} });
      }
      export default extension;
    `)
    expect(apis).toEqual(['registerCommand'])
  })

  it('follows a named default factory declaration', () => {
    const { apis } = analyseSource(`
      export default function extension(pi) {
        pi.registerCommand('hello', {});
      }
    `)
    expect(apis).toEqual(['registerCommand'])
  })

  it('is unaffected by block-scoped shadowing of the factory name', () => {
    const { apis } = analyseSource(`
      function extension(api) {
        api.registerCommand('hello', {});
      }
      { const extension = (unused) => {}; }
      export default extension;
    `)
    expect(apis).toEqual(['registerCommand'])
  })

  it('finds a factory declared inside a module-scope block', () => {
    const { apis } = analyseSource(`
      if (process.platform === 'darwin') {
        var extension = function (api) {
          api.registerCommand('hello', {});
        };
      }
      export default extension;
    `)
    expect(apis).toEqual(['registerCommand'])
  })

  it('still counts a same-name nested helper, failing safe', () => {
    const { apis } = analyseSource(`
      function extension(pi) {
        pi.registerTool({ name: 'x' });
      }
      function unrelated() {
        function extension(client) {
          client.sendMessage('hello');
        }
        extension({});
      }
      export default extension;
    `)
    expect(apis).toEqual(['registerTool', 'sendMessage'])
  })

  it('scans exported helpers too, failing safe', () => {
    const { apis } = analyseSource(`
      export function notify(client) {
        client.sendMessage('hello');
      }
      export default function (pi) {
        pi.registerTool({ name: 'x' });
      }
    `)
    expect(apis).toEqual(['registerTool', 'sendMessage'])
  })

  it('maps context-shaping events onto the context category', () => {
    const { apis } = analyseSource(`
      export default function (pi) {
        pi.on('context', () => {});
        pi.on('resources_discover', () => {});
      }
    `)
    expect(apis).toEqual(['context', 'resources_discover'])
  })

  it('returns nothing for a source with no extension calls', () => {
    expect(analyseSource('export const x = 1').apis).toEqual([])
  })
})

describe('extension classification', () => {
  it('marks a tool-only extension compatible', async () => {
    const path = await writeExtension(
      'tool.ts',
      `export default function (pi) { pi.registerTool({ name: 'a' }) }`
    )
    const result = classifyExtension(path)
    expect(result.verdict).toBe('compatible')
    expect(result.blocking).toEqual([])
  })

  it('marks a partial extension and lists no blockers', async () => {
    const path = await writeExtension(
      'ctx.ts',
      `export default function (pi) { pi.registerTool({}); pi.on('context', () => {}) }`
    )
    const result = classifyExtension(path)
    expect(result.verdict).toBe('partial')
    expect(result.blocking).toEqual([])
  })

  it('marks an extension with unmappable APIs unsupported and names them', async () => {
    const path = await writeExtension(
      'cmd.ts',
      `export default function (pi) { pi.registerCommand({ name: 'c' }); pi.on('session_start', () => {}) }`
    )
    const result = classifyExtension(path)
    expect(result.verdict).toBe('unsupported')
    expect(result.blocking).toEqual(['registerCommand', 'unknown_events'])
    expect(result.unknownEvents).toEqual(['session_start'])
  })

  it('reports a missing file instead of throwing', () => {
    const result = classifyExtension(join(dir, 'nope.ts'))
    expect(result.verdict).toBe('unsupported')
    expect(result.apis).toEqual([])
  })
})
