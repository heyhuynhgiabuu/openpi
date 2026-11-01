import { describe, expect, it } from 'vitest'
import { createReviewAsk, type ReviewAskDeps } from '../electron/pi/durable/reviewAsk'
import type { ExtensionUiRequest, ExtensionUiResponse } from '../src/lib/extensionUiTypes'

/**
 * The wiring between the gate and the renderer. A gate is only worth having if this path is right,
 * and every failure here must deny rather than approve.
 */

const request: ExtensionUiRequest = {
  id: 'req-1',
  method: 'preapply_review',
  title: 'Review before applying: a.txt',
  review: {
    path: 'a.txt',
    summary: 'write · 1 → 1',
    hunks: [{ diff: '-a\n+b', removed: 1, added: 1 }],
  },
}

/** A fake pending registry that records registrations and lets a test settle them. */
function harness() {
  const registered = new Map<
    string,
    { resolve: (r: ExtensionUiResponse) => void; reject: (e: Error) => void }
  >()
  const sent: ExtensionUiRequest[] = []
  const phases: string[] = []
  const logs: string[] = []
  let fulfilments = 0
  const deps: ReviewAskDeps = {
    send: (r) => {
      sent.push(r)
    },
    register: (id, _timeout, resolve, reject) => {
      registered.set(id, { resolve, reject })
    },
    fulfill: (response) => {
      const entry = registered.get(response.id)
      if (!entry) return false
      fulfilments += 1
      registered.delete(response.id)
      entry.resolve(response)
      return true
    },
    log: (level, text) => logs.push(`${level}: ${text}`),
    emitPrompt: (phase) => phases.push(phase),
    defaultTimeoutMs: 1000,
  }
  return {
    deps,
    sent,
    phases,
    logs,
    registered,
    fulfilments: () => fulfilments,
    answer: (response: ExtensionUiResponse) => registered.get(response.id)?.resolve(response),
  }
}

describe('review ask', () => {
  it('sends the request and resolves with the answer', async () => {
    const h = harness()
    const ask = createReviewAsk(h.deps)
    const pending = ask(request)
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]?.id).toBe('req-1')
    h.answer({ id: 'req-1', approved: [0] })
    await expect(pending).resolves.toEqual({ id: 'req-1', approved: [0] })
  })

  it('tells the renderer a prompt opened and closed, so no dialog outlives the wait', async () => {
    const h = harness()
    const ask = createReviewAsk(h.deps)
    const pending = ask(request)
    h.answer({ id: 'req-1', approved: [0] })
    await pending
    expect(h.phases).toEqual(['start', 'end'])
  })

  it('closes the prompt when the answer expires, so the dialog cannot stay up', async () => {
    const h = harness()
    const ask = createReviewAsk(h.deps)
    const pending = ask(request)
    // What `registerExtensionUiPending` does on timeout, without waiting ten minutes.
    h.answer({ id: 'req-1', cancelled: true })
    await expect(pending).resolves.toMatchObject({ cancelled: true })
    expect(h.phases).toEqual(['start', 'end'])
  })

  it('releases the pending entry and rejects when the run is aborted', async () => {
    const h = harness()
    const ask = createReviewAsk(h.deps)
    const controller = new AbortController()
    const pending = ask(request, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow('aborted')
    // The entry must not stay registered: its timer would keep the process alive and a late answer
    // would look like it settled a live prompt.
    expect(h.registered.has('req-1')).toBe(false)
    expect(h.phases).toEqual(['start', 'end'])
  })

  it('does not send anything when the run is already aborted', async () => {
    const h = harness()
    const ask = createReviewAsk(h.deps)
    const controller = new AbortController()
    controller.abort()
    await expect(ask(request, controller.signal)).rejects.toThrow('aborted')
    expect(h.sent).toEqual([])
  })

  it('denies instead of hanging when the request cannot be sent', async () => {
    const h = harness()
    const ask = createReviewAsk({
      ...h.deps,
      send: () => {
        throw new Error('no parent port')
      },
    })
    await expect(ask(request)).resolves.toEqual({ id: 'req-1', cancelled: true })
    expect(h.logs.join()).toContain('could not ask for review')
  })

  it('uses the caller timeout, and the default when the request carries none', async () => {
    const timeouts: number[] = []
    const h = harness()
    const ask = createReviewAsk({
      ...h.deps,
      register: (id, timeoutMs, resolve, reject) => {
        timeouts.push(timeoutMs)
        h.deps.register(id, timeoutMs, resolve, reject)
      },
    })
    void ask(request)
    void ask({ ...request, id: 'req-2', timeout: undefined })
    expect(timeouts[0]).toBe(1000)
    expect(timeouts[1]).toBe(1000)

    const h2 = harness()
    const timeouts2: number[] = []
    const ask2 = createReviewAsk({
      ...h2.deps,
      register: (id, timeoutMs, resolve, reject) => {
        timeouts2.push(timeoutMs)
        h2.deps.register(id, timeoutMs, resolve, reject)
      },
    })
    void ask2({ ...request, id: 'req-3', timeout: 42 })
    expect(timeouts2[0]).toBe(42)
  })
})
