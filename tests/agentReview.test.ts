import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captureAgentReviewEvent,
  clearAgentReviewChanges,
  keepAgentReviewChange,
  keepAgentReviewHunk,
  revertAgentReviewChange,
  revertAgentReviewChanges,
  revertAgentReviewHunk,
} from '../electron/services/agentReview'
import { getAgentReviewSummary } from '../electron/services/agentReviewStore'

let tmp: string | null = null
let outside: string[] = []

/** A directory outside the workspace, cleaned up with it. */
function makeOutside() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-outside-'))
  outside.push(dir)
  return dir
}

function makeWorkspace() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-review-'))
  clearAgentReviewChanges(tmp)
  return tmp
}

afterEach(() => {
  for (const dir of outside) fs.rmSync(dir, { recursive: true, force: true })
  outside = []
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  clearAgentReviewChanges()
  tmp = null
})

describe('agent review snapshots', () => {
  it('captures a modified file and reverts to the pre-tool content', () => {
    const cwd = makeWorkspace()
    const file = path.join(cwd, 'note.txt')
    fs.writeFileSync(file, 'before\n', 'utf-8')

    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'edit',
      args: { path: 'note.txt' },
    })
    fs.writeFileSync(file, 'after\n', 'utf-8')
    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'edit',
    })

    const [change] = getAgentReviewSummary(cwd).changes
    expect(change?.status).toBe('modified')
    expect(change?.diff).toContain('-before')
    expect(change?.diff).toContain('+after')

    revertAgentReviewChange(change.id)
    expect(fs.readFileSync(file, 'utf-8')).toBe('before\n')
    expect(getAgentReviewSummary(cwd).changes).toHaveLength(0)
  })

  it('ignores a file that became a symlink between the two events', () => {
    const cwd = makeWorkspace()
    const file = path.join(cwd, 'note.txt')
    const secret = path.join(makeOutside(), 'secret.txt')
    fs.writeFileSync(file, 'before\n', 'utf-8')
    fs.writeFileSync(secret, 'OUTSIDE\n', 'utf-8')

    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'write',
      args: { path: 'note.txt' },
    })
    // Between the events the file is replaced by a symlink out of the workspace.
    fs.rmSync(file)
    fs.symlinkSync(secret, file)
    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'write',
    })

    expect(getAgentReviewSummary(cwd).changes).toHaveLength(0)
  })

  it('captures created files and keep removes the review item only', () => {
    const cwd = makeWorkspace()
    const file = path.join(cwd, 'created.txt')

    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_start',
      toolCallId: 'tool-2',
      toolName: 'write',
      args: { path: 'created.txt' },
    })
    fs.writeFileSync(file, 'new\n', 'utf-8')
    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_end',
      toolCallId: 'tool-2',
      toolName: 'write',
    })

    const [change] = getAgentReviewSummary(cwd).changes
    expect(change?.status).toBe('created')
    keepAgentReviewChange(change.id)
    expect(fs.existsSync(file)).toBe(true)
    expect(getAgentReviewSummary(cwd).changes).toHaveLength(0)
  })

  it('coalesces repeated edits to the same file into one baseline-to-latest review item', () => {
    const cwd = makeWorkspace()
    const file = path.join(cwd, 'repeat.txt')
    fs.writeFileSync(file, 'hello\n', 'utf-8')

    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_start',
      toolCallId: 'tool-repeat-1',
      toolName: 'edit',
      args: { path: 'repeat.txt' },
    })
    fs.writeFileSync(file, 'hi\n', 'utf-8')
    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_end',
      toolCallId: 'tool-repeat-1',
      toolName: 'edit',
    })

    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_start',
      toolCallId: 'tool-repeat-2',
      toolName: 'edit',
      args: { path: 'repeat.txt' },
    })
    fs.writeFileSync(file, 'hi123456\n', 'utf-8')
    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_end',
      toolCallId: 'tool-repeat-2',
      toolName: 'edit',
    })

    const changes = getAgentReviewSummary(cwd).changes
    expect(changes).toHaveLength(1)
    expect(changes[0].beforeContent).toBe('hello\n')
    expect(changes[0].afterContent).toBe('hi123456\n')

    revertAgentReviewChange(changes[0].id)
    expect(fs.readFileSync(file, 'utf-8')).toBe('hello\n')
    expect(getAgentReviewSummary(cwd).changes).toHaveLength(0)
  })

  it('removes a review item when repeated edits return the file to baseline', () => {
    const cwd = makeWorkspace()
    const file = path.join(cwd, 'baseline.txt')
    fs.writeFileSync(file, 'original\n', 'utf-8')

    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_start',
      toolCallId: 'tool-baseline-1',
      toolName: 'edit',
      args: { path: 'baseline.txt' },
    })
    fs.writeFileSync(file, 'changed\n', 'utf-8')
    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_end',
      toolCallId: 'tool-baseline-1',
      toolName: 'edit',
    })

    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_start',
      toolCallId: 'tool-baseline-2',
      toolName: 'edit',
      args: { path: 'baseline.txt' },
    })
    fs.writeFileSync(file, 'original\n', 'utf-8')
    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_end',
      toolCallId: 'tool-baseline-2',
      toolName: 'edit',
    })

    expect(getAgentReviewSummary(cwd).changes).toHaveLength(0)
  })

  it('reverts all review items after validating every current file', () => {
    const cwd = makeWorkspace()
    const first = path.join(cwd, 'first.txt')
    const second = path.join(cwd, 'second.txt')
    fs.writeFileSync(first, 'a\n', 'utf-8')
    fs.writeFileSync(second, 'b\n', 'utf-8')

    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_start',
      toolCallId: 'tool-all-1',
      toolName: 'edit',
      args: { path: 'first.txt' },
    })
    fs.writeFileSync(first, 'aa\n', 'utf-8')
    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_end',
      toolCallId: 'tool-all-1',
      toolName: 'edit',
    })

    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_start',
      toolCallId: 'tool-all-2',
      toolName: 'edit',
      args: { path: 'second.txt' },
    })
    fs.writeFileSync(second, 'bb\n', 'utf-8')
    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_end',
      toolCallId: 'tool-all-2',
      toolName: 'edit',
    })

    expect(getAgentReviewSummary(cwd).changes).toHaveLength(2)
    revertAgentReviewChanges(cwd)
    expect(fs.readFileSync(first, 'utf-8')).toBe('a\n')
    expect(fs.readFileSync(second, 'utf-8')).toBe('b\n')
    expect(getAgentReviewSummary(cwd).changes).toHaveLength(0)
  })

  it('refuses to revert if the file changed after the review snapshot', () => {
    const cwd = makeWorkspace()
    const file = path.join(cwd, 'race.txt')
    fs.writeFileSync(file, 'one\n', 'utf-8')

    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_start',
      toolCallId: 'tool-3',
      toolName: 'edit',
      args: { path: 'race.txt' },
    })
    fs.writeFileSync(file, 'two\n', 'utf-8')
    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_end',
      toolCallId: 'tool-3',
      toolName: 'edit',
    })

    const [change] = getAgentReviewSummary(cwd).changes
    fs.writeFileSync(file, 'three\n', 'utf-8')
    expect(() => revertAgentReviewChange(change.id)).toThrow(/changed since review/)
    expect(fs.readFileSync(file, 'utf-8')).toBe('three\n')
  })
})

