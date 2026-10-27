import type { Context } from '@earendil-works/chord'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  createModels,
  type AssistantMessage,
  type Message,
  type MutableModels,
} from '@earendil-works/pi-ai'
import { AssistantEntry, createRegistry, UserEntry, Harness } from '@earendil-works/pi-durable'
import type { EntryRecord } from '@earendil-works/pi-durable'
import { openDurableStorage } from './storage'
import type {
  DurableEntrySnapshot,
  DurableHarness,
  DurableHarnessOptions,
  DurableSubmitResult,
  DurableView,
} from './types'

/**
 * The ONLY module allowed to drive @earendil-works/pi-durable (Phase 8 confinement rule, AGENTS.md).
 * Phase 8.1: opens a Harness, runs the root conversation end-to-end, exposes structural views.
 * No IPC and no renderer wiring yet — the pi-coding-agent SDK path stays the shipped runtime.
 */

const ctx: Context = BACKGROUND_CONTEXT

function entrySnapshot(record: EntryRecord): DurableEntrySnapshot {
  const model = record.model
  const first = Array.isArray(model) ? (model[0] as Message | undefined) : undefined
  let text: string | undefined
  if (first && typeof first === 'object' && 'content' in first) {
    const content = (first as { content: unknown }).content
    if (typeof content === 'string') {
      text = content
    } else if (Array.isArray(content)) {
      text = content
        .map((part) =>
          part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string'
            ? part.text
            : ''
        )
        .join('')
    }
  }
  const snapshot: DurableEntrySnapshot = { id: record.id, kind: record.kind }
  if (text !== undefined && text !== '') snapshot.text = text
  return snapshot
}

function toView(conversationId: number, records: readonly EntryRecord[]): DurableView {
  return { conversationId, entries: records.map(entrySnapshot) }
}

/** Text of the final assistant answer, resolved from the settled submission's answer entry ID. */
function answerText(
  records: readonly EntryRecord[],
  answerId: number | undefined
): string | undefined {
  if (!answerId) return undefined
  const record = records.find((candidate) => candidate.id === answerId)
  if (!record || !AssistantEntry.is(record)) return undefined
  const message = record.model?.[0] as AssistantMessage | undefined
  if (!message || !Array.isArray(message.content)) return undefined
  return message.content
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('')
}

export async function openDurableHarness(options: DurableHarnessOptions): Promise<DurableHarness> {
  const backend = options.backend ?? 'jsonl'
  const storage = await openDurableStorage({ backend, directory: options.directory }, ctx)
  const models: MutableModels = createModels()
  options.registerProviders?.(models)
  const registry = createRegistry()
  const harness = await Harness.open(storage, { models, registry }, ctx)
  const root = await harness.root(ctx, { agent: { model: options.model } })

  return {
    async prompt(text: string): Promise<DurableSubmitResult> {
      const submission = await root.submit({ type: 'input', content: text }, ctx)
      const settled = await submission.wait(ctx)
      const view = await root.context(ctx)
      if (settled.status !== 'done' || settled.type !== 'input') {
        return {
          status: settled.status,
          reason: 'reason' in settled ? String(settled.reason) : undefined,
        }
      }
      return { status: 'done', answerText: answerText(view.entries, settled.answer) }
    },

    watch(onView: (view: DurableView) => void): () => void {
      let stopped = false
      let stop: (() => void) | undefined
      void root.watch(ctx).then((handle) => {
        if (stopped) {
          void handle.stop()
          return
        }
        onView(toView(handle.value.conversation.id, handle.value.entries))
        handle.start(async (value) => {
          onView(toView(value.conversation.id, value.entries))
        })
        stop = () => {
          void handle.stop()
        }
      })
      return () => {
        stopped = true
        stop?.()
      }
    },

    async snapshot(): Promise<DurableView> {
      const view = await root.context(ctx)
      return toView(root.id, view.entries)
    },

    close(): Promise<void> {
      return harness.close(ctx)
    },
  }
}

/** Entry kinds the adapter surface cares about (pi.* kinds are pi-durable's own). */
export const DURABLE_ENTRY_KINDS = { user: UserEntry.kind, assistant: AssistantEntry.kind } as const
