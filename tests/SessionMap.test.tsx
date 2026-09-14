import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionMap } from '../src/components/map/SessionMap'
import type { SessionTreeResponse } from '../src/lib/ipc'

const tree: SessionTreeResponse = {
  sessionPath: '/sessions/example.jsonl',
  activeLeafId: 'leaf-2',
  forkPoints: [{ entryId: 'root', childLeaves: ['leaf-1', 'leaf-2'], branchCount: 2 }],
  branches: [
    {
      leafId: 'leaf-1',
      nodes: [
        {
          id: 'root',
          parentId: null,
          type: 'message',
          timestamp: '2026-09-14T00:00:00.000Z',
          role: 'user',
          contentPreview: 'first prompt',
        },
      ],
    },
    {
      leafId: 'leaf-2',
      nodes: [
        {
          id: 'root',
          parentId: null,
          type: 'message',
          timestamp: '2026-09-14T00:00:00.000Z',
          role: 'user',
          contentPreview: 'first prompt',
        },
        {
          id: 'compact-1',
          parentId: 'root',
          type: 'compaction',
          timestamp: '2026-09-14T00:01:00.000Z',
          tokensBefore: 272_792,
          compactionReason: 'threshold',
        },
        {
          id: 'leaf-2',
          parentId: 'compact-1',
          type: 'message',
          timestamp: '2026-09-14T00:02:00.000Z',
          role: 'assistant',
          contentPreview: 'second reply',
        },
      ],
    },
  ],
}

function stubTree(payload: SessionTreeResponse | Error) {
  const getSessionTree = vi.fn(() =>
    payload instanceof Error ? Promise.reject(payload) : Promise.resolve(payload)
  )
  vi.stubGlobal('openpi', { getSessionTree })
  return getSessionTree
}

/** The stub installed by beforeEach, for the one test that asserts on it. */
function getStub() {
  return vi.mocked(window.openpi.getSessionTree)
}

function renderMap(
  options: {
    onClose?: () => void
    loaded?: string[]
    onBranchFrom?: (id: string) => Promise<void>
    treeVersion?: () => number
  } = {}
) {
  const onNavigate = vi.fn()
  const onBranchFrom = vi.fn(options.onBranchFrom ?? (async () => {}))
  const view = render(() => (
    <SessionMap
      sessionPath="/sessions/example.jsonl"
      leafId={null}
      treeVersion={options.treeVersion?.() ?? 0}
      onClose={options.onClose ?? (() => {})}
      isEntryLoaded={(entryId) => (options.loaded ?? []).includes(entryId)}
      onNavigate={onNavigate}
      onBranchFrom={onBranchFrom}
    />
  ))
  return { ...view, onNavigate, onBranchFrom }
}