describe('agent review hunk operations', () => {
  const baseline = 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\n'
  const edited = 'alpha\nBETA\ngamma\ndelta\nepsilon\nZETA\neta\n'
  /** `edited` with the second region reverted back to its baseline lines. */
  const secondRegionReverted = 'alpha\nBETA\ngamma\ndelta\nepsilon\nzeta\neta\n'

  function captureEditedFile() {
    const cwd = makeWorkspace()
    const file = path.join(cwd, 'note.txt')
    fs.writeFileSync(file, baseline, 'utf-8')
    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_start',
      toolCallId: 'tool-hunk',
      toolName: 'edit',
      args: { path: 'note.txt' },
    })
    fs.writeFileSync(file, edited, 'utf-8')
    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_end',
      toolCallId: 'tool-hunk',
      toolName: 'edit',
    })
    const change = getAgentReviewSummary(cwd).changes[0]
    if (!change) throw new Error('expected a captured change')
    return { file, change }
  }

  it('exposes one hunk per changed region', () => {
    const { change } = captureEditedFile()

    expect(change.hunks.map((hunk) => [hunk.beforeStart, hunk.added, hunk.removed])).toEqual([
      [2, 1, 1],
      [6, 1, 1],
    ])
  })

  it('keeping a hunk accepts one region and leaves the file untouched', () => {
    const { file, change } = captureEditedFile()

    const [remaining] = keepAgentReviewHunk(change.id, 0).changes

    expect(fs.readFileSync(file, 'utf-8')).toBe(edited)
    expect(remaining?.hunks).toHaveLength(1)
    expect(remaining?.hunks[0]?.beforeStart).toBe(6)
    expect(remaining?.totalAdded).toBe(1)
    expect(remaining?.totalRemoved).toBe(1)
  })

  it('reverting a hunk restores only that region on disk', () => {
    const { file, change } = captureEditedFile()

    const [remaining] = revertAgentReviewHunk(change.id, 1).changes

    expect(fs.readFileSync(file, 'utf-8')).toBe(secondRegionReverted)
    expect(remaining?.hunks).toHaveLength(1)
    expect(remaining?.hunks[0]?.beforeStart).toBe(2)
  })

  it('drops the review item once every hunk is resolved', () => {
    const { file, change } = captureEditedFile()
    keepAgentReviewHunk(change.id, 0)

    const summary = revertAgentReviewHunk(change.id, 0)

    expect(summary.changes).toHaveLength(0)
    expect(fs.readFileSync(file, 'utf-8')).toBe(secondRegionReverted)
  })

  it('keeps created files whole-file and refuses their hunk review', () => {
    const cwd = makeWorkspace()
    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_start',
      toolCallId: 'tool-new',
      toolName: 'write',
      args: { path: 'created.txt' },
    })
    fs.writeFileSync(path.join(cwd, 'created.txt'), 'hello\n', 'utf-8')
    captureAgentReviewEvent(cwd, {
      type: 'tool_execution_end',
      toolCallId: 'tool-new',
      toolName: 'write',
    })
    const change = getAgentReviewSummary(cwd).changes[0]
    if (!change) throw new Error('expected a captured change')

    expect(change.hunks).toEqual([])
    expect(() => keepAgentReviewHunk(change.id, 0)).toThrow(/whole-file/)
  })

  it('refuses to revert a hunk when the file changed after the snapshot', () => {
    const { file, change } = captureEditedFile()
    fs.writeFileSync(file, 'externally changed\n', 'utf-8')

    expect(() => revertAgentReviewHunk(change.id, 0)).toThrow(/changed since review/)
  })
})
