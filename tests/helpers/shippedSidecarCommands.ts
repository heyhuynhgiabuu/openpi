/**
 * Command half of the shipped-path harness: the sidecar commands tests issue,
 * written against a transport. Awaitable commands (start_session, get_session_info,
 * navigate_tree) resolve with their validated reply; conversation commands that
 * only queue or interrupt (steer, follow_up, abort) just send, because their
 * observable effect is the event stream, which tests wait on explicitly.
 *
 * Sidecar command names and shapes: electron/pi/sidecarContracts.ts.
 */
import type { SidecarCommand } from '../../electron/pi/sidecarTypes'
import type { SidecarError, SidecarTransport } from './shippedSidecarTransport'
import {
  navigateTreeReply,
  parseReply,
  readSessionEvent,
  sessionInfoReply,
  sessionReadyReply,
  type SessionEvent,
} from './shippedReplies'
import { RELEASE_COMMAND, type HoldGate } from '../fixtures/scripted-hold-extension.js'

const MODEL_READY_TIMEOUT_MS = 30_000
const REPLY_TIMEOUT_MS = 30_000
const READY_TIMEOUT_MS = 60_000
const AGENT_END_TIMEOUT_MS = 60_000
const EVENT_TIMEOUT_MS = 30_000

interface CommandSession {
  workspace: string
  workspaceTrusted: boolean
}

export interface SidecarCommands {
  /** Starts a session in the workspace at the harness trust level. Resolves with its session file, or null. */
  startSession(requestId: string, sessionFile?: string): Promise<string | null>
  /** Selects `provider`/`modelId` and polls until get_session_info reports it. */
  selectModel(provider: string, modelId: string): Promise<void>
  /** Selects the scripted model (tests/fixtures/scripted-provider-extension.js). */
  selectScriptedModel(): Promise<void>
  /** Sends a prompt and resolves when the agent loop ends (`agent_end`). */
  prompt(text: string): Promise<void>
  /** Sends a prompt and returns at once: the run is observed through events. */
  startPrompt(text: string): void
  /** Sends the `steer` command: Pi queues the text for the running turn. */
  steer(text: string): void
  /** Sends the `follow_up` command: Pi queues the text for after the run stops. */
  followUp(text: string): void
  /** Sends the `abort` command. */
  abort(): void
  /**
   * Opens a hold gate of the hold extension. It goes through the real `prompt`
   * command as the extension's slash command, which Pi runs immediately even
   * while a run is in progress.
   */
  release(gate: HoldGate): void
  /** Resolves with the first session event at or after log index `since` that matches. */
  waitForEvent(predicate: (event: SessionEvent) => boolean, since?: number): Promise<SessionEvent>
  /** Resolves with the first sidecar `error` at or after log index `since` (a rejected command). */
  waitForError(since?: number): Promise<SidecarError>
  /** Reads get_session_info for the active session. */
  sessionInfo(requestId: string): Promise<{ messageCount: number }>
  /** Moves the session leaf with navigate_tree (same file, no fork). Rejects on a sidecar error. */
  navigateTree(
    requestId: string,
    entryId: string
  ): Promise<{ cancelled: boolean; leafId: string | null }>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createCommands(
  transport: SidecarTransport,
  session: CommandSession
): SidecarCommands {
  const { send, waitFor } = transport
  let modelChecks = 0

  async function selectModel(provider: string, modelId: string): Promise<void> {
    send({ type: 'set_model', provider, modelId })
    const deadline = Date.now() + MODEL_READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      modelChecks += 1
      const requestId = `model-check-${modelChecks}`
      send({ type: 'get_session_info', requestId })
      const reply = await waitFor(
        (message) => message.type === 'session_info_result' && message.requestId === requestId,
        REPLY_TIMEOUT_MS
      )
      const { info } = parseReply(sessionInfoReply, reply)
      if (info.model?.provider === provider && info.model.id === modelId) return
      await sleep(50)
    }
    throw new Error(`model never became '${provider}/${modelId}'; stderr: ${transport.stderr()}`)
  }

  return {
    async startSession(requestId, sessionFile) {
      const command: Extract<SidecarCommand, { type: 'start_session' }> = {
        type: 'start_session',
        cwd: session.workspace,
        workspaceTrusted: session.workspaceTrusted,
        requestId,
      }
      if (sessionFile) command.sessionFile = sessionFile
      send(command)
      const ready = await waitFor(
        (message) => message.type === 'session_ready' && message.requestId === requestId,
        READY_TIMEOUT_MS
      )
      return parseReply(sessionReadyReply, ready).payload.sessionFile
    },

    selectModel,
    selectScriptedModel: () => selectModel('scripted', 'scripted-write'),

    async prompt(text) {
      send({ type: 'prompt', text })
      await waitFor(
        (message) =>
          message.type === 'session_event' && readSessionEvent(message).type === 'agent_end',
        AGENT_END_TIMEOUT_MS
      )
    },

    startPrompt: (text) => send({ type: 'prompt', text }),
    steer: (text) => send({ type: 'steer', text }),
    followUp: (text) => send({ type: 'follow_up', text }),
    abort: () => send({ type: 'abort' }),
    release: (gate) => send({ type: 'prompt', text: `/${RELEASE_COMMAND} ${gate}` }),

    waitForEvent: (predicate, since = 0) =>
      transport.waitForEvent(predicate, since, EVENT_TIMEOUT_MS),
    waitForError: (since = 0) => transport.waitForError(since, EVENT_TIMEOUT_MS),

    async sessionInfo(requestId) {
      send({ type: 'get_session_info', requestId })
      const reply = await waitFor(
        (message) => message.type === 'session_info_result' && message.requestId === requestId,
        REPLY_TIMEOUT_MS
      )
      return parseReply(sessionInfoReply, reply).info
    },

    async navigateTree(requestId, entryId) {
      send({ type: 'navigate_tree', entryId, requestId })
      const reply = await waitFor(
        (message) =>
          (message.type === 'navigate_tree_result' || message.type === 'error') &&
          message.requestId === requestId,
        REPLY_TIMEOUT_MS
      )
      if (reply.type === 'error') throw new Error(`navigate_tree failed: ${reply.message}`)
      return parseReply(navigateTreeReply, reply).result
    },
  }
}
