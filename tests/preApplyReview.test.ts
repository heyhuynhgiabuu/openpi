import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { EditToolInput, WriteToolInput } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  confirmMessage,
  handleToolCall,
  diffRegion,
  isPreApplyReviewEnabled,
  previewForEdit,
  previewForToolCall,
  previewForWrite,
} from '../.pi/extensions/openpi-preapply-review'

let cwd: string

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-preapply-'))
})

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true })
})

function writeFile(relPath: string, content: string): void {
  const full = path.join(cwd, relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

function context(confirm: (title: string, message: string) => Promise<boolean>) {
  return { cwd, ui: { confirm } }
}

describe('pre-apply review gate', () => {
  it('is off unless the environment opts in', () => {
    expect(isPreApplyReviewEnabled({})).toBe(false)
    expect(isPreApplyReviewEnabled({ OPENPI_PREAPPLY_REVIEW: 'true' })).toBe(false)
    expect(isPreApplyReviewEnabled({ OPENPI_PREAPPLY_REVIEW: '1' })).toBe(true)
  })
})

describe('tool_call handling', () => {
  // Typed with Pi's own tool input types so a schema change fails typecheck
  // instead of silently skipping the gate.
  const editInput: EditToolInput = {
    path: 'a.ts',
    edits: [{ oldText: 'x\n', newText: 'y\n' }],
  }
  const editCall = { toolName: 'edit', input: editInput }

  it('blocks the tool when the user denies, and stays out of the way when they allow', async () => {
    const seen: string[] = []
    const denied = await handleToolCall(
      editCall,
      context(async (title, message) => {
        seen.push(`${title}\n${message}`)
        return false
      })
    )

    expect(denied?.block).toBe(true)
    expect(denied?.reason).toContain('denied')
    expect(seen[0]).toContain('Review before applying: a.ts')
    expect(seen[0]).toContain('-x\n+y')

    const allowed = await handleToolCall(
      editCall,
      context(async () => true)
    )
    expect(allowed).toBeUndefined()
  })

  it('leaves tools it cannot preview alone', async () => {
    const result = await handleToolCall(
      { toolName: 'bash', input: { command: 'rm -rf /' } },
      context(async () => false)
    )

    expect(result).toBeUndefined()
  })
})

describe('diffRegion', () => {
  it('drops the unchanged prefix and suffix and marks the change', () => {
    const body = diffRegion('a\nb\nc\nd\n', 'a\nb\nCHANGED\nd\n')

    expect(body).toBe('-c\n+CHANGED')
  })

  it('handles pure insertions and deletions', () => {
    expect(diffRegion('a\nb\n', 'a\nnew\nb\n')).toBe('+new')
    expect(diffRegion('a\ngone\nb\n', 'a\nb\n')).toBe('-gone')
  })

  it('truncates a long region', () => {
    const before = Array.from({ length: 130 }, (_, i) => `old-${i}`).join('\n')
    const after = Array.from({ length: 130 }, (_, i) => `new-${i}`).join('\n')

    const body = diffRegion(before, after)

    expect(body.split('\n')).toHaveLength(121)
    expect(body.endsWith('… preview truncated')).toBe(true)
  })
})

describe('previews', () => {
  it('describes an edit as the blocks it replaces', () => {
    const input: EditToolInput = {
      path: 'src/App.tsx',
      edits: [{ oldText: 'const a = 1\nconst b = 2', newText: 'const a = 1\nconst b = 3' }],
    }

    const preview = previewForEdit(input, cwd)

    expect(preview).not.toBeNull()
    expect(preview?.path).toBe('src/App.tsx')
    expect(preview?.summary).toBe('edit · -2 lines / +2 lines')
    expect(preview?.body).toBe('-const b = 2\n+const b = 3')
    expect(preview?.created).toBe(false)
  })

  it('previews every edit of a multi-edit call', () => {
    const input: EditToolInput = {
      path: 'src/App.tsx',
      edits: [
        { oldText: 'one\n', newText: 'ONE\n' },
        { oldText: 'two\n', newText: 'TWO\n' },
      ],
    }

    const preview = previewForEdit(input, cwd)

    expect(preview?.summary).toBe('edit · -2 lines / +2 lines · 2 hunks')
    expect(preview?.body).toBe('-one\n+ONE\n\n-two\n+TWO')
  })

  it('marks a new file as a creation and an unchanged write as no change', () => {
    const created = previewForWrite(
      { path: 'docs/new.md', content: 'hello\n' } satisfies WriteToolInput,
      cwd
    )
    expect(created?.created).toBe(true)
    expect(created?.summary).toBe('create · 1 line')
    expect(created?.body).toBe('+hello')

    writeFile('docs/old.md', 'same\n')
    const unchanged = previewForWrite(
      { path: 'docs/old.md', content: 'same\n' } satisfies WriteToolInput,
      cwd
    )
    expect(unchanged?.summary).toBe('no change')
    expect(unchanged?.body).toBe('')
  })

  it('diffs a rewrite against the file on disk', () => {
    writeFile('src/a.ts', 'keep\nold\n')

    const preview = previewForWrite(
      { path: 'src/a.ts', content: 'keep\nnew\n' } satisfies WriteToolInput,
      cwd
    )

    expect(preview?.summary).toBe('write · 2 lines → 2 lines')
    expect(preview?.body).toBe('-old\n+new')
    expect(preview?.created).toBe(false)
  })

  it('does not call an unreadable file a creation', () => {
    writeFile('blob.bin', 'binary\0content\n')

    const preview = previewForWrite({ path: 'blob.bin', content: 'replacement\n' }, cwd)

    expect(preview?.created).toBe(false)
    expect(preview?.summary).toBe('overwrite · 1 line, current content not previewable')
    expect(preview?.body).toBe('')
  })

  it('ignores tools and inputs it cannot preview', () => {
    expect(previewForToolCall('bash', { command: 'rm -rf /' }, cwd)).toBeNull()
    expect(previewForToolCall('edit', { path: 'a.ts' }, cwd)).toBeNull()
    expect(previewForToolCall('write', { content: 'x' }, cwd)).toBeNull()
  })

  it('tells the user what allow and deny do', () => {
    writeFile('a.ts', 'y\n')

    const preview = previewForWrite({ path: 'a.ts', content: 'x\n' }, cwd)
    const message = preview ? confirmMessage(preview) : ''

    expect(message).toContain('-y\n+x')
    expect(message).toContain('Deny blocks the write')
  })
})
