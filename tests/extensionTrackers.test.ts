import { describe, expect, it } from 'vitest'
import { assistantText } from '../electron/subagent/manager'
import { SubagentTracker, TaskTracker } from '../src/lib/extensionTrackers'

describe('assistantText', () => {
  it('joins text content and ignores non-text assistant parts', () => {
    expect(
      assistantText({
        content: [
          { type: 'thinking', thinking: 'hidden reasoning' },
          { type: 'text', text: 'first' },
          { type: 'toolCall', id: 't1', name: 'read', arguments: {} },
          { type: 'text', text: ' second' },
        ],
      })
    ).toBe('first second')
  })

  it('returns an empty string for malformed messages', () => {
    expect(assistantText({})).toBe('')
    expect(assistantText({ content: [{ type: 'text', text: 42 }] })).toBe('')
  })
})

describe('SubagentTracker', () => {
  it('updates background agents from OpenPi lifecycle events', () => {
    const tracker = new SubagentTracker()

    tracker.onToolStart('tool-1', 'Agent', {
      description: 'Scan codebase',
      subagent_type: 'explorer',
      run_in_background: true,
    })
    tracker.onToolEnd('tool-1', 'Agent', 'Agent ID: abc12345\nStatus: running', false)
    tracker.onSubagentUpdate({
      type: 'openpi_subagent_update',
      tool_call_id: 'tool-1',
      agent_id: 'abc12345',
      status: 'completed',
      description: 'Scan codebase',
      subagent_type: 'explorer',
      background: true,
      created_at: 1,
      started_at: 2,
      completed_at: 3,
      turns: 2,
      tool_calls: 5,
      activity: 'Completed',
      result: 'Repo scan complete',
    })

    expect(tracker.snapshot()).toEqual([
      expect.objectContaining({
        tempId: 'tool-1',
        agentId: 'abc12345',
        status: 'completed',
        turns: 2,
        toolCalls: 5,
        result: 'Repo scan complete',
      }),
    ])
  })

  it('tracks foreground agent with onToolStart/onToolEnd', () => {
    const tracker = new SubagentTracker()

    tracker.onToolStart('tool-2', 'Agent', {
      description: 'Fix bug',
      subagent_type: 'worker',
      run_in_background: false,
    })

    expect(tracker.snapshot()).toEqual([
      expect.objectContaining({
        tempId: 'tool-2',
        status: 'running',
        background: false,
      }),
    ])

    tracker.onToolEnd('tool-2', 'Agent', 'Found and fixed the bug.', false)

    expect(tracker.snapshot()).toEqual([
      expect.objectContaining({
        tempId: 'tool-2',
        status: 'completed',
        result: 'Found and fixed the bug.',
      }),
    ])
  })

  it('tracks failed agent on tool error', () => {
    const tracker = new SubagentTracker()

    tracker.onToolStart('tool-3', 'Agent', {
      description: 'Fail task',
      subagent_type: 'worker',
    })
    tracker.onToolEnd('tool-3', 'Agent', 'Something went wrong', true)

    expect(tracker.snapshot()).toEqual([
      expect.objectContaining({
        tempId: 'tool-3',
        status: 'failed',
        result: 'Something went wrong',
      }),
    ])
  })

  it('matches lifecycle updates by tool_call_id on running agent', () => {
    const tracker = new SubagentTracker()

    tracker.onToolStart('tool-4', 'Agent', {
      description: 'Long task',
      subagent_type: 'explorer',
      run_in_background: true,
    })
    // tool_end returns queued status
    tracker.onToolEnd('tool-4', 'Agent', 'Agent ID: def67890\nStatus: queued', false)

    // Lifecycle event with matching tool_call_id updates the existing record
    tracker.onSubagentUpdate({
      type: 'openpi_subagent_update',
      tool_call_id: 'tool-4',
      agent_id: 'def67890',
      status: 'running',
      description: 'Long task',
      subagent_type: 'explorer',
      background: true,
      created_at: 1,
      started_at: 2,
      turns: 0,
      tool_calls: 0,
      activity: 'Starting',
    })

    expect(tracker.snapshot()).toEqual([
      expect.objectContaining({
        tempId: 'tool-4',
        agentId: 'def67890',
        status: 'running',
      }),
    ])

    // Second lifecycle event with only agent_id should still match
    tracker.onSubagentUpdate({
      type: 'openpi_subagent_update',
      agent_id: 'def67890',
      status: 'completed',
      description: 'Long task',
      subagent_type: 'explorer',
      background: true,
      created_at: 1,
      started_at: 2,
      completed_at: 3,
      turns: 3,
      tool_calls: 7,
      activity: 'Completed',
      result: 'Result data',
    })

    expect(tracker.snapshot()).toEqual([
      expect.objectContaining({
        status: 'completed',
        turns: 3,
        toolCalls: 7,
        result: 'Result data',
      }),
    ])
  })

  it('creates a new entry when lifecycle event arrives before tool_start', () => {
    const tracker = new SubagentTracker()

    // Lifecycle event arrives from sidecar before the tool_end has been processed
    tracker.onSubagentUpdate({
      type: 'openpi_subagent_update',
      agent_id: 'new-agent',
      status: 'completed',
      description: 'Early bird',
      subagent_type: 'worker',
      background: true,
      created_at: 1,
      started_at: 2,
      completed_at: 3,
      turns: 1,
      tool_calls: 3,
    })

    expect(tracker.snapshot()).toEqual([
      expect.objectContaining({
        agentId: 'new-agent',
        status: 'completed',
        turns: 1,
        toolCalls: 3,
      }),
    ])
  })

  it('updates status when get_subagent_result parses agent ID and status', () => {
    const tracker = new SubagentTracker()

    tracker.onToolStart('tool-5', 'Agent', {
      description: 'Bg task',
      subagent_type: 'worker',
      run_in_background: true,
    })
    tracker.onToolEnd('tool-5', 'Agent', 'Agent ID: ghi11111\nStatus: queued', false)

    // Lifecycle event runs it
    tracker.onSubagentUpdate({
      type: 'openpi_subagent_update',
      agent_id: 'ghi11111',
      status: 'completed',
      description: 'Bg task',
      subagent_type: 'worker',
      background: true,
      created_at: 1,
      started_at: 2,
      completed_at: 3,
      turns: 4,
      tool_calls: 10,
      result: 'Output',
    })

    // get_subagent_result tool end should still update the record
    tracker.onToolEnd(
      'tool-result-call',
      'get_subagent_result',
      'Agent ID: ghi11111\nStatus: completed\n\nOutput\n\nDetails: {...}',
      false
    )

    expect(tracker.snapshot()).toEqual([
      expect.objectContaining({
        agentId: 'ghi11111',
        status: 'completed',
      }),
    ])
  })

  it('clearFinished keeps background agents, removes only completed/failed foreground', () => {
    const tracker = new SubagentTracker()

    // Background: running
    tracker.onToolStart('r1', 'Agent', {
      description: 'Running',
      subagent_type: 'worker',
      run_in_background: true,
    })
    // Background: completed via onSubagentUpdate
    tracker.onToolStart('c1', 'Agent', {
      description: 'Done',
      subagent_type: 'worker',
      run_in_background: true,
    })
    tracker.onSubagentUpdate({
      type: 'openpi_subagent_update',
      tool_call_id: 'c1',
      agent_id: 'c1',
      status: 'completed',
      description: 'Done',
      subagent_type: 'worker',
      background: true,
      created_at: 1,
      started_at: 2,
      completed_at: 3,
      turns: 1,
      tool_calls: 2,
    })
    // Background: queued (onToolEnd no longer sets status for bg agents; stays running from start)
    tracker.onToolStart('q1', 'Agent', {
      description: 'Queued',
      subagent_type: 'worker',
      run_in_background: true,
    })
    // Foreground: completed — should be cleaned up
    tracker.onToolStart('fore', 'Agent', {
      description: 'Foreground complete',
      subagent_type: 'worker',
    })
    tracker.onToolEnd('fore', 'Agent', 'Result text', false)

    expect(tracker.snapshot()).toHaveLength(4)

    tracker.clearFinished()

    // Background agents survive; foreground completed is removed
    expect(tracker.snapshot()).toHaveLength(3)
    expect(
      tracker
        .snapshot()
        .map((a) => a.tempId)
        .sort()
    ).toEqual(['c1', 'q1', 'r1'])
  })

  it('does not revert background status when onToolEnd fires after onSubagentUpdate completed', () => {
    // This tests the race condition: onToolEnd parses 'Status: queued' from the
    // spawn result and must not overwrite the correct status from onSubagentUpdate.
    const tracker = new SubagentTracker()

    // tool_start creates the entry
    tracker.onToolStart('race-1', 'Agent', {
      description: 'Fast subagent',
      subagent_type: 'worker',
      run_in_background: true,
    })

    // Subagent completes before tool_end arrives
    tracker.onSubagentUpdate({
      type: 'openpi_subagent_update',
      tool_call_id: 'race-1',
      agent_id: 'abc999',
      status: 'completed',
      description: 'Fast subagent',
      subagent_type: 'worker',
      background: true,
      created_at: 1,
      started_at: 2,
      completed_at: 3,
      turns: 2,
      tool_calls: 4,
      result: 'Race won!',
    })

    // tool_end arrives late with stale spawn status
    tracker.onToolEnd('race-1', 'Agent', 'Agent ID: abc999\nStatus: queued', false)

    // Status must remain 'completed', not get reverted to 'queued'
    expect(tracker.snapshot()).toEqual([
      expect.objectContaining({
        agentId: 'abc999',
        status: 'completed',
        turns: 2,
        toolCalls: 4,
        result: 'Race won!',
      }),
    ])
  })
})

