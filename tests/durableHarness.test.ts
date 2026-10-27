import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDurableHarness } from '../electron/pi/durable/harness'
import type { DurableHarness } from '../electron/pi/durable/types'

/** Adapter facts against the real @earendil-works/pi-durable (no network: the faux provider scripts answers). */

const ANSWER_1 = 'durable says hello'
const ANSWER_2 = 'durable answers again'

async function withHarness(
  options: Parameters<typeof openDurableHarness>[0],
  run: (harness: DurableHarness) => Promise<void>
): Promise<void> {
  const harness = await openDurableHarness(options)
  try {
    await run(harness)
  } finally {
    await harness.close()
  }
}

function fauxSetup(answers: string[]) {
  const faux = fauxProvider()
  faux.setResponses(
    answers.map((text) => fauxAssistantMessage([fauxText(text)], { stopReason: 'stop' as const }))
  )
  return {
    registerProviders: (
      models: Parameters<
        NonNullable<Parameters<typeof openDurableHarness>[0]['registerProviders']>
      >[0]
    ) => {
      models.setProvider(faux.provider)
    },
    faux,
    model: { provider: faux.getModel().provider, modelId: faux.getModel().id },
  }
}

describe('durable harness adapter', () => {
  it('runs a prompt end-to-end over memory storage', async () => {
    const setup = fauxSetup([ANSWER_1])
    await withHarness(
      { backend: 'memory', model: setup.model, registerProviders: setup.registerProviders },
      async (h) => {
        const result = await h.prompt('ping')
        expect(result.status).toBe('done')
        expect(result.answerText).toBe(ANSWER_1)
        const view = await h.snapshot()
        const kinds = view.entries.map((entry) => entry.kind)
        expect(kinds).toContain('pi.user')
        expect(kinds).toContain('pi.assistant')
        expect(view.entries.at(-1)?.text).toBe(ANSWER_1)
      }
    )
  })

  it('keeps history across close and reopen over jsonl storage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpi-durable-'))
    try {
      const first = fauxSetup([ANSWER_1])
      await withHarness(
        {
          backend: 'jsonl',
          directory,
          model: first.model,
          registerProviders: first.registerProviders,
        },
        async (h) => {
          const result = await h.prompt('first')
          expect(result.answerText).toBe(ANSWER_1)
        }
      )
      const second = fauxSetup([ANSWER_2])
      await withHarness(
        {
          backend: 'jsonl',
          directory,
          model: second.model,
          registerProviders: second.registerProviders,
        },
        async (h) => {
          const before = await h.snapshot()
          expect(
            before.entries.filter((entry) => entry.kind === 'pi.assistant').map((e) => e.text)
          ).toEqual([ANSWER_1])
          const result = await h.prompt('second')
          expect(result.answerText).toBe(ANSWER_2)
        }
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('streams structural views through watch', async () => {
    const setup = fauxSetup([ANSWER_1])
    await withHarness(
      { backend: 'memory', model: setup.model, registerProviders: setup.registerProviders },
      async (h) => {
        const views: unknown[] = []
        const stop = h.watch((view) => {
          views.push(view)
        })
        await h.prompt('watched')
        stop()
        const last = views.at(-1) as { entries: { text?: string }[] } | undefined
        expect(last?.entries.some((entry) => entry.text === ANSWER_1)).toBe(true)
      }
    )
  })
})
