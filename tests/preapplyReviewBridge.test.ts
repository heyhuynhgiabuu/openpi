import { describe, expect, it, vi } from 'vitest'
import type { ExtensionUiRequest } from '../src/lib/extensionUiTypes'
import { PREAPPLY_REVIEW_MARKER } from '../src/lib/extensionUiTypes'
import { createOpenPiExtensionUIContext } from '../electron/pi/extensionUiRpc'
import { fulfillExtensionUiPending } from '../electron/pi/extensionUiPending'

const review = {
  path: 'src/App.tsx',
  summary: 'edit · -2 lines / +2 lines · 2 hunks',
  hunks: [
    { diff: '-one\n+ONE', removed: 1, added: 1 },
    { diff: '-two\n+TWO', removed: 1, added: 1 },
  ],
}

function harness() {
  const requests: ExtensionUiRequest[] = []
  const context = createOpenPiExtensionUIContext({
    sessionEvent: vi.fn(),
    postExtensionUiRequest: (request) => requests.push(request),
  })
  return { requests, context }
}

describe('pre-apply review bridge', () => {
  it('turns a marked input into a typed review request', async () => {
    const { requests, context } = harness()

    const answer = context.input(
      'Review before applying: src/App.tsx',
      PREAPPLY_REVIEW_MARKER + JSON.stringify(review)
    )

    expect(requests).toHaveLength(1)
    const request = requests[0]
    expect(request?.method).toBe('preapply_review')
    expect(request?.method === 'preapply_review' ? request.review : null).toEqual(review)

    if (request) fulfillExtensionUiPending({ id: request.id, approved: [1] })
    await expect(answer).resolves.toBe('{"approved":[1]}')
  })

  it('treats a cancelled review as no answer', async () => {
    const { requests, context } = harness()

    const answer = context.input('title', PREAPPLY_REVIEW_MARKER + JSON.stringify(review))
    const request = requests[0]
    if (request) fulfillExtensionUiPending({ id: request.id, cancelled: true })

    await expect(answer).resolves.toBeUndefined()
  })

  it('denies a marked payload it cannot validate instead of showing raw JSON', async () => {
    const { requests, context } = harness()

    const answer = context.input('title', `${PREAPPLY_REVIEW_MARKER}{"path":1}`)

    await expect(answer).resolves.toBeUndefined()
    expect(requests).toEqual([])
  })

  it('still posts a plain input when the placeholder is unmarked', async () => {
    const { requests, context } = harness()

    const answer = context.input('Commit message', 'type here')
    const request = requests[0]
    expect(request?.method).toBe('input')
    if (request) fulfillExtensionUiPending({ id: request.id, value: 'feat: x' })

    await expect(answer).resolves.toBe('feat: x')
  })
})
