import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TranscriptContext } from '@earendil-works/pi-ai'
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    let asked = 0
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
      review: {
        enabled: true,
        ask: (request, signal) => {
          asked += 1
          return neverAnswers(request, signal)
        },
        timeoutMs: 600_000,
      },
    })
    try {
      const prompted = harness.prompt('write it')
      // Wait for the gate to actually reach the prompt: a fixed sleep made this test pass without
      // testing anything when the tool call had not arrived yet.
      await vi.waitFor(() => expect(asked).toBe(1), { timeout: 5000 })
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

  it('lets an abort end a pending confirm too, on a file it cannot show as a diff', async () => {
    // The confirm fallback is a second ask path, and it dropped the abort signal at first: the exact
    // ten-minute Stop hang came back for blind overwrites while the review path looked fixed.
    const setup = fauxSetup()
    const target = join(workspace, 'big.txt')
    await writeFile(target, 'a\n'.repeat(400_000), 'utf8')
    let asked = 0
    setup.faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('write', { path: target, content: 'CLOBBER' }, { id: 'c1' })],
        {
          stopReason: 'toolUse' as const,
        }
      ),
      fauxAssistantMessage([fauxText('never')], { stopReason: 'stop' as const }),
    ])
    const harness = await openDurableHarness({
      backend: 'memory',
      model: setup.model,
      registerProviders: setup.registerProviders,
      workspacePath: workspace,
      review: {
        enabled: true,
        ask: (request, signal) => {
          asked += 1
          return neverAnswers(request, signal)
        },
        timeoutMs: 600_000,
      },
    })
    try {
      const prompted = harness.prompt('overwrite it')
      await vi.waitFor(() => expect(asked).toBe(1), { timeout: 5000 })
      await expect(
        Promise.race([
          harness.abort(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('abort hung')), 3000)),
        ])
      ).resolves.not.toThrow()
      await prompted.catch(() => undefined)
      expect(await readFile(target, 'utf8')).toBe('a\n'.repeat(400_000))
    } finally {
      await harness.close()
    }
  }, 20_000)

  it('lets an abort end a pending edit review, not just a write', async () => {
    // The edit path is a third ask site; abort was covered end to end only for writes.
    const setup = fauxSetup()
    const target = join(workspace, 'existing.txt')
    await writeFile(target, 'one\ntwo\n', 'utf8')
    let asked = 0
    setup.faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            'edit',
            { path: target, edits: [{ oldText: 'two', newText: 'TWO' }] },
            { id: 'c1' }
          ),
        ],
        { stopReason: 'toolUse' as const }
      ),
      fauxAssistantMessage([fauxText('never')], { stopReason: 'stop' as const }),
    ])
    const harness = await openDurableHarness({
      backend: 'memory',
      model: setup.model,
      registerProviders: setup.registerProviders,
      workspacePath: workspace,
      review: {
        enabled: true,
        ask: (request, signal) => {
          asked += 1
          return neverAnswers(request, signal)
        },
        timeoutMs: 600_000,
      },
    })
    try {
      const prompted = harness.prompt('edit it')
      await vi.waitFor(() => expect(asked).toBe(1), { timeout: 5000 })
      await expect(
        Promise.race([
          harness.abort(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('abort hung')), 3000)),
        ])
      ).resolves.not.toThrow()
      await prompted.catch(() => undefined)
      expect(await readFile(target, 'utf8')).toBe('one\ntwo\n')
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
