import { fireEvent, render } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'

import { TrajectoryLedger } from '../src/components/map/TrajectoryLedger'
import type { TrajectoryRow } from '../src/lib/ipc'

function row(overrides: Partial<TrajectoryRow>): TrajectoryRow {
  return {
    entryId: 'e1',
    parentId: null,
    type: 'message',
    role: 'assistant',
    timestamp: '2026-09-15T10:00:05.000Z',
    preview: 'answer preview',
    freedTokens: null,
    navigable: true,
    model: null,
    provider: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    durationMs: 0,
    cost: 0,
    ...overrides,
  }
}

describe('TrajectoryLedger', () => {
  it('renders rows with kind, preview, duration, tokens, and cost', () => {
    const { container, getByText } = render(() => (
      <TrajectoryLedger
        rows={[
          row({
            totalTokens: 1590,
            durationMs: 4200,
            cost: 0.0042,
            model: 'test-model',
          }),
          row({
            entryId: 'c1',
            type: 'compaction',
            role: null,
            navigable: false,
            freedTokens: 90000,
            preview: 'summarized history',
          }),
        ]}
        query=""
        isEntryLoaded={() => true}
        onNavigate={() => {}}
        onNotice={() => {}}
      />
    ))
    expect(getByText('1,590 tok')).toBeTruthy()
    expect(getByText('4.2s')).toBeTruthy()
    expect(getByText('$0.0042')).toBeTruthy()
    expect(getByText('freed 90,000')).toBeTruthy()
    expect(container.querySelectorAll('.trajectory-row').length).toBe(2)
  })

  it('filters rows by the query across preview and kind', () => {
    const { container, getByText } = render(() => (
      <TrajectoryLedger
        rows={[
          row({ entryId: 'e1', preview: 'about testing' }),
          row({ entryId: 'e2', preview: 'about deployment' }),
        ]}
        query="testing"
        isEntryLoaded={() => true}
        onNavigate={() => {}}
        onNotice={() => {}}
      />
    ))
    expect(container.querySelectorAll('.trajectory-row').length).toBe(1)
    expect(getByText('about testing')).toBeTruthy()
  })

  it('navigates only loaded, navigable rows and notices otherwise', () => {
    const onNavigate = vi.fn()
    const onNotice = vi.fn()
    const { getByText } = render(() => (
      <TrajectoryLedger
        rows={[
          row({ entryId: 'loaded', preview: 'loaded row' }),
          row({ entryId: 'unloaded', preview: 'unloaded row' }),
          row({
            entryId: 'meta',
            type: 'model_change',
            role: null,
            navigable: false,
            preview: 'model x',
          }),
        ]}
        query=""
        isEntryLoaded={(id) => id === 'loaded'}
        onNavigate={onNavigate}
        onNotice={onNotice}
      />
    ))
    fireEvent.click(getByText('loaded row').closest('button') as HTMLButtonElement)
    expect(onNavigate).toHaveBeenCalledWith('loaded')

    fireEvent.click(getByText('unloaded row').closest('button') as HTMLButtonElement)
    expect(onNotice).toHaveBeenCalledWith(
      'Not loaded in the conversation yet — scroll back in the chat to load older history.'
    )

    fireEvent.click(getByText('model x').closest('button') as HTMLButtonElement)
    expect(onNotice).toHaveBeenCalledWith('This entry has no message in the conversation.')
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })
})
