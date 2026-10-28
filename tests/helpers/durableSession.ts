import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FauxResponseStep } from '@earendil-works/pi-ai'
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai'
import { afterEach, beforeEach } from 'vitest'
import { openDurableHarness } from '../../electron/pi/durable/harness'
import type { DurableHarness } from '../../electron/pi/durable/types'
import { createDurableSessions, type DurableSessionDeps } from '../../electron/pi/durableSession'
import type { SidecarCommand, SidecarMessage } from '../../electron/pi/sidecarTypes'

/**
 * Shared setup for the durable session tests: a real harness with a faux provider, the real export,
 * and a recording `send` in place of the sidecar's parent port.
 */

let root = ''

/** Call at the top of a test file: gives every test a fresh temp directory. */
export function useSessionRoot(): void {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'openpi-durable-session-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })
}

export const sessionRoot = (): string => root

export const MODEL = { id: 'm', name: 'M', provider: 'faux', reasoning: false, contextWindow: 1000 }

export async function setup(
  options: {
    answers?: string[]
    responses?: FauxResponseStep[]
    sessionFile?: string
    failOpen?: boolean
  } = {}
) {
  const sent: SidecarMessage[] = []
  const logs: string[] = []
  const harnesses: DurableHarness[] = []
  const faux = fauxProvider()
  faux.setResponses(
    options.responses ??
      (options.answers ?? ['an answer']).map((text) =>
        fauxAssistantMessage([fauxText(text)], { stopReason: 'stop' as const })
      )
  )
  const identity = {
    sessionId: 'sess-1',
    sessionFile: options.sessionFile ?? join(root, 'sessions', 'sess-1.jsonl'),
  }
  const deps: DurableSessionDeps = {
    send: (message) => sent.push(message),
    log: (level, text) => logs.push(`${level}: ${text}`),
    newIdentity: () => identity,
    now: () => new Date('2026-10-27T00:00:00.000Z'),
    open: async () => {
      if (options.failOpen) throw new Error('no default model')
      const harness = await openDurableHarness({
        backend: 'memory',
        model: { provider: faux.getModel().provider, modelId: faux.getModel().id },
        registerProviders: (models) => models.setProvider(faux.provider),
        tools: false,
        policy: false,
      })
      harnesses.push(harness)
      return { harness, model: MODEL }
    },
  }
  const sessions = createDurableSessions(deps)
  const types = () => sent.map((m) => m.type)
  return { sessions, sent, logs, identity, types, harnesses }
}

export const prompt = (text: string, contextPrefix?: string): SidecarCommand => ({
  type: 'prompt',
  text,
  contextPrefix,
})

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  what: string
): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`timed out waiting for ${what}`)
}
