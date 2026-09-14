import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { EditToolInput, WriteToolInput } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  approvedHunks,
  handleToolCall,
  isOpenPiHost,
  isPreApplyReviewEnabled,
} from '../.pi/extensions/openpi-preapply-review/index'
import {
  confirmMessage,
  diffRegion,
  previewForEdit,
  previewForToolCall,
  previewForWrite,
} from '../.pi/extensions/openpi-preapply-review/preview'

let cwd: string

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-preapply-'))
})

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true })
  delete process.env.OPENPI_PREAPPLY_REVIEW
  delete process.env.OPENPI_BRIDGE_APP
})

function writeFile(relPath: string, content: string): void {
  const full = path.join(cwd, relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

interface ContextOptions {
  confirmed?: boolean
  reviewAnswer?: string | undefined
}

/** Fake Pi context; the spies record what the gate asked for. */
function context(options: ContextOptions = {}) {
  const confirm = vi.fn(async (_title: string, _message: string) => options.confirmed ?? false)
  const input = vi.fn(async (_title: string, _placeholder?: string) => options.reviewAnswer)
  return { confirm, input, ctx: { cwd, ui: { confirm, input } } }
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

  it('asks with a text preview and blocks when the user denies', async () => {
    const { ctx, confirm, input } = context({ confirmed: false })

    const denied = await handleToolCall({ toolName: 'edit', input: editInput }, ctx)

    expect(denied?.block).toBe(true)
    expect(denied?.reason).toContain('denied')
    expect(confirm.mock.calls[0]?.[0]).toBe('Review before applying: a.ts')
    expect(confirm.mock.calls[0]?.[1]).toContain('-x\n+y')
    expect(input).not.toHaveBeenCalled()
  })

  it('stays out of the way when the user allows', async () => {
    const { ctx } = context({ confirmed: true })

    expect(await handleToolCall({ toolName: 'edit', input: editInput }, ctx)).toBeUndefined()
  })

  it('leaves tools it cannot preview alone', async () => {
    const { ctx, confirm } = context({ confirmed: false })

    const result = await handleToolCall({ toolName: 'bash', input: { command: 'rm -rf /' } }, ctx)

    expect(result).toBeUndefined()
    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('hunk review inside OpenPi', () => {
  const editInput = (): EditToolInput => ({
    path: 'src/App.tsx',
    edits: [
      { oldText: 'one\n', newText: 'ONE\n' },
      { oldText: 'two\n', newText: 'TWO\n' },
    ],
  })

  beforeEach(() => {
    process.env.OPENPI_BRIDGE_APP = 'openpi'
  })

  it('is detected from the bridge environment', () => {
    expect(isOpenPiHost({ OPENPI_BRIDGE_APP: 'openpi' })).toBe(true)
    expect(isOpenPiHost({})).toBe(false)
    expect(isOpenPiHost({ OPENPI_BRIDGE_APP: 'pi-tui' })).toBe(false)
  })

  it('sends every hunk as a review payload', async () => {
    const { ctx, confirm, input } = context({ reviewAnswer: '{"approved":[0,1]}' })

    await handleToolCall({ toolName: 'edit', input: editInput() }, ctx)

    expect(confirm).not.toHaveBeenCalled()
    const [title, placeholder] = input.mock.calls[0] ?? []
    expect(title).toBe('Review before applying: src/App.tsx')
    expect(placeholder?.startsWith('openpi-preapply-review:')).toBe(true)
    const payload: unknown = JSON.parse((placeholder ?? '').slice('openpi-preapply-review:'.length))
    expect(payload).toEqual({
      path: 'src/App.tsx',
      summary: 'edit · -2 lines / +2 lines · 2 hunks',
      hunks: [
        { diff: '-one\n+ONE', removed: 1, added: 1 },
        { diff: '-two\n+TWO', removed: 1, added: 1 },
      ],
    })
  })

  it('keeps only the approved hunks by rewriting the call input', async () => {
    const input = editInput()
    const { ctx } = context({ reviewAnswer: '{"approved":[1]}' })

    const result = await handleToolCall({ toolName: 'edit', input }, ctx)

    expect(result).toBeUndefined()
    expect(input.edits).toEqual([{ oldText: 'two\n', newText: 'TWO\n' }])
  })

  it('leaves the call untouched when every hunk is approved', async () => {
    const input = editInput()
    const { ctx } = context({ reviewAnswer: '{"approved":[0,1]}' })

    expect(await handleToolCall({ toolName: 'edit', input }, ctx)).toBeUndefined()
    expect(input.edits).toHaveLength(2)
  })

  it('blocks when nothing is approved or the dialog is cancelled', async () => {
    const none = context({ reviewAnswer: '{"approved":[]}' })
    const cancelled = context({ reviewAnswer: undefined })

    const deniedNone = await handleToolCall({ toolName: 'edit', input: editInput() }, none.ctx)
    const deniedCancel = await handleToolCall(
      { toolName: 'edit', input: editInput() },
      cancelled.ctx
    )

    expect(deniedNone?.block).toBe(true)
    expect(deniedCancel?.block).toBe(true)
    expect(deniedNone?.reason).toContain('denied')
  })

  it('reads approved indexes defensively', () => {
    expect(approvedHunks('{"approved":[1,0,1]}', 2)).toEqual([0, 1])
    expect(approvedHunks('{"approved":[2,-1,"x"]}', 2)).toEqual([])
    expect(approvedHunks('{}', 2)).toBeNull()
    expect(approvedHunks('not json', 2)).toBeNull()
    expect(approvedHunks(undefined, 2)).toBeNull()
  })

  it('still uses the text dialog for write', async () => {
    const { ctx, confirm, input } = context({ confirmed: true })
    writeFile('docs/new.md', 'old\n')

    const result = await handleToolCall(
      { toolName: 'write', input: { path: 'docs/new.md', content: 'new\n' } },
      ctx
    )

    expect(result).toBeUndefined()
    expect(input).not.toHaveBeenCalled()
    expect(confirm.mock.calls[0]?.[0]).toBe('Review before applying: docs/new.md')
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
