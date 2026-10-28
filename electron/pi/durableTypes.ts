import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { DurableHarness } from './durable/types'
import type { SettingsDeps, SettingsPersist } from './durableSettings'
import type { SessionReadyPayload, SidecarCommand, SidecarMessage } from './sidecarTypes'

/** Shapes shared by the durable session factory and its helpers (`durableSession.ts`). */

export interface DurableIdentity {
  sessionId: string
  /** Where the JSONL v3 export lives; the sidebar reads it like any other session. */
  sessionFile: string
  /** Which store holds the conversation; the session's own id unless it was forked from another. */
  storeId?: string
  /** Which conversation of the store this session is; the store's root when absent. */
  conversationId?: number
}

export interface DurableOpenResult {
  harness: DurableHarness
  model: SessionReadyPayload['model']
  /** Thinking levels the opened model supports. */
  thinkingLevels: readonly ModelThinkingLevel[]
  persist: SettingsPersist
}

export interface DurableSessionDeps extends SettingsDeps {
  send: (message: SidecarMessage) => void
  newIdentity: (cwd: string) => DurableIdentity
  open: (
    cwd: string,
    workspaceTrusted: boolean,
    identity: DurableIdentity
  ) => Promise<DurableOpenResult>
  now: () => Date
}

export interface DurableStartOptions {
  workspaceTrusted: boolean
  requestId?: string
  /** Reopen an existing session (same store, file and header time) instead of starting a new one. */
  resume?: { identity: DurableIdentity; startedAt: string }
}

export interface ActiveSession {
  harness: DurableHarness
  cwd: string
  workspaceTrusted: boolean
  identity: DurableIdentity
  startedAt: string
  stopEvents: () => Promise<void>
  model: SessionReadyPayload['model']
  thinkingLevel: string | null
  thinkingLevels: readonly ModelThinkingLevel[]
  sessionName: string | null
  persist: SettingsPersist
  /** True between `agent_start` and `agent_end`, for `get_stats`' `isStreaming`. */
  streaming: boolean
  /** Set by `abort`, so a run the user cancelled is not reported as a failure. */
  abortRequested: boolean
  /** Set before shutdown: queued messages still settling must not report or export afterwards. */
  closing: boolean
}

export interface DurableSessions {
  isActive(): boolean
  start(cwd: string, options: DurableStartOptions): Promise<void>
  /** `true` when the command was fully handled here; `false` to fall through to the SDK handlers. */
  handleCommand(cmd: SidecarCommand): Promise<boolean>
  stop(): Promise<void>
}
