import { createRoot } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentReviewChange, AgentReviewSummary } from '../src/lib/ipc'
import { useAgentReviewChanges } from '../src/hooks/useAgentReviewChanges'

const change: AgentReviewChange = {
  id: 'change-1',
  path: 'src/App.tsx',
  toolCallId: 'call-1',
  toolName: 'edit',
  status: 'modified',
  createdAt: 1,
  diff: '',
  beforeContent: 'a\n',
  afterContent: 'b\n',
  totalAdded: 1,
  totalRemoved: 1,
  truncated: false,
  hunks: [],
}

interface ReviewApi {
  onChanged: (listener: (summary: AgentReviewSummary) => void) => () => void
  list: () => Promise<AgentReviewSummary>
  keep: (id: string) => Promise<AgentReviewSummary>
  revert: (id: string) => Promise<AgentReviewSummary>
  keepHunk: (id: string, index: number) => Promise<AgentReviewSummary>
  revertHunk: (id: string, index: number) => Promise<AgentReviewSummary>
  revertAll: () => Promise<AgentReviewSummary>
  clear: () => Promise<AgentReviewSummary>
}

function stubReviewApi(overrides: Partial<ReviewApi> = {}) {
  const summary: AgentReviewSummary = { changes: [change] }
  const api: ReviewApi = {
    onChanged: vi.fn(() => () => {}),
    list: vi.fn(async () => summary),
    keep: vi.fn(async () => summary),
    revert: vi.fn(async () => summary),
    keepHunk: vi.fn(async () => summary),
    revertHunk: vi.fn(async () => summary),
    revertAll: vi.fn(async () => summary),
    clear: vi.fn(async () => summary),
    ...overrides,
  }
  vi.stubGlobal('openpi', { agentReview: api })
  return api
}

function mount() {
  let hook!: ReturnType<typeof useAgentReviewChanges>
  createRoot((dispose) => {
    hook = useAgentReviewChanges()
    dispose()
  })
  return hook
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useAgentReviewChanges error routing', () => {
  it('lets a hunk failure reach the caller so it can be shown next to the hunk', async () => {
    stubReviewApi({
      keepHunk: vi.fn(async () => {
        throw new Error('hunk 2 is out of date')
      }),
    })
    const review = mount()

    await expect(review.keepHunk('change-1', 2)).rejects.toThrow('hunk 2 is out of date')
    expect(review.error).toBeNull()
  })

  it('keeps pane-level failures in the error signal', async () => {
    stubReviewApi({
      revertAll: vi.fn(async () => {
        throw new Error('file changed since review item was created')
      }),
    })
    const review = mount()

    await expect(review.revertAll()).resolves.toBeUndefined()
    expect(review.error).toBe('file changed since review item was created')
  })

  it('applies the summary a successful operation returns', async () => {
    stubReviewApi()
    const review = mount()

    await review.keepHunk('change-1', 0)

    expect(review.changes.map((entry) => entry.id)).toEqual(['change-1'])
    expect(review.error).toBeNull()
  })
})
