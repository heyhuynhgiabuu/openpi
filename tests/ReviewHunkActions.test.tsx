import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReviewHunkActions } from '../src/components/review/ReviewHunkActions'
import type { AgentReviewChange } from '../src/lib/ipc'

function change(): AgentReviewChange {
  return {
    id: 'change-1',
    path: 'note.txt',
    toolCallId: 'tool-1',
    toolName: 'edit',
    status: 'modified',
    createdAt: 1,
    diff: '',
    beforeContent: 'alpha\nbeta\n',
    afterContent: 'alpha\nBETA\n',
    totalAdded: 1,
    totalRemoved: 1,
    truncated: false,
    hunks: [
      { index: 0, beforeStart: 2, afterStart: 2, added: 1, removed: 1 },
      { index: 1, beforeStart: 6, afterStart: 6, added: 1, removed: 1 },
    ],
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ReviewHunkActions', () => {
  it('keeps the hunk the user picked', async () => {
    const onKeepHunk = vi.fn().mockResolvedValue(undefined)
    const { getByText, getAllByText } = render(() => (
      <ReviewHunkActions
        change={change()}
        onKeepHunk={onKeepHunk}
        onRevertHunk={vi.fn().mockResolvedValue(undefined)}
      />
    ))

    fireEvent.click(getByText('▼ 2 hunks'))
    fireEvent.click(getAllByText('Keep')[1] as HTMLElement)

    expect(onKeepHunk).toHaveBeenCalledWith(1)
    expect(await vi.waitFor(() => getByText('Kept hunk.'))).toBeTruthy()
  })

  it('reverts a hunk only after the confirmation', async () => {
    const onRevertHunk = vi.fn().mockResolvedValue(undefined)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { getAllByText } = render(() => (
      <ReviewHunkActions
        change={change()}
        onKeepHunk={vi.fn().mockResolvedValue(undefined)}
        onRevertHunk={onRevertHunk}
      />
    ))

    fireEvent.click(getAllByText('▼ 2 hunks')[0] as HTMLElement)
    fireEvent.click(getAllByText('Revert')[0] as HTMLElement)

    expect(confirmSpy).toHaveBeenCalled()
    expect(onRevertHunk).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(getAllByText('Revert')[0] as HTMLElement)

    expect(onRevertHunk).toHaveBeenCalledWith(0)
  })

  it('surfaces a failed hunk action next to the hunk', async () => {
    const { getAllByText, getByText } = render(() => (
      <ReviewHunkActions
        change={change()}
        onKeepHunk={vi.fn().mockRejectedValue(new Error('Refusing hunk review'))}
        onRevertHunk={vi.fn().mockResolvedValue(undefined)}
      />
    ))

    fireEvent.click(getAllByText('▼ 2 hunks')[0] as HTMLElement)
    fireEvent.click(getAllByText('Keep')[0] as HTMLElement)

    expect(await vi.waitFor(() => getByText('Failed: Refusing hunk review'))).toBeTruthy()
  })
})
