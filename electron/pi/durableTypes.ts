import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { DurableHarness } from './durable/types'
import type { Activity } from './durableActivity'
import type { Reopenable } from './durableSessionView'
import type { SettingsDeps, SettingsPersist } from './durableSettings'
import type { SessionReadyPayload, SidecarCommand, SidecarMessage } from './sidecarTypes'

/** Shapes shared by the durable session factory and its helpers (`durableSession.ts`). */

export interface DurableIdentity {
  sessionId: string
  /** Where the JSONL v3 export lives; the sidebar reads it like any other session. */
  sessionFile: string
  /** Which store holds the conversation; the session's own id unless it was forked from another. */
  storeId?: string
  /**
   * Which conversations of the store make up this session (oldest branch first, the active one
   * last); the store's root alone when absent.
   */
  conversationIds?: number[]
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
  /** What is in flight, so that a navigation can refuse to overlap it. */
  activity: Activity
  /** Set before shutdown: queued messages still settling must not report or export afterwards. */
  closing: boolean
}

export interface DurableSessions {
  isActive(): boolean
  /**
   * The workspace of the running durable session, or `undefined` when it serves none. Commands that
   * read per-workspace settings ask this before falling back to the SDK session state, which is
   * null while a durable session is active.
   */
  cwd(): string | undefined
  /**
   * The running session in the shape `startSession` needs to reopen it, or `undefined` when none is
   * being served. Replacing a session disposes this one first, so it has to be taken before that.
   */
  reopenable(): Reopenable | undefined
  /** What the slash picker offers: the prompt templates this runtime discovered. */
  promptCommands(): Array<{ name: string; description: string; argHint?: string }>
  start(cwd: string, options: DurableStartOptions): Promise<void>
  /** Whether this runtime can reopen the file, without opening its store or touching the session. */
  canResume(sessionFile: string): Promise<boolean>
  /**
   * Reopen the file's session. `false` when the file is no longer one this runtime wrote, which can
   * happen between `canResume` and here; the caller has to answer the request itself.
   */
  resumeFrom(
    cwd: string,
    sessionFile: string,
    workspaceTrusted: boolean,
    requestId?: string
  ): Promise<boolean>
  /** `true` when the command was fully handled here; `false` to fall through to the SDK handlers. */
  handleCommand(cmd: SidecarCommand): Promise<boolean>
  stop(): Promise<void>
}
