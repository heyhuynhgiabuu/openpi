import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TranscriptContext } from '@earendil-works/pi-ai'
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDurableHarness } from '../electron/pi/durable/harness'
import type { ExtensionUiRequest, ExtensionUiResponse } from '../src/lib/extensionUiTypes'

/**
 * The gate has to hold on the real path, not just in the hook: a denied review must leave the file
 * untouched and tell the model why. Driven through a real harness with the built-in coding tools.
 */

let workspace = ''

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'openpi-durable-review-e2e-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

function fauxSetup() {
  const faux = fauxProvider()
  const contexts: TranscriptContext[] = []
  return {
    faux,
    contexts,
    registerProviders: (models: { setProvider: (provider: typeof faux.provider) => void }) => {
      models.setProvider(faux.provider)
    },
    model: { provider: faux.getModel().provider, modelId: faux.getModel().id },
  }
}

const deny = (request: ExtensionUiRequest): Promise<ExtensionUiResponse> =>
  Promise.resolve(
    request.method === 'preapply_review'
      ? { id: request.id, approved: [] }
      : { id: request.id, confirmed: false }
  )

/** A prompt nobody answers: the gate must not hold the run open forever. */
const neverAnswers = (request: ExtensionUiRequest, signal?: AbortSignal) =>
  new Promise<ExtensionUiResponse>((resolve, reject) => {
    // Rejecting on abort is what `createReviewAsk` does, and what lets pi-durable stop waiting.
    signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    void request
    void resolve
  })

describe('durable pre-apply review, through a real harness', () => {
  it('lets an abort end a pending review instead of freezing the run', async () => {
    // Stop, a new session, reload and fork all abort the harness; a review nobody answers used to
    // hold that abort for the full ten-minute timeout.
    const setup = fauxSetup()
    const target = join(workspace, 'pending.txt')
    setup.faux.setResponses([
      fauxAssistantMessage([fauxToolCall('write', { path: target, content: 'x' }, { id: 'c1' })], {
        stopReason: 'toolUse' as const,
      }),
      fauxAssistantMessage([fauxText('never')], { stopReason: 'stop' as const }),
    ])
    const harness = await openDurableHarness({
      backend: 'memory',
      model: setup.model,
      registerProviders: setup.registerProviders,
      workspacePath: workspace,
      review: { enabled: true, ask: neverAnswers, timeoutMs: 600_000 },
    })
    try {
      const prompted = harness.prompt('write it')
      await new Promise((resolve) => setTimeout(resolve, 50))
      // The point is that this settles at all: before the abort signal was threaded through, it
      // waited for the ten-minute prompt timeout.
      await expect(
        Promise.race([
          harness.abort(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('abort hung')), 3000)),
        ])
      ).resolves.not.toThrow()
      await prompted.catch(() => undefined)
      expect(existsSync(target)).toBe(false)
    } finally {
      await harness.close()
    }
  }, 20_000)

  it('does not write the file when the review is denied, and tells the model why', async () => {
    const setup = fauxSetup()
    const target = join(workspace, 'denied.txt')
    setup.faux.setResponses([
      fauxAssistantMessage([fauxToolCall('write', { path: target, content: 'x' }, { id: 'c1' })], {
        stopReason: 'toolUse' as const,
      }),
      (context) => {
        setup.contexts.push(context)
        return fauxAssistantMessage([fauxText('understood')], { stopReason: 'stop' as const })
      },
    ])

    const harness = await openDurableHarness({
      backend: 'memory',
      model: setup.model,
      registerProviders: setup.registerProviders,
      workspacePath: workspace,
      review: { enabled: true, ask: deny },
    })
    try {
      await harness.prompt('write the file')
      expect(existsSync(target)).toBe(false)
      // The block reaches the model as the tool result it sees on its next request.
      expect(JSON.stringify(setup.contexts.at(-1) ?? {})).toContain('pre-apply review')
    } finally {
      await harness.close()
    }
  })
})
