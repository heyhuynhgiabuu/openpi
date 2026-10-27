import path from 'node:path'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

/**
 * The Pi sidecar runs as a utility process, not in Electron's main process, so it must never
 * reach a value import of `electron` (`app`, `shell`, `BrowserWindow` do not exist there). This
 * bundles the real entry and walks the import graph; it fails with the chain that leads to
 * `electron`, so a module added to the sidecar's reach cannot quietly break every session start.
 */

const ENTRY = path.resolve(__dirname, '../electron/pi/sidecar.ts')

async function importGraph(): Promise<Record<string, string[]>> {
  const result = await build({
    entryPoints: [ENTRY],
    write: false,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node20',
    logLevel: 'silent',
    metafile: true,
  })
  const graph: Record<string, string[]> = {}
  for (const [input, meta] of Object.entries(result.metafile.inputs)) {
    graph[input] = meta.imports
      .filter((entry) => entry.kind === 'import-statement')
      .map((entry) => (entry.external === true ? entry.path : entry.path))
  }
  return graph
}

/** Shortest import chain from the entry to any importer of `electron`, or undefined. */
function chainToElectron(graph: Record<string, string[]>): string[] | undefined {
  const entry = Object.keys(graph).find((input) => input.endsWith('electron/pi/sidecar.ts'))
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
  it('has no value import of electron anywhere in its reach', async () => {
    const chain = chainToElectron(await importGraph())
    expect(chain?.join('\n  -> ')).toBeUndefined()
  }, 60_000)

  it('finds the sidecar entry (guards the check above against a silent miss)', async () => {
    const graph = await importGraph()
    expect(Object.keys(graph).some((input) => input.endsWith('electron/pi/sidecar.ts'))).toBe(true)
    // The graph reaches the durable adapter, so a regression there would be visible to the walk.
    expect(
      Object.keys(graph).some((input) => input.endsWith('electron/pi/durable/policy.ts'))
    ).toBe(true)
  }, 60_000)
})
