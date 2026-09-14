import { describe, expect, it } from 'vitest'
import {
  confirmMessage,
  handleToolCall,
  diffRegion,
  isPreApplyReviewEnabled,
  previewForEdit,
  previewForToolCall,
  previewForWrite,
} from '../.pi/extensions/openpi-preapply-review'

const cwd = '/work/repo'

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
  const editCall = { toolName: 'edit', input: { path: 'a.ts', oldText: 'x\n', newText: 'y\n' } }

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
    const before = Array.from({ length: 40 }, (_, i) => `old-${i}`).join('\n')
    const after = Array.from({ length: 40 }, (_, i) => `new-${i}`).join('\n')

    const body = diffRegion(before, after, 10)

    expect(body.split('\n')).toHaveLength(11)
    expect(body.endsWith('preview truncated')).toBe(true)
  })
})

describe('previews', () => {
  it('describes an edit as the block it replaces', () => {
    const preview = previewForEdit(
      {
        path: 'src/App.tsx',
        oldText: 'const a = 1\nconst b = 2',
        newText: 'const a = 1\nconst b = 3',
      },
      cwd
    )

    expect(preview).not.toBeNull()
    expect(preview?.path).toBe('src/App.tsx')
    expect(preview?.summary).toBe('edit · -2 lines / +2 lines')
    expect(preview?.body).toBe('-const b = 2\n+const b = 3')
    expect(preview?.created).toBe(false)
  })

  it('marks a new file as a creation and an unchanged write as no change', () => {
    const created = previewForWrite({ path: 'docs/new.md', content: 'hello\n' }, cwd, () => null)
    expect(created?.created).toBe(true)
    expect(created?.summary).toBe('create · 1 line')
    expect(created?.body).toBe('+hello')

    const unchanged = previewForWrite(
      { path: 'docs/old.md', content: 'same\n' },
      cwd,
      () => 'same\n'
    )
    expect(unchanged?.summary).toBe('no change')
    expect(unchanged?.body).toBe('')
  })

  it('diffs a rewrite against the file on disk', () => {
    const preview = previewForWrite(
      { path: 'src/a.ts', content: 'keep\nnew\n' },
      cwd,
      () => 'keep\nold\n'
    )

    expect(preview?.summary).toBe('write · 2 lines → 2 lines')
    expect(preview?.body).toBe('-old\n+new')
    expect(preview?.created).toBe(false)
  })

  it('ignores tools and inputs it cannot preview', () => {
    expect(previewForToolCall('bash', { command: 'rm -rf /' }, cwd)).toBeNull()
    expect(previewForToolCall('edit', { path: 'a.ts' }, cwd)).toBeNull()
    expect(previewForToolCall('write', { content: 'x' }, cwd)).toBeNull()
  })

  it('tells the user what allow and deny do', () => {
    const preview = previewForWrite({ path: 'a.ts', content: 'x\n' }, cwd, () => 'y\n')
    const message = preview ? confirmMessage(preview) : ''

    expect(message).toContain('-y\n+x')
    expect(message).toContain('Deny blocks the write')
  })
})
