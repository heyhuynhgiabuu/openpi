import { render } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SubagentWidget } from '../src/components/SubagentWidget'
import type { TrackedTask } from '../src/lib/extensionTrackers'

function task(overrides: Partial<TrackedTask> = {}): TrackedTask {
  return {
    tempId: 'temp-1',
    taskId: 't1abc12',
    description: 'scan the repo',
    agentType: 'explore',
    status: 'running',
    startedAt: Date.now(),
    background: true,
    ...overrides,
  }
}

describe('SubagentWidget', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders active tasks with mode, agent, and task id', () => {
    const { container } = render(() => <SubagentWidget tasks={[task()]} />)
    const slot = (name: string): Element | null => container.querySelector(`[data-slot="${name}"]`)

    expect(container.querySelector('[data-component="subagent-widget"]')).toBeTruthy()
    expect(slot('subagent-count')?.textContent).toBe('1')
    expect(slot('subagent-item-agent')?.textContent).toBe('explore')
    expect(slot('subagent-item-id')?.textContent).toBe('t1abc12')
  })

  it('keeps completed and failed tasks out of the tray', () => {
    const { container } = render(() => (
      <SubagentWidget
        tasks={[task({ status: 'completed' }), task({ tempId: 'x', status: 'failed' })]}
      />
    ))

    expect(container.querySelector('[data-component="subagent-widget"]')).toBeNull()
  })

  it('ticks the elapsed time while a task runs instead of freezing it', () => {
    vi.setSystemTime(new Date('2026-09-16T12:00:00Z'))
    const { container } = render(() => <SubagentWidget tasks={[task({ startedAt: Date.now() })]} />)

    const elapsed = (): string | null | undefined =>
      container.querySelector('[data-slot="subagent-item-elapsed"]')?.textContent
    vi.advanceTimersByTime(1_000)
    const afterOneSecond = elapsed()
    expect(afterOneSecond).toBe('1.0s')

    vi.advanceTimersByTime(61_000)
    expect(elapsed()).not.toBe(afterOneSecond)
    expect(elapsed()).toBe('1m 2s')
  })
})
