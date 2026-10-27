import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The Pi sidecar runs as a utility process, not in Electron's main process, so it must never
 * reach `electron` (`app`, `shell`, `BrowserWindow` do not exist there). This bundles the real
 * entry and walks the import graph; it fails with the chain that leads to `electron`, so a module
 * added to the sidecar's reach cannot quietly break every session start.
 *
 * Static imports, `require()` and `import()` all count: any of them loads the module at runtime.
 * `import type` is erased by the bundler and correctly does not.
 */

const SIDECAR = path.resolve(__dirname, '../electron/pi/sidecar.ts')
const RUNTIME_EDGES = new Set(['import-statement', 'require-call', 'dynamic-import'])

type Graph = Record<string, string[]>

async function importGraph(entry: string): Promise<Graph> {
  const result = await build({
    entryPoints: [entry],
    write: false,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node20',
    logLevel: 'silent',
    metafile: true,
  })
  const graph: Graph = {}
  for (const [input, meta] of Object.entries(result.metafile.inputs)) {
    graph[input] = meta.imports
      .filter((edge) => RUNTIME_EDGES.has(edge.kind))
      .map((edge) => edge.path)
  }
  return graph
}

/** Shortest import chain from `entrySuffix` to `electron`, or undefined when unreachable. */
function chainToElectron(graph: Graph, entrySuffix: string): string[] | undefined {
  const entry = Object.keys(graph).find((input) => input.endsWith(entrySuffix))
  if (!entry) return undefined
  const queue: string[][] = [[entry]]
  const seen = new Set<string>([entry])
  while (queue.length > 0) {
    const chain = queue.shift() ?? []
    const node = chain[chain.length - 1] ?? ''
    for (const next of graph[node] ?? []) {
      if (next === 'electron') return [...chain, next]
      if (!seen.has(next) && graph[next]) {
        seen.add(next)
        queue.push([...chain, next])
      }
    }
  }
  return undefined
}

describe('sidecar bundle', () => {
  it('has no runtime reference to electron anywhere in its reach', async () => {
    const chain = chainToElectron(await importGraph(SIDECAR), 'electron/pi/sidecar.ts')
    expect(chain?.join('\n  -> ')).toBeUndefined()
  }, 60_000)

  it('finds the sidecar entry (guards the check above against a silent miss)', async () => {
    const graph = await importGraph(SIDECAR)
    expect(Object.keys(graph).some((input) => input.endsWith('electron/pi/sidecar.ts'))).toBe(true)
    // The graph reaches the durable adapter, so a regression there would be visible to the walk.
    expect(
      Object.keys(graph).some((input) => input.endsWith('electron/pi/durable/policy.ts'))
    ).toBe(true)
  }, 60_000)
})

describe('electron reachability check', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'openpi-bundle-guard-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function chainFor(source: string): Promise<string[] | undefined> {
    await writeFile(path.join(dir, 'leaf.ts'), source, 'utf8')
    await writeFile(path.join(dir, 'entry.ts'), "import './leaf.ts'\n", 'utf8')
    return chainToElectron(await importGraph(path.join(dir, 'entry.ts')), 'entry.ts')
  }

  it.each([
    ['static import', "import { app } from 'electron'\nvoid app\n"],
    ['require call', "const { app } = require('electron')\nvoid app\n"],
    ['dynamic import', "await import('electron')\n"],
  ])('catches a %s', async (_name, source) => {
    const chain = await chainFor(source)
    expect(chain?.at(-1)).toBe('electron')
    expect(chain).toHaveLength(3)
  })

  it('ignores a type-only import, which never loads at runtime', async () => {
    expect(
      await chainFor("import type { App } from 'electron'\nexport type T = App\n")
    ).toBeUndefined()
  })
})
