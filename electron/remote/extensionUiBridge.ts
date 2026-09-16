/**
 * remote/extensionUiBridge — the registry hop for extension UI prompts.
 *
 * Bridgeable prompts: `confirm`, the structured `preapply_review`, and
 * `ctx.ui.input` calls carrying the preapply review marker (the app already
 * detects that marker in extensionUiTypes.ts — same coupling, not new).
 * Other methods (plain inputs, selects, editor) pass through untouched.
 *
 * One pending promise, two resolvers, first settle wins: if the desktop
 * renderer answers first, its response is relayed verbatim and the gate is
 * tombstoned (remote replay → 409). If a paired device answers first, the
 * remote decision is relayed to the sidecar immediately and the renderer's
 * stale answer is dropped. Pi dismisses the renderer dialog on
 * `ui_prompt_end`, so the stale modal cleans itself up.
 */

import type { ExtensionUiRequest, ExtensionUiResponse } from '../../src/lib/extensionUiTypes'
import { PREAPPLY_REVIEW_MARKER } from '../../src/lib/extensionUiTypes'
import type { OpenedGate } from './gates'

export type ExtensionUiRelay = (response: ExtensionUiResponse) => void

interface PendingBridge {
  request: ExtensionUiRequest
  gate: OpenedGate
  relay: ExtensionUiRelay
  settle: (approved: boolean) => boolean
  settledBy: 'renderer' | 'remote' | null
}

const pending = new Map<string, PendingBridge>()
/** Recently settled ids (both winners) — stale duplicate answers drop here. */
const settledIds = new Map<string, 'renderer' | 'remote'>()

/** Hunk count of a bridgeable payload, for approve-all semantics. */
function hunkCount(request: ExtensionUiRequest): number | null {
  const review =
    request.method === 'preapply_review'
      ? request.review
      : request.method === 'input' && request.placeholder?.startsWith(PREAPPLY_REVIEW_MARKER)
        ? parseMarkedReview(request.placeholder)
        : null
  return review && Array.isArray(review.hunks) ? review.hunks.length : null
}

interface MarkedReview {
  summary?: unknown
  hunks?: unknown
}

function parseMarkedReview(placeholder: string): MarkedReview | null {
  try {
    return JSON.parse(placeholder.slice(PREAPPLY_REVIEW_MARKER.length)) as MarkedReview
  } catch {
    return null
  }
}

function gatePayload(request: ExtensionUiRequest): unknown | undefined {
  if (request.method === 'preapply_review') return request.review
  if (request.method === 'input' && request.placeholder?.startsWith(PREAPPLY_REVIEW_MARKER)) {
    return parseMarkedReview(request.placeholder) ?? undefined
  }
  return undefined
}

/** True when the remote hop can represent this prompt as a gate. */
function isBridgeable(request: ExtensionUiRequest): boolean {
  return (
    request.method === 'confirm' ||
    request.method === 'preapply_review' ||
    (request.method === 'input' && request.placeholder?.startsWith(PREAPPLY_REVIEW_MARKER) === true)
  )
}

/**
 * Opens a gate for a bridgeable prompt. Returns true when bridged — the
 * caller still forwards the request to the renderer either way. `relay` is
 * held until exactly one side settles the gate.
 */
export function interceptExtensionUi(input: {
  request: ExtensionUiRequest
  openGate: (gate: {
    title: string
    summary: string
    payload?: unknown
    ttlMs: number
  }) => OpenedGate | null
  /** Desktop-side settlement via the registry; false when remote won first. */
  settle: (gate: OpenedGate, approved: boolean) => boolean
  relay: ExtensionUiRelay
}): boolean {
  const { request, relay } = input
  if (pending.has(request.id) || !isBridgeable(request)) return false

  const ttlMs = request.timeout ?? 10 * 60_000
  let summary = ''
  if (request.method === 'confirm') {
    summary = request.message ?? ''
  } else if (request.method === 'preapply_review') {
    summary = request.review.summary
  } else if (
    request.method === 'input' &&
    request.placeholder?.startsWith(PREAPPLY_REVIEW_MARKER)
  ) {
    const parsed = parseMarkedReview(request.placeholder)
    summary = typeof parsed?.summary === 'string' ? parsed.summary : ''
  }

  const gate = input.openGate({
    title: request.title,
    summary: summary.slice(0, 500),
    payload: gatePayload(request),
    ttlMs,
  })
  if (!gate) return false

  const entry: PendingBridge = {
    request,
    gate,
    relay,
    settle: (approved) => input.settle(gate, approved),
    settledBy: null,
  }
  pending.set(request.id, entry)
  void gate.wait().then((outcome) => {
    // Renderer won the race: its answer was already relayed verbatim.
    if (entry.settledBy !== null) return
    entry.settledBy = 'remote'
    forget(request.id, 'remote')
    relay(remoteResponseFor(request, outcome))
  })
  return true
}

export type RendererResolve = 'relay' | 'drop'

/**
 * Called from RESOLVE_EXTENSION_UI before relaying. 'relay' = the desktop
 * answer won (settle the gate, relay verbatim); 'drop' = remote already
 * answered and the sidecar must not see a second response for the id.
 */
export function resolveFromRenderer(response: ExtensionUiResponse): RendererResolve {
  const entry = pending.get(response.id)
  if (!entry) return settledIds.has(response.id) ? 'drop' : 'relay'
  if (entry.settledBy !== null) return 'drop'

  entry.settledBy = 'renderer'
  forget(response.id, 'renderer')
  const approved = response.cancelled
    ? false
    : response.confirmed === true ||
      response.value !== undefined ||
      (response.approved?.length ?? 0) > 0
  entry.settle(approved)
  return 'relay'
}

/** Pending ids (diagnostics/tests). */
export function pendingIds(): string[] {
  return [...pending.keys()]
}

/** Drops all pending bridges and markers (diagnostics/tests). */
export function clearPending(): void {
  pending.clear()
  settledIds.clear()
}

/** Removes a live entry and remembers its winner, bounded like tombstones. */
function forget(id: string, winner: 'renderer' | 'remote'): void {
  pending.delete(id)
  settledIds.set(id, winner)
  while (settledIds.size > 128) {
    const oldest = settledIds.keys().next().value
    if (oldest === undefined) break
    settledIds.delete(oldest)
  }
}

/** Remote outcome → the extension response shape for this request's method. */
function remoteResponseFor(
  request: ExtensionUiRequest,
  outcome: { approved: boolean; approvedIndexes?: number[]; via: string } | { expired: true }
): ExtensionUiResponse {
  if ('expired' in outcome) return { id: request.id, cancelled: true }

  const count = hunkCount(request)
  const approvedIndexes =
    outcome.approvedIndexes ??
    (outcome.approved && count !== null ? Array.from({ length: count }, (_, i) => i) : undefined)

  if (request.method === 'confirm') {
    return { id: request.id, confirmed: outcome.approved }
  }
  if (request.method === 'preapply_review') {
    return { id: request.id, approved: approvedIndexes ?? [], remember: false }
  }
  // Marked input: the extension parses the value string.
  return {
    id: request.id,
    value: JSON.stringify({ approved: approvedIndexes ?? [], remember: false }),
  }
}