// Every test renders the same tree; only the empty and failed loads differ.
beforeEach(() => {
  stubTree(tree)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function cursorIndex(container: HTMLElement): string | null | undefined {
  return container
    .querySelector('.session-map-node-row.is-cursor [data-map-idx]')
    ?.getAttribute('data-map-idx')
}

describe('SessionMap', () => {
  it('renders every branch, marking the active one', async () => {
    const getSessionTree = getStub()
    const { findByText, getByText } = renderMap()

    expect(await findByText('2 branches · 1 fork')).toBeTruthy()
    expect(getSessionTree).toHaveBeenCalledWith('/sessions/example.jsonl', undefined)
    expect(getByText('Branch 1')).toBeTruthy()
    expect(getByText('Branch 2')).toBeTruthy()
    expect(getByText('current')).toBeTruthy()
    expect(getByText('1 entry')).toBeTruthy()
    expect(getByText('3 entries')).toBeTruthy()
  })

  it('labels nodes by type and shows their detail line', async () => {
    const { findByText, getAllByText, getByText } = renderMap()

    await findByText('2 branches · 1 fork')
    expect(getAllByText('You').length).toBe(2)
    expect(getByText('Assistant')).toBeTruthy()
    expect(getByText('Compaction')).toBeTruthy()
    expect(getByText('272,792 tokens before')).toBeTruthy()
    expect(getByText('second reply')).toBeTruthy()
  })

  it('closes on Escape and on the close button', async () => {
    const onClose = vi.fn()
    const { findByText, getByLabelText, getByRole } = renderMap({ onClose })

    await findByText('2 branches · 1 fork')
    fireEvent.keyDown(getByRole('dialog'), { key: 'a' })
    fireEvent.keyDown(getByRole('dialog'), { key: 'Escape' })
    fireEvent.click(getByLabelText('Close session map'))

    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('moves the cursor with the arrow keys and starts on the active leaf', async () => {
    const { findByText, getByRole, container } = renderMap()

    await findByText('2 branches · 1 fork')
    const cursorIdx = () => cursorIndex(container)
    // Active leaf is the last node of branch 2 (index 3 of 4).
    expect(cursorIdx()).toBe('3')

    const dialog = getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'ArrowUp' })
    expect(cursorIdx()).toBe('2')
    fireEvent.keyDown(dialog, { key: 'Home' })
    expect(cursorIdx()).toBe('0')
    fireEvent.keyDown(dialog, { key: 'ArrowUp' })
    expect(cursorIdx()).toBe('0')
    fireEvent.keyDown(dialog, { key: 'End' })
    expect(cursorIdx()).toBe('3')
    fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    expect(cursorIdx()).toBe('3')
  })

  it('jumps to the selected entry and closes when the conversation has it', async () => {
    const onClose = vi.fn()
    const { findByText, getByRole, onNavigate } = renderMap({ onClose, loaded: ['leaf-2'] })

    await findByText('2 branches · 1 fork')
    fireEvent.keyDown(getByRole('dialog'), { key: 'Enter' })

    expect(onNavigate).toHaveBeenCalledWith('leaf-2')
    expect(onClose).toHaveBeenCalled()
  })

  it('explains instead of jumping when the entry is not loaded or not a message', async () => {
    const { findByText, getByText, getByRole, onNavigate } = renderMap({ loaded: [] })

    await findByText('2 branches · 1 fork')
    fireEvent.keyDown(getByRole('dialog'), { key: 'Enter' })
    expect(onNavigate).not.toHaveBeenCalled()
    expect(getByText(/Not loaded in the conversation yet/)).toBeTruthy()

    // Cursor up to the compaction entry, which never has a conversation row.
    fireEvent.keyDown(getByRole('dialog'), { key: 'ArrowUp' })
    fireEvent.keyDown(getByRole('dialog'), { key: 'Enter' })
    expect(getByText('This entry has no message in the conversation.')).toBeTruthy()
  })

  it('navigates on click as well', async () => {
    const { findByText, getAllByText, onNavigate } = renderMap({ loaded: ['root'] })

    await findByText('2 branches · 1 fork')
    const [firstNode] = getAllByText('You')
    if (!firstNode) throw new Error('expected the root entry to render in both branches')
    fireEvent.click(firstNode)

    expect(onNavigate).toHaveBeenCalledWith('root')
  })

  it('filters entries, keeps branch numbers, and hides branches without matches', async () => {
    const { findByText, getByLabelText, getByText, queryByText, container } = renderMap()

    await findByText('2 branches · 1 fork')
    fireEvent.input(getByLabelText('Filter session entries'), { target: { value: 'second' } })

    // The meta line is assembled from several text nodes, so read it as one string.
    expect(container.querySelector('.session-map-meta')?.textContent).toContain(
      '1 match of 4 entries'
    )
    expect(getByText('Branch 2')).toBeTruthy()
    // Branch 1 only held "first prompt", so it drops out entirely.
    expect(queryByText('Branch 1')).toBeNull()
    expect(container.querySelectorAll('.session-map-node')).toHaveLength(1)
    expect(getByText('second reply')).toBeTruthy()
  })

  it('says so when nothing matches', async () => {
    const { findByText, getByLabelText, container } = renderMap()

    await findByText('2 branches · 1 fork')
    fireEvent.input(getByLabelText('Filter session entries'), { target: { value: 'zzz' } })

    expect(await findByText('No entries match “zzz”.')).toBeTruthy()
    expect(container.querySelectorAll('.session-map-node')).toHaveLength(0)
  })

  it('moves the cursor to the first match so Enter jumps to it', async () => {
    const { findByText, getByLabelText, getByRole, onNavigate, container } = renderMap({
      loaded: ['leaf-2'],
    })

    await findByText('2 branches · 1 fork')
    fireEvent.input(getByLabelText('Filter session entries'), { target: { value: 'second' } })
    expect(container.querySelector('.session-map-meta')?.textContent).toContain('1 match')

    fireEvent.keyDown(getByRole('dialog'), { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledWith('leaf-2')
  })

  it('clears the filter on Escape before closing the map', async () => {
    const onClose = vi.fn()
    const { findByText, getByLabelText, getByRole, queryByText } = renderMap({ onClose })

    await findByText('2 branches · 1 fork')
    fireEvent.input(getByLabelText('Filter session entries'), { target: { value: 'zzz' } })
    await findByText('No entries match “zzz”.')

    fireEvent.keyDown(getByRole('dialog'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(queryByText('No entries match “zzz”.')).toBeNull()

    fireEvent.keyDown(getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('asks before continuing the session from an entry', async () => {
    const { findByText, getByRole, getByText, onBranchFrom } = renderMap()

    await findByText('2 branches · 1 fork')
    fireEvent.keyDown(getByRole('dialog'), { key: 'Enter', shiftKey: true })

    expect(getByText(/Continue from this assistant entry\?/)).toBeTruthy()
    expect(onBranchFrom).not.toHaveBeenCalled()
  })

  it('continues from the confirmed entry and closes the map', async () => {
    const onClose = vi.fn()
    const { findByText, getByRole, getByText, onBranchFrom } = renderMap({ onClose })

    await findByText('2 branches · 1 fork')
    fireEvent.keyDown(getByRole('dialog'), { key: 'Enter', shiftKey: true })
    fireEvent.click(getByText('Branch here'))

    await vi.waitFor(() => expect(onBranchFrom).toHaveBeenCalledWith('leaf-2'))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('keeps the map open and explains why branching failed', async () => {
    const onClose = vi.fn()
    const { findByText, getByRole, getByText } = renderMap({
      onClose,
      onBranchFrom: async () => {
        throw new Error(
          'Wait for the current response to finish before navigating the session tree.'
        )
      },
    })

    await findByText('2 branches · 1 fork')
    fireEvent.keyDown(getByRole('dialog'), { key: 'Enter', shiftKey: true })
    fireEvent.click(getByText('Branch here'))

    expect(await findByText(/Wait for the current response to finish/)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('cancels a pending branch on Escape without closing the map', async () => {
    const onClose = vi.fn()
    const { findByText, getByRole, queryByText } = renderMap({ onClose })

    await findByText('2 branches · 1 fork')
    fireEvent.keyDown(getByRole('dialog'), { key: 'Enter', shiftKey: true })
    await findByText(/Continue from this assistant entry\?/)

    fireEvent.keyDown(getByRole('dialog'), { key: 'Escape' })
    expect(queryByText(/Continue from this assistant entry\?/)).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('starts a branch from the row action button', async () => {
    const { findByText, container, getByText } = renderMap()

    await findByText('2 branches · 1 fork')
    const cursorRow = container.querySelector('.session-map-node-row.is-cursor')
    const button = cursorRow?.querySelector('.session-map-node-branch')
    if (!button) throw new Error('expected a branch action on the cursor row')
    fireEvent.click(button)

    expect(getByText(/Continue from this assistant entry\?/)).toBeTruthy()
  })

  it('reloads the tree when Pi writes an entry, keeping the cursor where it was', async () => {
    // The second read is what Pi sees after appending a message: one more node
    // and a new active leaf. A fresh object is essential — otherwise the reload
    // would be invisible to everything downstream.
    const appended: SessionTreeResponse = {
      ...tree,
      activeLeafId: 'leaf-3',
      branches: tree.branches.map((branch, index) =>
        index === 1
          ? {
              leafId: 'leaf-3',
              nodes: [
                ...branch.nodes,
                {
                  id: 'leaf-3',
                  parentId: 'leaf-2',
                  type: 'message',
                  timestamp: '2026-09-14T00:03:00.000Z',
                  role: 'user',
                  contentPreview: 'third prompt',
                },
              ],
            }
          : branch
      ),
    }
    const getSessionTree = vi.fn()
    getSessionTree.mockResolvedValueOnce(tree).mockResolvedValueOnce(appended)
    vi.stubGlobal('openpi', { getSessionTree })
    const [version, setVersion] = createSignal(1)
    const { findByText, getByRole, container } = renderMap({ treeVersion: version })

    await findByText('2 branches · 1 fork')
    // Move the cursor off the active leaf before the session writes anything.
    fireEvent.keyDown(getByRole('dialog'), { key: 'Home' })
    expect(cursorIndex(container)).toBe('0')

    setVersion(2)
    expect(await findByText('third prompt')).toBeTruthy()
    expect(getSessionTree).toHaveBeenCalledTimes(2)
    expect(cursorIndex(container)).toBe('0')
  })

  it('closes when the backdrop is pressed, but not from inside the panel', async () => {
    const onClose = vi.fn()
    const { findByText, getByRole, container } = renderMap({ onClose })

    await findByText('2 branches · 1 fork')
    const backdrop = getByRole('dialog')
    const panel = container.querySelector('.session-map-shell')
    if (!panel) throw new Error('expected the map panel')

    fireEvent.mouseDown(panel)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.mouseDown(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reports an empty session', async () => {
    stubTree({
      sessionPath: '/sessions/empty.jsonl',
      branches: [],
      forkPoints: [],
      activeLeafId: null,
    })
    const { findByText } = renderMap()

    expect(await findByText('This session has no entries yet.')).toBeTruthy()
  })

  it('reports a failed load instead of taking the overlay down', async () => {
    stubTree(new Error('ENOENT'))
    const { findByText } = renderMap()

    expect(await findByText('Could not load the session tree.')).toBeTruthy()
  })
})
