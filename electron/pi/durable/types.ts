import type { ModelThinkingLevel, Models, MutableModels } from '@earendil-works/pi-ai'
import type { CustomizationDiagnostic } from '../../../src/lib/ipc'
import type { SessionFileHeader, SessionFileResult } from './sessionFile'
import type { BashResult } from './bash'
import type { DurableStats } from './stats'

/** Provider/model the durable conversation runs with (resolved through pi-ai `Models`). */
export interface DurableModelRef {
  provider: string
  modelId: string
}

/** One transcript entry as the adapter exposes it: structural facts plus assistant/user text when present. */
export interface DurableEntrySnapshot {
  id: number
  kind: string
  text?: string
}

/** Structural watch view of the root conversation (mapped from pi-durable `ConversationView`). */
export interface DurableView {
  conversationId: number
  entries: DurableEntrySnapshot[]
}

/** Outcome of one durable prompt, settled. */
export interface DurableSubmitResult {
  status: 'done' | 'unanswered'
  /** Text of the final assistant answer, when the run answered. */
  answerText?: string
  /** Unanswered reason code from the submission record, when present. */
  reason?: string
}

/** Storage backend for the durable store. SQLite arrives in a later slice behind a capability check. */
export type DurableBackend = 'jsonl' | 'memory'

/** Outcome of a manual compaction. `nothing` means the conversation was too small to summarize. */
export type DurableCompaction =
  | { status: 'compacted' }
  | { status: 'nothing' }
  | { status: 'failed'; message: string }

/** A queued message: admission is done, `settled` resolves when its run finishes. */
export interface DurableQueued {
  settled: Promise<DurableSubmitResult>
}

export interface DurableHarnessOptions {
  /** Directory for the JSONL store; required for the `jsonl` backend, ignored for `memory`. */
  directory?: string
  backend?: DurableBackend
  /** Model the root conversation runs. */
  model: DurableModelRef
  /**
   * Model registry to run against. Production passes the SDK's `ModelRuntime` (it implements
   * `Models`), so auth.json, models.json and OAuth are shared with the SDK path instead of being
   * rebuilt. Omit to use a fresh registry that `registerProviders` populates (tests).
   */
  models?: Models
  /** Register pi-ai providers (e.g. the faux provider in tests) before any request. */
  registerProviders?: (models: MutableModels) => void
  /** User agent dir (`~/.pi/agent`); customizations are discovered from it. */
  userAgentDir?: string
  /** Active workspace root: project customizations and out-of-workspace policy checks. */
  workspacePath?: string | null
  /** Install the desktop policy gate (`beforeTool`) on tool calls. Defaults to true. */
  policy?: boolean
  /** Install pi-durable's built-in coding tools (read/write/edit/bash). Defaults to true. */
  tools?: boolean
  /** Compaction policy overrides, e.g. a small `keepRecentTokens` so a short conversation compacts (tests). */
  compaction?: { keepRecentTokens?: number }
  /** Read `.mcp.json` and bridge its servers (requires `projectTrusted` for the project file). */
  mcp?: boolean
  /** Whether the workspace is trusted, gating `.pi/mcp.json` and project extensions. */
  projectTrusted?: boolean
}

export interface DurableHarness {
  /** Submit one input and wait for the run to settle. */
  prompt(text: string): Promise<DurableSubmitResult>
  /** The agent's stored choices, resolved: the thinking level in force, and the model when set. */
  agentState(): Promise<{ model?: DurableModelRef; thinkingLevel: ModelThinkingLevel }>
  /** Change the model and/or thinking level for the next request; a given field replaces the stored one. */
  configure(change: { model?: DurableModelRef; thinkingLevel?: ModelThinkingLevel }): Promise<void>
  /** Record the session's display name as a passive entry (appended at once, even mid-run). */
  setSessionName(name: string): Promise<void>
  /**
   * Summarize older context, waiting for the compaction task to finish. The summary replaces the
   * older entries in the model's context; the full history stays in the store and the export.
   */
  compact(instructions?: string): Promise<DurableCompaction>
  /**
   * Run one of the user's own shell commands in the workspace and record it in the conversation.
   * The model sees it on its next request unless `excludeFromContext`. Resolves with the result
   * once the command ends; rejects when the shell cannot start.
   */
  executeBash(command: string, options?: { excludeFromContext?: boolean }): Promise<BashResult>
  /** Usage totals, message count, last answer and context fill, from pi-durable's own ledger. */
  stats(): Promise<DurableStats>
  /**
   * Queue a message for a run in progress: `steer` is delivered after the current turn's tool calls
   * and before the next model call, `followUp` only once the run has fully stopped. Resolves once
   * admitted, not once answered (like the SDK's `steer()`); `settled` tracks the outcome. With no
   * run in progress the message starts one.
   */
  queue(text: string, mode: 'steer' | 'followUp'): Promise<DurableQueued>
  /**
   * Abort the root conversation: withdraw queued inputs, signal the live run, and resolve once it
   * is idle. A `prompt()` still awaiting the aborted run settles `unanswered`. Idempotent.
   */
  abort(): Promise<void>
  /** Subscribe to structural views; returns the unsubscribe function. */
  watch(onView: (view: DurableView) => void): () => void
  /** Current structural view of the root conversation. */
  snapshot(): Promise<DurableView>
  /** Non-fatal diagnostics from resource discovery (customizations), surfaced like the SDK path. */
  diagnostics(): readonly CustomizationDiagnostic[]
  /**
   * Attach the renderer event feed for the root conversation; `onEvent` receives the snapshot first,
   * then each batch in the coding agent's event vocabulary.
   */
  watchEvents(onEvent: (event: Record<string, unknown>) => void): Promise<() => Promise<void>>
  /**
   * Write the root conversation as a Pi JSONL v3 session file. `header.sessionId` is the ownership key: only a
   * file carrying the same id is overwritten, any other session's file is refused.
   */
  exportSession(path: string, header: SessionFileHeader): Promise<SessionFileResult>
  close(): Promise<void>
}
