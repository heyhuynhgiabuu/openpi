/**
 * Pre-apply review for the durable runtime (Phase 8 item 9 Slice B).
 *
 * The SDK path's gate is a Pi extension (`.pi/extensions/openpi-preapply-review/`) that fires on
 * `tool_call`. pi-durable has no extension host: its `Extension` is an in-memory code object and
 * `Registry.install` takes that object, so the gate file cannot be pointed at from there. The one
 * veto this runtime does offer is `ToolHooks.beforeTool`, whose result may be a Promise — which is
 * what lets a hook wait for a human before the tool runs.
 *
 * So the decision is reimplemented here, and the *preview* is not: `preview.ts` is pure (node:fs
 * and node:path only) and is imported from the extension so the two runtimes describe a change the
 * same way. That module is the single source of truth for what a hunk looks like; duplicating it
 * would be the obvious way for the runtimes to drift.
 *
 * Failure is closed, not open: if asking throws (the sidecar cannot reach the renderer, or the
 * pending entry is rejected on teardown) the hook throws too, and pi-durable blocks a tool call
 * whose hook throws. A gate that fails open would be worse than no gate, because the user believes
 * it is on.
 *
 * Limit, stated because it is visible to the user: approval is all-or-nothing. The SDK path drops
 * the hunks the user did not approve and lets Pi apply the rest; a `beforeTool` can only block or
 * replace the call's arguments wholesale, and replacing `edit` arguments would mean rebuilding a
 * JSON value this module has no schema for. Partial approval is therefore a denial here, with a
 * reason that says so rather than silently applying a subset nobody approved.
 */
import { randomUUID } from 'node:crypto'
import type { ToolHookCall, ToolHooks } from '@earendil-works/pi-durable'
import type { ExtensionUiRequest, ExtensionUiResponse } from '../../../src/lib/extensionUiTypes'
import {
  asRecord,
  confirmMessage,
  displayPath,
  editHunks,
  hunksSummary,
  previewForWrite,
  str,
  writeReviewParts,
} from '../../../.pi/extensions/openpi-preapply-review/preview'

export interface DurableReviewOptions {
  /** Mirrors `OPENPI_PREAPPLY_REVIEW=1`; off means this hook never asks. */
  enabled: boolean
  /**
   * Sends one request and settles with the user's answer. It takes the run's abort signal so a
   * Stop, a new session, reload or fork ends the wait instead of leaving the run blocked.
   */
  ask: (request: ExtensionUiRequest, signal?: AbortSignal) => Promise<ExtensionUiResponse>
  /** Captured at registration: a hook is given no cwd, so relative paths resolve against this. */
  workspacePath?: string | null
  /** Reviewing a diff takes longer than a yes/no glance; the SDK gate waits ten minutes too. */
  timeoutMs?: number
  /** Tools whose calls can change a file, and so are worth asking about. */
  reviewTools?: readonly string[]
}

const DEFAULT_REVIEW_TOOLS = ['write', 'edit']
const DEFAULT_TIMEOUT_MS = 600_000

/** A refusal the model reads as a tool result, so it learns why rather than seeing a failure. */
function denial(shownPath: string, reason: string): { block: string } {
  return {
    block: `Blocked by the OpenPi pre-apply review of ${shownPath}: ${reason}. The change was not applied. Do not retry it unchanged without addressing this.`,
  }
}

/**
 * A `confirm`-style request that hides whether the human approved, for callers that answer with a
 * bare yes/no: `confirmed` is set, `approved` is absent (which `verdict` reads as unanswered).
 */
export function confirmRequest(title: string, timeoutMs: number): ExtensionUiRequest {
  return { id: randomUUID(), method: 'confirm', title, timeout: timeoutMs }
}

/** Reads a `confirm` answer: only an explicit `true` approves. */
export function confirmed(answer: ExtensionUiResponse): boolean {
  return answer.cancelled !== true && answer.confirmed === true
}

