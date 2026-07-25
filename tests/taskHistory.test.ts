import { describe, expect, it } from 'vitest'
import { resolveTaskStatusFromHistory } from '../src/lib/taskHistory'

describe('task history status resolver', () => {
  it('maps done history to done status', () => {
    expect(
      resolveTaskStatusFromHistory([{ id: 'mr09tr2f-44bf', status: 'done' }], 'mr09tr2f-44bf')
    ).toBe('done')
  })

  it('maps running history to running status', () => {
    expect(
      resolveTaskStatusFromHistory([{ id: 'mr09tr2f-44bf', status: 'running' }], 'mr09tr2f-44bf')
    ).toBe('running')
  })

  it('maps terminal error-like history statuses to error', () => {
    for (const status of ['cancelled', 'aborted', 'failed', 'timeout']) {
      expect(resolveTaskStatusFromHistory([{ id: 'task-1', status }], 'task-1')).toBe('error')
    }
  })
})
