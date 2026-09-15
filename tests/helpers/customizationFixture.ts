import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CustomizationItem } from '../../src/lib/ipc'

/**
 * Fixtures for the customization-discovery tests: a throwaway directory tree and
 * a fully populated customization item to override per case.
 */

export interface CustomizationFixture {
  root: string
  write: (relPath: string, content?: string) => string
  cleanup: () => void
}

export function createCustomizationFixture(): CustomizationFixture {
  const root = mkdtempSync(path.join(tmpdir(), 'openpi-custom-'))
  return {
    root,
    write(relPath, content = 'export default {}\n') {
      const full = path.join(root, relPath)
      mkdirSync(path.dirname(full), { recursive: true })
      writeFileSync(full, content)
      return full
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

export function makeItem(overrides: Partial<CustomizationItem> = {}): CustomizationItem {
  return {
    id: 'extensions:/a/one.ts',
    type: 'extensions',
    name: 'one',
    description: '',
    path: '/a/one.ts',
    scope: 'user',
    origin: 'top-level',
    source: 'user-global',
    enabled: true,
    riskLevel: 'high',
    lastModifiedAt: null,
    ...overrides,
  }
}