/**
 * The decision on its own. `beforeTool` also receives a `HookApi` and a `Context`, and this gate
 * reads neither — it needs only the call. Keeping the decision separate is what lets it be tested
 * without fabricating SDK objects, and `reviewToolHooks` adapts it to the hook shape.
 */
export interface ReviewGate {
  decide(call: ToolHookCall, signal?: AbortSignal): Promise<{ block: string } | undefined>
}

export function reviewGate(options: DurableReviewOptions): ReviewGate {
  const reviewTools = options.reviewTools ?? DEFAULT_REVIEW_TOOLS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const cwd = options.workspacePath ?? process.cwd()

  async function decide(
    call: ToolHookCall,
    signal?: AbortSignal
  ): Promise<{ block: string } | undefined> {
    if (!options.enabled) return undefined
    if (!reviewTools.includes(call.name)) return undefined
    const input = asRecord(call.arguments)

    const parts = call.name === 'write' ? writeReviewParts(input, cwd) : null
    // A write the hunk view cannot render — an existing binary file, one over the read limit, one
    // that cannot be read, or an empty create — must still be asked about. Falling through to
    // "cannot describe it, step aside" was a real hole: a blind overwrite of a large file applied
    // with no prompt at all, while the SDK gate falls back to a text confirm. Ask, with whatever
    // description is available.
    if (call.name === 'write' && !parts) {
      const preview = previewForWrite(input, cwd)
      if (!preview) return undefined
      const answer = await options.ask(
        {
          id: randomUUID(),
          method: 'confirm',
          title: `Review before applying: ${preview.path}`,
          message: `${preview.summary}\n\n${confirmMessage(preview)}`,
          timeout: timeoutMs,
        },
        signal
      )
      if (answer.cancelled === true) return denial(preview.path, 'the review was not answered')
      if (answer.confirmed === true) return undefined
      return denial(preview.path, 'the user denied this change')
    }
    if (parts) {
      const answer = await options.ask(
        {
          id: randomUUID(),
          method: 'preapply_review',
          title: `Review before applying: ${parts.shownPath}`,
          review: { path: parts.shownPath, summary: parts.summary, hunks: parts.hunks },
          timeout: timeoutMs,
        },
        signal
      )
      return verdict(parts.shownPath, answer, parts.hunks.length)
    }

    const hunks = call.name === 'edit' ? editHunks(input) : null
    const target = str(input.path)
    if (hunks && target) {
      const shownPath = displayPath(cwd, target)
      const answer = await options.ask(
        {
          id: randomUUID(),
          method: 'preapply_review',
          title: `Review before applying: ${shownPath}`,
          review: { path: shownPath, summary: hunksSummary(hunks), hunks },
          timeout: timeoutMs,
        },
        signal
      )
      return verdict(shownPath, answer, hunks.length)
    }

    // No describable change: step aside, exactly as the SDK gate does for input it cannot read.
    // Pi's own tool validation rejects such a call, so nothing is applied behind the user's back.
    return undefined
  }

  return { decide }
}

export function reviewToolHooks(options: DurableReviewOptions): ToolHooks {
  const gate = reviewGate(options)
  return {
    beforeTool: (call, _api, context) => gate.decide(call, context.abortSignal),
    afterTool: () => undefined,
  }
}

/** Reads an answer as approve-or-refuse; a partial approval is a refusal (see the header). */
function verdict(
  shownPath: string,
  answer: ExtensionUiResponse,
  hunkCount: number
): { block: string } | undefined {
  // Cancellation wins over any approval in the same answer: a cancelled prompt was withdrawn, so
  // an `approved` list beside it belongs to a dialog the user no longer had.
  if (answer.cancelled === true || answer.approved === undefined)
    return denial(shownPath, 'the review was not answered')
  if (answer.approved.length === 0) return denial(shownPath, 'the user denied the change')
  if (answer.approved.length < hunkCount)
    return denial(
      shownPath,
      'the user approved only some of the changes, and this runtime applies all or none'
    )
  return undefined
}
