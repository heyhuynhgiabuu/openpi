import type { MutableModels } from '@earendil-works/pi-ai'

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

export interface DurableHarnessOptions {
  /** Directory for the JSONL store; required for the `jsonl` backend, ignored for `memory`. */
  directory?: string
  backend?: DurableBackend
  /** Model the root conversation runs. */
  model: DurableModelRef
  /** Register pi-ai providers (e.g. the faux provider in tests) before any request. */
  registerProviders?: (models: MutableModels) => void
}

export interface DurableHarness {
  /** Submit one input and wait for the run to settle. */
  prompt(text: string): Promise<DurableSubmitResult>
  /** Subscribe to structural views; returns the unsubscribe function. */
  watch(onView: (view: DurableView) => void): () => void
  /** Current structural view of the root conversation. */
  snapshot(): Promise<DurableView>
  close(): Promise<void>
}
