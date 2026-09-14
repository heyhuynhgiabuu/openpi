import { cleanup, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it } from 'vitest'

import { RunUsageBadge } from '../src/components/composer/Badges'
import type { RunUsage } from '../src/lib/runUsage'

const usage: RunUsage = {
  turns: 2,
  input: 1_000,
  output: 200,
  cacheRead: 0,
  cacheWrite: 0,
  total: 48_100,
  cost: 0.1432,
}

afterEach(cleanup)

describe('RunUsageBadge', () => {
  it('shows turns, tokens and cost while streaming', () => {
    const { container, getByText } = render(() => <RunUsageBadge usage={usage} streaming={true} />)

    expect(getByText('2t')).toBeTruthy()
    expect(getByText('48.1K tok')).toBeTruthy()
    expect(getByText('$0.143')).toBeTruthy()
    expect(
      container.querySelector('.composer-run-usage-badge')?.classList.contains('is-idle')
    ).toBe(false)
  })

  it('recedes once the run finished', () => {
    const { container } = render(() => <RunUsageBadge usage={usage} streaming={false} />)

    expect(
      container.querySelector('.composer-run-usage-badge')?.classList.contains('is-idle')
    ).toBe(true)
  })

  it('hides cost when the provider reported none', () => {
    const { container } = render(() => (
      <RunUsageBadge usage={{ ...usage, cost: 0 }} streaming={true} />
    ))

    expect(container.querySelector('.composer-run-usage-badge')?.textContent).not.toContain('$')
  })
})
