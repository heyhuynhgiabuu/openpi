import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FauxResponseStep, ModelThinkingLevel } from '@earendil-works/pi-ai'
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai'
import { afterEach, beforeEach } from 'vitest'
import { openDurableHarness } from '../../electron/pi/durable/harness'
import type { DurableHarness } from '../../electron/pi/durable/types'
import { createDurableSessions, type DurableSessionDeps } from '../../electron/pi/durableSession'
import type { ResolvedModel } from '../../electron/pi/durableSettings'
import { sidecarMessageSchema } from '../../electron/pi/sidecarContracts'
import type { SidecarCommand, SidecarMessage } from '../../electron/pi/sidecarTypes'

/**
 * Shared setup for the durable session tests: a real harness with a faux provider, the real export,
 * and a recording `send` in place of the sidecar's parent port.
 */

let root = ''
// Messages the main process would reject (`sidecarMessageSchema`), collected across a test.
const contractViolations: string[] = []

/** Call at the top of a test file: gives every test a fresh temp directory. */
export function useSessionRoot(): void {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'openpi-durable-session-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    // Every message a durable session sent must satisfy the contract the main process enforces.
    const violations = contractViolations.splice(0)
    if (violations.length > 0) {
      throw new Error(`sidecar messages violate the contract:\n${violations.join('\n')}`)
    }
  })
}

export const sessionRoot = (): string => root

/** Levels the test model claims to support (pi-durable accepts any of them). */
export const FAUX_LEVELS: readonly ModelThinkingLevel[] = ['off', 'low', 'high']

export const MODEL = { id: 'm', name: 'M', provider: 'faux', reasoning: false, contextWindow: 1000 }

export async function setup(
  options: {
    answers?: string[]
    responses?: FauxResponseStep[]
    sessionFile?: string
    failOpen?: boolean
    /** Models `resolveModel` knows, by `provider/modelId`; the faux model is always known. */
    knownModels?: Record<string, ResolvedModel>
    /** Hold every `resolveModel` call open until this resolves. */
    resolveGate?: Promise<void>
    /** Make `resolveModel` reject (the model registry is unavailable). */
    failResolve?: boolean
    /** Make persisting the default model/thinking level throw. */
    failPersist?: boolean
    /** Lower the compaction threshold so a short conversation can be compacted. */
    compaction?: { keepRecentTokens: number }
    /** Directory user shell commands run in; defaults to the process cwd. */
    workspacePath?: string
    /** Keep the store on disk, so reopening a session finds its history (reload). */
    persistent?: boolean
    /** Clock for the session's header time; a new one per call shows what is preserved. */
    now?: () => Date
    /** Make the nth `open` (1-based) fail. */
    failOpenAt?: number
    /** Make `stats()` reject on the harness the nth `open` returns (1-based). */
    breakStatsAt?: number
    /** Called with every message the session sends, before it is recorded. */
    onSend?: (message: SidecarMessage) => void
    /** Discover user resources here, as production does, so `/template` really expands. */
    userAgentDir?: string
  } = {}
) {
  const sent: SidecarMessage[] = []
  const knownModels: Record<string, ResolvedModel> = { ...options.knownModels }
  const resolver = { fail: options.failResolve === true }
  const logs: string[] = []
  const harnesses: DurableHarness[] = []
  const closed: DurableHarness[] = []
  const persisted: string[] = []
  let opens = 0
  const trusts: boolean[] = []
  /** Whether each `open` was a reopen, in order: the same flag `open()` uses to decide logging. */
  const resumeFlags: boolean[] = []
  const faux = fauxProvider()
  faux.setResponses(
    options.responses ??
      (options.answers ?? ['an answer']).map((text) =>
        fauxAssistantMessage([fauxText(text)], { stopReason: 'stop' as const })
      )
  )
  // The model the harness is opened with is a known one, as in production, so a reload that looks
  // it up finds it instead of warning.
  knownModels[`faux/${faux.getModel().id}`] ??= { info: MODEL, thinkingLevels: FAUX_LEVELS }
  const identity = {
    sessionId: 'sess-1',
    sessionFile: options.sessionFile ?? join(root, 'sessions', 'sess-1.jsonl'),
  }
  // The first session is `identity`; a later fresh one (not a reload) gets its own id and file.
  let identities = 0
  const freshIdentity = () => {
    identities += 1
    if (identities === 1) return identity
    return {
      sessionId: `sess-${identities}`,
      sessionFile: join(root, 'sessions', `sess-${identities}.jsonl`),
    }
  }
  const deps: DurableSessionDeps = {
    send: (message) => {
      options.onSend?.(message)
      sent.push(message)
      const parsed = sidecarMessageSchema.safeParse(message)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        contractViolations.push(`${message.type}: ${issue?.path.join('.')} ${issue?.message}`)
      }
    },
    log: (level, text) => logs.push(`${level}: ${text}`),
    newIdentity: freshIdentity,
    now: options.now ?? (() => new Date('2026-10-27T00:00:00.000Z')),
    resolveModel: async (provider, modelId) => {
      await options.resolveGate
      if (resolver.fail) throw new Error('registry offline')
      return knownModels[`${provider}/${modelId}`]
    },
    open: async (_cwd, trusted, opening, resuming) => {
      opens += 1
      trusts.push(trusted)
      resumeFlags.push(resuming)
      if (options.failOpen || opens === options.failOpenAt) throw new Error('no default model')
      const harness = await openDurableHarness({
        backend: options.persistent ? 'jsonl' : 'memory',
        // One store per session, as in production (`durableHost.ts`), including the rule that a
        // resume must not create the store it cannot find.
        directory: join(root, 'store', opening.storeId ?? opening.sessionId),
        requireStore: opening.storeId !== undefined,
        conversationIds: opening.conversationIds,
        model: { provider: faux.getModel().provider, modelId: faux.getModel().id },
        registerProviders: (models) => models.setProvider(faux.provider),
        tools: false,
        policy: false,
        compaction: options.compaction,
        workspacePath: options.workspacePath,
        userAgentDir: options.userAgentDir,
      })
      harnesses.push(harness)
      const close = harness.close.bind(harness)
      harness.close = async () => {
        closed.push(harness)
        return close()
      }
      if (opens === options.breakStatsAt) {
        harness.stats = async () => {
          throw new Error('stats unavailable')
        }
      }
      return {
        harness,
        model: MODEL,
        thinkingLevels: FAUX_LEVELS,
        persist: {
          model: (provider, modelId) => {
            if (options.failPersist) throw new Error('disk full')
            persisted.push(`model:${provider}/${modelId}`)
          },
          thinking: (level) => {
            if (options.failPersist) throw new Error('disk full')
            persisted.push(`thinking:${level}`)
          },
        },
      }
    },
  }
  const sessions = createDurableSessions(deps)
  const types = () => sent.map((m) => m.type)
  return {
    sessions,
    sent,
    logs,
    identity,
    types,
    harnesses,
    closed,
    persisted,
    resumeFlags,
    knownModels,
    resolver,
    trusts,
  }
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