describe('TaskTracker', () => {
  function makeTracker() {
    return new TaskTracker()
  }

  it('adds a task on TaskCreate tool start', () => {
    const tracker = makeTracker()
    const changed = tracker.onToolStart('call-1', 'TaskCreate', {
      subject: 'Write tests',
      activeForm: 'Writing tests',
    })
    expect(changed).toBe(true)
    const tasks = tracker.snapshot()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].subject).toBe('Write tests')
    expect(tasks[0].status).toBe('pending')
    expect(tasks[0].activeForm).toBe('Writing tests')
    expect(tasks[0].id).toBe('pending-call-1')
  })

  it('falls back to "(task)" when subject is missing', () => {
    const tracker = makeTracker()
    tracker.onToolStart('call-1', 'TaskCreate', {})
    expect(tracker.snapshot()[0].subject).toBe('(task)')
  })

  it('renames the temp id to the canonical id parsed from the result text', () => {
    const tracker = makeTracker()
    tracker.onToolStart('call-1', 'TaskCreate', { subject: 'Write tests' })
    expect(tracker.snapshot()[0].id).toBe('pending-call-1')
    const changed = tracker.onToolEnd('call-1', 'TaskCreate', 'Task #7 created successfully.')
    expect(changed).toBe(true)
    const tasks = tracker.snapshot()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe('7')
  })

  it('handles the lowercase "task #N" result format', () => {
    const tracker = makeTracker()
    tracker.onToolStart('call-1', 'TaskCreate', { subject: 'X' })
    tracker.onToolEnd('call-1', 'TaskCreate', 'task #12 created')
    expect(tracker.snapshot()[0].id).toBe('12')
  })

  it('keeps the temp id when the result text has no task id', () => {
    const tracker = makeTracker()
    tracker.onToolStart('call-1', 'TaskCreate', { subject: 'X' })
    tracker.onToolEnd('call-1', 'TaskCreate', 'Something went wrong')
    expect(tracker.snapshot()).toHaveLength(1)
    expect(tracker.snapshot()[0].id).toBe('pending-call-1')
  })

  it('returns false from onToolEnd when the toolCallId is unknown', () => {
    const tracker = makeTracker()
    const changed = tracker.onToolEnd('unknown', 'TaskCreate', 'Task #1 created')
    expect(changed).toBe(false)
  })

  it('returns false from onToolEnd for non-TaskCreate tools', () => {
    const tracker = makeTracker()
    const changed = tracker.onToolEnd('call-1', 'TaskUpdate', 'Task #1 updated')
    expect(changed).toBe(false)
  })

  it('updates the status of an existing task via TaskUpdate', () => {
    const tracker = makeTracker()
    tracker.onToolStart('call-1', 'TaskCreate', { subject: 'X' })
    tracker.onToolEnd('call-1', 'TaskCreate', 'Task #1 created')
    const changed = tracker.onToolStart('call-2', 'TaskUpdate', {
      taskId: '1',
      status: 'in_progress',
    })
    expect(changed).toBe(true)
    expect(tracker.snapshot()[0].status).toBe('in_progress')
  })

  it('removes a task when TaskUpdate sets status to deleted', () => {
    const tracker = makeTracker()
    tracker.onToolStart('call-1', 'TaskCreate', { subject: 'X' })
    tracker.onToolEnd('call-1', 'TaskCreate', 'Task #1 created')
    tracker.onToolStart('call-2', 'TaskUpdate', { taskId: '1', status: 'deleted' })
    expect(tracker.snapshot()).toHaveLength(0)
  })

  it('returns false from TaskUpdate when the task id is unknown', () => {
    const tracker = makeTracker()
    const changed = tracker.onToolStart('call-1', 'TaskUpdate', {
      taskId: '999',
      status: 'completed',
    })
    expect(changed).toBe(false)
    expect(tracker.snapshot()).toHaveLength(0)
  })

  it('merges addBlockedBy into the existing blockedBy list (deduped)', () => {
    const tracker = makeTracker()
    tracker.onToolStart('c1', 'TaskCreate', { subject: 'A' })
    tracker.onToolStart('c2', 'TaskCreate', { subject: 'B' })
    tracker.onToolEnd('c1', 'TaskCreate', 'Task #1 created')
    tracker.onToolEnd('c2', 'TaskCreate', 'Task #2 created')
    tracker.onToolStart('c3', 'TaskUpdate', { taskId: '2', status: 'pending', addBlockedBy: ['1'] })
    tracker.onToolStart('c4', 'TaskUpdate', {
      taskId: '2',
      status: 'pending',
      addBlockedBy: ['1', '2'],
    })
    const task = tracker.snapshot().find((t) => t.id === '2')
    expect(task?.blockedBy).toEqual(['1', '2'])
  })

  it('tracks multiple independent tasks', () => {
    const tracker = makeTracker()
    tracker.onToolStart('c1', 'TaskCreate', { subject: 'A' })
    tracker.onToolStart('c2', 'TaskCreate', { subject: 'B' })
    tracker.onToolStart('c3', 'TaskCreate', { subject: 'C' })
    tracker.onToolEnd('c1', 'TaskCreate', 'Task #10 created')
    tracker.onToolEnd('c2', 'TaskCreate', 'Task #11 created')
    tracker.onToolEnd('c3', 'TaskCreate', 'Task #12 created')
    tracker.onToolStart('c4', 'TaskUpdate', { taskId: '11', status: 'completed' })
    const tasks = tracker.snapshot()
    expect(tasks.map((t) => t.subject)).toEqual(['A', 'B', 'C'])
    expect(tasks.find((t) => t.id === '11')?.status).toBe('completed')
  })

  it('clear() empties all tasks and pending creates', () => {
    const tracker = makeTracker()
    tracker.onToolStart('c1', 'TaskCreate', { subject: 'A' })
    tracker.onToolStart('c2', 'TaskCreate', { subject: 'B' })
    tracker.clear()
    expect(tracker.snapshot()).toHaveLength(0)
    // After clear, the same pending create should produce a new temp id
    tracker.onToolStart('c3', 'TaskCreate', { subject: 'C' })
    expect(tracker.snapshot()[0].id).toBe('pending-c3')
  })
})
