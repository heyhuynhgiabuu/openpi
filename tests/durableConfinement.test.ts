import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Phase 8 confinement: @earendil-works/pi-durable may only be imported inside electron/pi/durable/. */

const ROOT = join(import.meta.dirname, '..')
const ALLOWED_DIR = 'electron/pi/durable'
const SCAN_DIRS = ['electron', 'src', 'tests']

async function walkSources(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue
      await walkSources(full, out)
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && !/\.(test|d)\.(ts|tsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

describe('pi-durable import confinement', () => {
  it('keeps pi-durable imports inside electron/pi/durable/', async () => {
    const violations: string[] = []
    for (const dir of SCAN_DIRS) {
      const files = await walkSources(join(ROOT, dir))
      for (const file of files) {
        if (file.includes(ALLOWED_DIR)) continue
        const source = await readFile(file, 'utf8')
        if (source.includes('@earendil-works/pi-durable')) violations.push(file)
      }
    }
    expect(violations).toEqual([])
  })
})
