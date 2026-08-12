import { describe, expect, it, vi } from 'vitest'
import { createSessionNavigation, type ParentStackEntry } from '../src/hooks/sessionNavigation'
import type { SessionReady } from '../src/lib/ipc'

function ready(path = '/sessions/parent.jsonl'): SessionReady {
  return {
    cwd: '/workspace',
    sessionFile: path,
    sessionId: 'session-1',
    sessionName: 'Parent',
    model: null,
    thinkingLevel: null,
  }
}

describe('session navigation controller', () => {
  it('pushes the current session before opening an exact sub-session', async () => {
    let stack: ParentStackEntry[] = []
    const openSession = vi.fn()
    const controller = createSessionNavigation({
      api: {
        pickWorkspace: vi.fn(),
        openSession,
        resolveSubSessionPath: vi.fn(
          async () => '/workspace/.pi/artifacts/tasks/sessions/task/sub.jsonl'
        ),
        newSession: vi.fn(),
      },
      getReady: () => ready(),
      getParentStack: () => stack,
      setParentStack: (entries) => {
        stack = entries
      },
      setError: vi.fn(),
      sessionIndex: { loadSessionIndex: vi.fn(), selectedWorkspaceForQuery: () => '/workspace' },
    })

    await expect(controller.openSubSession('task-1')).resolves.toBe(true)
    expect(stack).toEqual([{ path: '/sessions/parent.jsonl', name: 'Parent', cwd: '/workspace' }])
    expect(openSession).toHaveBeenCalledWith({
      path: '/workspace/.pi/artifacts/tasks/sessions/task/sub.jsonl',
    })
  })

  it('pops and opens the latest parent session', async () => {
    let stack: ParentStackEntry[] = [
      { path: '/sessions/grandparent.jsonl', name: null, cwd: '/workspace' },
      { path: '/sessions/parent.jsonl', name: 'Parent', cwd: '/workspace' },
    ]
    const openSession = vi.fn()
    const controller = createSessionNavigation({
      api: {
        pickWorkspace: vi.fn(),
        openSession,
        resolveSubSessionPath: vi.fn(),
        newSession: vi.fn(),
      },
      getReady: () => ready(),
      getParentStack: () => stack,
      setParentStack: (entries) => {
        stack = entries
      },
      setError: vi.fn(),
      sessionIndex: { loadSessionIndex: vi.fn(), selectedWorkspaceForQuery: () => '/workspace' },
    })

    await controller.popToParent()
    expect(stack).toEqual([{ path: '/sessions/grandparent.jsonl', name: null, cwd: '/workspace' }])
    expect(openSession).toHaveBeenCalledWith({ path: '/sessions/parent.jsonl' })
  })

  it('clears parent navigation before opening an existing session', async () => {
    const setParentStack = vi.fn()
    const openSession = vi.fn()
    const controller = createSessionNavigation({
      api: {
        pickWorkspace: vi.fn(),
        openSession,
        resolveSubSessionPath: vi.fn(),
        newSession: vi.fn(),
      },
      getReady: () => ready(),
      getParentStack: () => [],
      setParentStack,
      setError: vi.fn(),
      sessionIndex: { loadSessionIndex: vi.fn(), selectedWorkspaceForQuery: () => '/workspace' },
    })

    await expect(
      controller.openExistingSession({
        path: '/sessions/other.jsonl',
        id: 'other',
        cwd: '/workspace',
        workspacePath: '/workspace',
        workspaceName: 'workspace',
        title: 'Other',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
        messageCount: 0,
        firstMessage: '',
        parentSessionPath: null,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0,
        entryCount: 0,
        branchCount: 0,
        lastModel: '',
        active: false,
      })
    ).resolves.toBeUndefined()
    expect(setParentStack).toHaveBeenCalledWith([])
    expect(openSession).toHaveBeenCalledWith({ path: '/sessions/other.jsonl' })
  })

  it('restores the parent stack when opening a sub-session fails', async () => {
    let stack: ParentStackEntry[] = []
    const controller = createSessionNavigation({
      api: {
        pickWorkspace: vi.fn(),
        openSession: vi.fn(async () => {
          throw new Error('open failed')
        }),
        resolveSubSessionPath: vi.fn(async () => '/sessions/sub.jsonl'),
        newSession: vi.fn(),
      },
      getReady: () => ready(),
      getParentStack: () => stack,
      setParentStack: (entries) => {
        stack = entries
      },
      setError: vi.fn(),
      sessionIndex: { loadSessionIndex: vi.fn(), selectedWorkspaceForQuery: () => '/workspace' },
    })

    await expect(controller.openSubSession('task-1')).rejects.toThrow('open failed')
    expect(stack).toEqual([])
  })

  it('does not fall back when the exact sub-session cannot be resolved', async () => {
    const openSession = vi.fn()
    const controller = createSessionNavigation({
      api: {
        pickWorkspace: vi.fn(),
        openSession,
        resolveSubSessionPath: vi.fn(async () => null),
        newSession: vi.fn(),
      },
      getReady: () => ready(),
      getParentStack: () => [],
      setParentStack: vi.fn(),
      setError: vi.fn(),
      sessionIndex: { loadSessionIndex: vi.fn(), selectedWorkspaceForQuery: () => '/workspace' },
    })

    await expect(controller.openSubSession('task-1')).resolves.toBe(false)
    expect(openSession).not.toHaveBeenCalled()
  })
})
