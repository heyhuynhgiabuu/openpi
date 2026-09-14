import { describe, expect, it } from 'vitest'
import type { SlashCommandItem } from '../src/lib/ipc'
import {
  formatTaskDurationMs,
  isBackgroundHandoff,
  isTaskForeground,
  isValidPiTaskId,
  parseTaskDetails,
  taskCancelCommand,
} from '../src/lib/taskToolHelpers'

describe('taskCancelCommand', () => {
  const task: SlashCommandItem = {
    name: 'task',
    description: 'Task control',
    source: 'extension',
  }

  it('builds the pi-task control command when the extension registers it', () => {
    expect(taskCancelCommand('m1abc-x1y2', [task])).toBe('/task cancel m1abc-x1y2')
  })

  it('returns null otherwise, so an unknown slash text never reaches the model', () => {
    expect(taskCancelCommand('m1abc-x1y2', [])).toBeNull()
    expect(
      taskCancelCommand('m1abc-x1y2', [{ name: 'model', description: '', source: 'builtin' }])
    ).toBeNull()
  })
})

describe('taskToolHelpers', () => {
  it('foreground when background is false', () => {
    expect(isTaskForeground({ background: false })).toBe(true)
    expect(isTaskForeground({})).toBe(false)
  })

  it('detects background handoff receipt', () => {
    const details = parseTaskDetails({ agent_type: 'scout' }, { background: true })
    expect(isBackgroundHandoff(details, 'Started task abc with scout.\nDo not poll.', false)).toBe(
      true
    )
  })

  it('foreground done is not handoff', () => {
    const details = parseTaskDetails(
      { background: false },
      { phase: 'done', tool_uses: 3, duration_ms: 4500 }
    )
    expect(isBackgroundHandoff(details, 'Summary text', false)).toBe(false)
  })

  it('formatTaskDurationMs matches pi-task', () => {
    expect(formatTaskDurationMs(4500)).toBe('4.5s')
    expect(formatTaskDurationMs(65_000)).toBe('1m 5s')
  })

  it('rejects full and partial UUIDs as task_id', () => {
    expect(isValidPiTaskId('e2086af5-058e-47be-a2f5-1e4f7145e07f')).toBe(false)
    expect(isValidPiTaskId('8963391-fc3e-4c96-be9c-7db0eaabebf')).toBe(false)
    expect(isValidPiTaskId('c458ed71-422a-4897-b078-151048a363f6')).toBe(false)
    expect(isValidPiTaskId('m1lxyz-a1b2')).toBe(true)
  })
})
